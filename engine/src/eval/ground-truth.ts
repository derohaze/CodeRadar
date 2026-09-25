/**
 * Scoring a review against the fixture's ground truth.
 *
 * A review run produces a report, and a report is not a score. The only way to
 * know whether the engine is getting better is to compare a run against what is
 * actually wrong in the fixture: which planted defects it surfaced, which it
 * missed, and which findings it produced that nothing supports.
 *
 * Two rules keep the score honest:
 *
 * - Ground truth is read from the fixture's own document, never from a run. A
 *   defect is in the table because the code is wrong, not because a model said so.
 * - A finding is only a true positive when the file it names is the file the
 *   defect lives in. Anchors are reported next to the verdict so a human can
 *   check the line, but the score itself does not pretend to know the exact line
 *   the fixture author meant.
 */

export interface GroundTruthDefect {
  id: string;
  /** One or more fixture paths, as the table states them. */
  files: string[];
  defect: string;
  expectedSeverity: string;
}

export interface GroundTruthNegativeControl {
  id: string;
  /** One entry covers every file its row names, e.g. the interface-only pair. */
  files: string[];
  looksLike: string;
  whyCorrect: string;
}

export interface GroundTruth {
  defects: GroundTruthDefect[];
  negatives: GroundTruthNegativeControl[];
}

/** One markdown table row, or null when the line is not a table row. */
function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;

  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

  // The header separator row (`| -- | ---- |`) is not data.
  if (cells.some((cell) => /^-{2,}$/.test(cell))) return null;
  return cells;
}

/**
 * Every fixture path a cell names.
 *
 * A row may cover more than one file — the interface-only negative control names
 * two — and dropping the second path would quietly create an uncovered file.
 */
function pathsIn(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "").filter((value) => value !== "");
}

/**
 * Reads the defect and negative-control tables out of the fixture's document.
 *
 * Rows are identified by their id, not by their position, so adding a section or
 * reordering the file cannot silently change what is being scored.
 */
export function parseGroundTruth(markdown: string): GroundTruth {
  const defects: GroundTruthDefect[] = [];
  const negatives: GroundTruthNegativeControl[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const cells = tableCells(line);
    if (cells === null || cells.length < 4) continue;

    const [id, fileCell, ...rest] = cells;
    if (id === undefined || fileCell === undefined) continue;

    const files = pathsIn(fileCell);
    if (files.length === 0) continue;

    if (/^D\d+$/.test(id)) {
      defects.push({ id, files, defect: rest[0] ?? "", expectedSeverity: rest[1] ?? "" });
    } else if (/^C\d+$/.test(id)) {
      negatives.push({ id, files, looksLike: rest[0] ?? "", whyCorrect: rest[1] ?? "" });
    }
  }

  return { defects, negatives };
}

/**
 * A finding as it arrives from a run.
 *
 * Two shapes are in play and both are real: the engine's own report nests the
 * anchor under `location`, while the wire contract the app reads flattens it.
 * Reading either one here means a saved report and a live response are scored by
 * the same code, which is the only way the two numbers can be compared.
 */
export interface ReportFindingLike {
  title: string;
  location?: { file: string; line: number; lineEnd?: number | undefined } | undefined;
  file?: string | undefined;
  line?: number | undefined;
  lineEnd?: number | undefined;
  line_end?: number | undefined;
  severity?: string | undefined;
}

export interface NormalisedFinding {
  title: string;
  file: string;
  line: number;
  lineEnd: number;
  severity: string | null;
}

/** Flattens either finding shape, or null when the anchor is not readable. */
export function normaliseFinding(raw: ReportFindingLike): NormalisedFinding | null {
  const nested = raw.location;
  const file = nested?.file ?? raw.file;
  const line = nested?.line ?? raw.line;
  if (typeof file !== "string" || file.trim() === "" || typeof line !== "number" || !Number.isFinite(line)) {
    return null;
  }

  const rawEnd = nested?.lineEnd ?? raw.lineEnd ?? raw.line_end ?? line;
  const lineEnd = Number.isFinite(rawEnd) ? Math.max(rawEnd, line) : line;
  return { title: raw.title, file, line, lineEnd, severity: raw.severity ?? null };
}

export interface DefectOutcome {
  id: string;
  files: string[];
  detected: boolean;
  /** The anchors that claim this defect, in report order. */
  anchors: string[];
}

export interface NegativeOutcome {
  id: string;
  files: string[];
  /** True when a finding was reported against code the table says is correct. */
  leaked: boolean;
  anchors: string[];
}

export type FindingVerdict = "defect" | "negative-control" | "unsupported";

export interface ClassifiedFinding {
  finding: NormalisedFinding;
  anchor: string;
  verdict: FindingVerdict;
  /**
   * Every ground-truth id the finding's file covers.
   *
   * It is a list because a file can hold more than one planted defect: crediting
   * only the first match made the second defect of a file impossible to detect,
   * which is a measurement bug, not a property of the review.
   */
  matchedIds: string[];
}

export interface CandidateCounts {
  produced: number;
  kept: number;
  rejected: number;
  merged: number;
}

export interface ReviewEvaluation {
  findings: ClassifiedFinding[];
  defects: DefectOutcome[];
  missedDefectIds: string[];
  negatives: NegativeOutcome[];
  leakedNegativeIds: string[];
  /** The engine's own rejection tally, by reason. */
  rejectionBreakdown: Record<string, number>;
  candidates: CandidateCounts;
  totals: {
    plantedDefects: number;
    detectedDefects: number;
    truePositives: number;
    /** Findings against a file with no ground-truth row: nothing supports them. */
    unsupported: number;
    /** Findings against a file the table says is correct. */
    falsePositiveOnNegatives: number;
    falsePositives: number;
    falseNegatives: number;
    /** Findings sharing an anchor with an earlier finding. */
    duplicateAnchors: number;
    /**
     * Findings with no readable anchor.
     *
     * They cannot be scored either way, but they are counted rather than dropped:
     * otherwise a report could improve its score by omitting anchors.
     */
    unanchorable: number;
  };
}

/** Matches a reported path against a fixture path, whatever root it was named from. */
export function fileMatches(claimed: string, expected: string): boolean {
  const left = claimed.replace(/\\/g, "/");
  const right = expected.replace(/\\/g, "/").replace(/^\.\//, "");
  return left === right || left.endsWith(`/${right}`);
}

function anchorOf(finding: NormalisedFinding): string {
  return finding.lineEnd > finding.line
    ? `${finding.file}:${finding.line}-${finding.lineEnd}`
    : `${finding.file}:${finding.line}`;
}

export interface ReviewReportLike {
  findings: readonly ReportFindingLike[];
  rejected?: readonly unknown[] | undefined;
  stats?:
    | {
        candidatesProduced?: number;
        candidatesRejected?: number;
        duplicatesMerged?: number;
        rejectionsByReason?: Record<string, number>;
      }
    | undefined;
  /** The wire contract's own name for the same tally, for a live response. */
  rejections_by_reason?: Record<string, number> | undefined;
  /** The wire contract's name for the dropped candidates. */
  rejected_candidates?: readonly unknown[] | undefined;
}

/**
 * Scores a report against the ground truth.
 *
 * Every finding is classified before any total is computed, so a finding can only
 * count once and the reason is always visible next to it.
 */
export function evaluateReview(report: ReviewReportLike, truth: GroundTruth): ReviewEvaluation {
  const classified: ClassifiedFinding[] = [];
  const seenAnchors = new Set<string>();
  let duplicateAnchors = 0;
  let unanchorable = 0;

  for (const raw of report.findings) {
    const finding = normaliseFinding(raw);
    // A finding with no readable anchor cannot be scored either way, so it is
    // counted on its own rather than dropped: otherwise a report could improve
    // its score by omitting an anchor.
    if (finding === null) {
      unanchorable += 1;
      continue;
    }

    const anchor = anchorOf(finding);
    if (seenAnchors.has(anchor)) duplicateAnchors += 1;
    seenAnchors.add(anchor);

    const defects = truth.defects.filter((candidate) =>
      candidate.files.some((file) => fileMatches(finding.file, file)),
    );
    if (defects.length > 0) {
      classified.push({ finding, anchor, verdict: "defect", matchedIds: defects.map((defect) => defect.id) });
      continue;
    }

    const negatives = truth.negatives.filter((candidate) =>
      candidate.files.some((file) => fileMatches(finding.file, file)),
    );
    classified.push({
      finding,
      anchor,
      verdict: negatives.length === 0 ? "unsupported" : "negative-control",
      matchedIds: negatives.map((negative) => negative.id),
    });
  }

  const defects: DefectOutcome[] = truth.defects.map((defect) => {
    // Per defect, not per finding: coverage is independent for two defects that
    // share a file, so neither can hide behind the other.
    const anchors = classified
      .filter((entry) => entry.verdict === "defect" && entry.matchedIds.includes(defect.id))
      .map((entry) => entry.anchor);
    return { id: defect.id, files: defect.files, detected: anchors.length > 0, anchors };
  });

  const negatives: NegativeOutcome[] = truth.negatives.map((negative) => {
    const anchors = classified
      .filter((entry) => entry.verdict === "negative-control" && entry.matchedIds.includes(negative.id))
      .map((entry) => entry.anchor);
    return { id: negative.id, files: negative.files, leaked: anchors.length > 0, anchors };
  });

  const truePositives = classified.filter((entry) => entry.verdict === "defect").length;
  const unsupported = classified.filter((entry) => entry.verdict === "unsupported").length;
  const onNegatives = classified.filter((entry) => entry.verdict === "negative-control").length;
  const stats = report.stats;
  // A report that lists no rejections still carried the tally in its stats, and an
  // empty list is not the same answer as a missing one.
  const listedRejections = report.rejected?.length ?? report.rejected_candidates?.length ?? 0;
  const rejected = listedRejections > 0 ? listedRejections : (stats?.candidatesRejected ?? 0);

  return {
    findings: classified,
    defects,
    missedDefectIds: defects.filter((defect) => !defect.detected).map((defect) => defect.id),
    negatives,
    leakedNegativeIds: negatives.filter((negative) => negative.leaked).map((negative) => negative.id),
    rejectionBreakdown: stats?.rejectionsByReason ?? report.rejections_by_reason ?? {},
    candidates: {
      produced: stats?.candidatesProduced ?? report.findings.length + rejected,
      kept: report.findings.length,
      rejected,
      merged: stats?.duplicatesMerged ?? 0,
    },
    totals: {
      plantedDefects: truth.defects.length,
      detectedDefects: defects.filter((defect) => defect.detected).length,
      truePositives,
      unsupported,
      falsePositiveOnNegatives: onNegatives,
      falsePositives: unsupported + onNegatives,
      falseNegatives: defects.filter((defect) => !defect.detected).length,
      duplicateAnchors,
      unanchorable,
    },
  };
}

/**
 * The evaluation as data, for a harness that has to assert on it.
 *
 * The text report is for a human reading a log; this is the same verdicts in a
 * shape a test or a CI gate can compare without parsing prose.
 */
export function evaluationToJson(evaluation: ReviewEvaluation): Record<string, unknown> {
  return {
    defects: evaluation.defects,
    missed_defects: evaluation.missedDefectIds,
    negatives: evaluation.negatives,
    missed_negatives: evaluation.leakedNegativeIds,
    rejection_breakdown: evaluation.rejectionBreakdown,
    candidates: evaluation.candidates,
    totals: evaluation.totals,
  };
}

/**
 * Pulls the report object out of a saved run.
 *
 * The CLI writes its human-readable summary to the same stream as the JSON, so a
 * saved run is not pure JSON. Scanning for the first object that carries a review
 * schema is more honest than trimming a fixed prefix, which would break the day
 * the summary grows a line.
 */
export function readReviewReport(text: string): ReviewReportLike {
  for (let index = text.indexOf("{"); index !== -1; index = text.indexOf("{", index + 1)) {
    const candidate = text.slice(index);
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    // `findings` as an array is the one thing both shapes agree on: the engine's
    // report and the wire detail it is mapped onto.
    if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { findings?: unknown }).findings)) {
      return parsed as ReviewReportLike;
    }
  }
  throw new Error("no review report was found in the input");
}

/**
 * The evaluation as text, so a run can be read from a log without a screenshot.
 *
 * Every defect and every negative control is listed whether or not it was hit:
 * a report of only the successes is how a fixture stops being a measurement.
 */
export function formatEvaluation(evaluation: ReviewEvaluation, truth: GroundTruth): string {
  const lines: string[] = [];
  const { totals, candidates } = evaluation;

  lines.push("Defect coverage");
  for (const defect of evaluation.defects) {
    const verdict = defect.detected ? "detected" : "MISSED  ";
    lines.push(`  ${defect.id.padEnd(3)} ${verdict}  ${defect.files.join(", ")}  ${defect.anchors.join(", ") || "-"}`);
  }

  lines.push("Negative controls");
  for (const negative of evaluation.negatives) {
    lines.push(
      `  ${negative.id.padEnd(3)} ${negative.leaked ? "LEAKED  " : "clean   "}  ${negative.files.join(", ")}  ${negative.anchors.join(", ") || "-"}`,
    );
  }

  lines.push("Findings");
  for (const entry of evaluation.findings) {
    lines.push(`  ${entry.verdict.padEnd(16)} ${entry.anchor}  ${entry.finding.title}`);
  }

  lines.push("Validation");
  lines.push(
    `  candidates=${candidates.produced} kept=${candidates.kept} rejected=${candidates.rejected} merged=${candidates.merged}`,
  );
  const reasons = Object.entries(evaluation.rejectionBreakdown).sort(([, a], [, b]) => b - a);
  lines.push(
    `  rejection breakdown: ${reasons.length === 0 ? "none" : reasons.map(([reason, count]) => `${reason}=${count}`).join(" ")}`,
  );

  lines.push("Totals");
  lines.push(
    `  defects ${totals.detectedDefects}/${totals.plantedDefects} detected, ` +
      `TP=${totals.truePositives} FP=${totals.falsePositives} ` +
      `(unsupported=${totals.unsupported} on-negative-controls=${totals.falsePositiveOnNegatives}) ` +
      `FN=${totals.falseNegatives} duplicate-anchors=${totals.duplicateAnchors} unanchorable=${totals.unanchorable}`,
  );
  if (evaluation.missedDefectIds.length > 0) {
    lines.push(`  missed: ${evaluation.missedDefectIds.join(", ")} of ${truth.defects.length}`);
  }

  return lines.join("\n");
}
