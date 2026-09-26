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

/** An inclusive, 1-based line range. */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * The lines a set of sent windows covered.
 *
 * Overlapping windows are merged before they are measured: counted twice, a file
 * that was only partly sent would read as fully sent, which is the one mistake
 * this measurement exists to prevent.
 */
function coverageOf(
  windows: readonly ReportWindowLike[],
  fileLines: number,
): { ranges: LineRange[]; coveredLines: number } {
  const ranges: LineRange[] = [];
  for (const window of windows) {
    const start = window.startLine;
    const end = window.endLine;
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const from = Math.max(1, Math.floor(start));
    const to = Math.min(fileLines, Math.floor(end));
    if (to < from) continue;
    ranges.push({ start: from, end: to });
  }

  ranges.sort((left, right) => left.start - right.start);
  const merged: LineRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  return {
    ranges: merged,
    coveredLines: merged.reduce((total, range) => total + (range.end - range.start + 1), 0),
  };
}

/** True when the whole inclusive range was inside what was sent. */
function coversRange(ranges: readonly LineRange[], start: number, end: number): boolean {
  return ranges.some((range) => range.start <= start && range.end >= end);
}

/**
 * A file the model was sent less than all of.
 *
 * A file being selected is not the same as a file being fully shown, and a
 * finding that is missing from a partly-sent file is not evidence that the model
 * missed it in the code.
 */
export interface PartialContextFile {
  file: string;
  /** Lines the sent windows covered, merged. */
  coveredLines: number;
  fileLines: number;
  windows: LineRange[];
}

export interface GroundTruthDefect {
  id: string;
  /** One or more fixture paths, as the table states them. */
  files: string[];
  /**
   * The lines that show the defect, or null when the row records none.
   *
   * A null anchor means the file is the whole claim, which is the weaker thing
   * to state and is only correct for a defect that is not local to a line.
   */
  anchor: LineRange | null;
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
 * Reads an anchor cell: `29`, `12-25`, or `-` for none.
 *
 * A malformed anchor is treated as no anchor rather than as line zero, because
 * line zero would silently match nothing and turn a typo in the table into a
 * defect that can never be detected.
 */
export function parseAnchor(cell: string): LineRange | null {
  const trimmed = cell.trim();
  if (trimmed === "" || trimmed === "-") return null;

  const single = /^(\d+)$/.exec(trimmed);
  if (single !== null) {
    const line = Number.parseInt(single[1] ?? "", 10);
    return line >= 1 ? { start: line, end: line } : null;
  }

  const range = /^(\d+)\s*[-\u2013]\s*(\d+)$/.exec(trimmed);
  if (range !== null) {
    const start = Number.parseInt(range[1] ?? "", 10);
    const end = Number.parseInt(range[2] ?? "", 10);
    if (start >= 1 && end >= start) return { start, end };
  }

  return null;
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

    // The two tables have different shapes on purpose: a defect is local to an
    // anchor, while a negative control is about the whole file.
    if (/^D\d+$/.test(id)) {
      defects.push({
        id,
        files,
        anchor: parseAnchor(rest[0] ?? ""),
        defect: rest[1] ?? "",
        expectedSeverity: rest[2] ?? "",
      });
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
  /** The lines the table records for this defect, or null when it records none. */
  anchor: LineRange | null;
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
    /** truePositives / (truePositives + falsePositives). Null when nothing was reported. */
    precision: number | null;
    /** detectedDefects / plantedDefects. Null when the fixture plants none. */
    recall: number | null;
  };
  /** What the model stage reported about itself. Null when it did not run. */
  ai: AiAccuracy | null;
  /** The review's own state, when the report carried one. */
  reviewState: string | null;
  /** The review's own limitation codes, when the report carried them. */
  limitationCodes: string[];
  /** Files sent to the model with less than their whole content. */
  partialContext: PartialContextFile[];
}

/** The model stage's self-report, normalised. */
export interface AiAccuracy {
  attempted: number;
  valid: number;
  empty: number;
  partial: number;
  invalid: number;
  unavailable: number;
  entriesDropped: number;
  notSent: number;
  /** attempted / (attempted + notSent). Null when no reviewed file exists. */
  coverage: number | null;
}

/** Matches a reported path against a fixture path, whatever root it was named from. */
export function fileMatches(claimed: string, expected: string): boolean {
  const left = claimed.replace(/\\/g, "/");
  const right = expected.replace(/\\/g, "/").replace(/^\.\//, "");
  return left === right || left.endsWith(`/${right}`);
}

/**
 * True when a finding's range touches the defect's anchor.
 *
 * A null anchor is the file-level claim, so any finding on that file satisfies
 * it. A recorded anchor is intersected inclusively: a one-line report inside a
 * recorded range counts, and a report one line past it does not.
 */
export function anchorOverlaps(finding: NormalisedFinding, anchor: LineRange | null): boolean {
  if (anchor === null) return true;
  return finding.line <= anchor.end && finding.lineEnd >= anchor.start;
}

function anchorOf(finding: NormalisedFinding): string {
  return finding.lineEnd > finding.line
    ? `${finding.file}:${finding.line}-${finding.lineEnd}`
    : `${finding.file}:${finding.line}`;
}

export interface AiReportLike {
  attempted?: number;
  valid?: number;
  empty?: number;
  partial?: number;
  invalid?: number;
  unavailable?: number;
  entriesDropped?: number;
  entries_dropped?: number;
  notSent?: number;
  not_sent?: number;
}

/**
 * One dropped candidate as it arrives from a report or from the wire.
 *
 * `diagnostics` is where a refusal can be checked rather than believed: the
 * quotes the gate extracted and whether the file contained each one. That is the
 * difference between a claim that was made and could not be proved, and a claim
 * that was never quoted at all.
 */
export interface ReportRejectionLike {
  file?: string | undefined;
  line?: number | undefined;
  lineEnd?: number | undefined;
  line_end?: number | undefined;
  title?: string | undefined;
  reason?: string | undefined;
  detail?: string | undefined;
  diagnostics?:
    | {
        evidence?: string | undefined;
        quotes?: readonly string[] | undefined;
        quotesFound?: readonly boolean[] | undefined;
        usedFileReference?: boolean | undefined;
      }
    | undefined;
}

/** A numbered window that was sent to the model, as the trace records it. */
export interface ReportWindowLike {
  startLine?: number | undefined;
  endLine?: number | undefined;
}

/** What a call carried, in sizes and counts. Never prompt text. */
export interface ReportRequestTraceLike {
  maxFindings?: number | undefined;
  systemPromptBytes?: number | undefined;
  userPromptBytes?: number | undefined;
  fileLines?: number | undefined;
  contextWindows?: readonly ReportWindowLike[] | undefined;
  relatedFiles?: readonly string[] | undefined;
  changedLineCount?: number | undefined;
}

/** One candidate's journey, as the trace records it. */
export interface ReportCandidateTraceLike {
  requestedFile?: string | undefined;
  origin?: string | undefined;
  file?: string | undefined;
  line?: number | undefined;
  lineEnd?: number | undefined;
  validator?: string | undefined;
  rejectionReason?: string | undefined;
  finalOutcome?: string | undefined;
  findingId?: string | undefined;
  evidence?:
    | {
        quoteCount?: number | undefined;
        quotesFound?: readonly boolean[] | undefined;
        anchored?: boolean | null | undefined;
      }
    | undefined;
}

/**
 * One provider attempt, as the trace records it.
 *
 * Counts, identifiers and token totals only: no prompt, no response text and no
 * credential is ever part of it, which is what makes it safe to keep next to a
 * report and to commit as a fixture.
 */
export interface ReportAttemptLike {
  attempt?: number | undefined;
  latencyMs?: number | undefined;
  outcome?: string | undefined;
  status?: number | null | undefined;
  contentType?: string | null | undefined;
  requestId?: string | null | undefined;
  responseBytes?: number | null | undefined;
  responseId?: string | null | undefined;
  responseModel?: string | null | undefined;
  finishReason?: string | null | undefined;
  usage?:
    | { promptTokens?: number | null; completionTokens?: number | null; totalTokens?: number | null }
    | null
    | undefined;
}

/** The per-file record a run leaves when the caller asked for a trace. */
export interface ReportFileTraceLike {
  file: string;
  selected: boolean;
  sentToModel: boolean;
  /** True when the AI budget selected the file, whether or not it was sent. */
  selectedForModel?: boolean | undefined;
  modelOutcome?: string | undefined;
  /** Endpoint host that answered, when a call was made. */
  provider?: string | null | undefined;
  /** Model that was requested, when a call was made. */
  model?: string | null | undefined;
  modelErrorName?: string | undefined;
  request?: ReportRequestTraceLike | undefined;
  response?:
    | {
        provider?: string | null | undefined;
        model?: string | null | undefined;
        attempts?: readonly ReportAttemptLike[] | undefined;
      }
    | undefined;
  parser?:
    | {
        shape?: string | undefined;
        issues?: readonly string[] | undefined;
        entriesDropped?: number | undefined;
        candidateCount?: number | undefined;
      }
    | undefined;
  candidateDetails?: readonly ReportCandidateTraceLike[] | undefined;
  candidates?: { detector: number; ai: number } | undefined;
  findings?: number | undefined;
  rejections?: Record<string, number> | undefined;
}

export interface ReviewReportLike {
  findings: readonly ReportFindingLike[];
  /** The engine's own trace, when the run collected one. */
  trace?: readonly ReportFileTraceLike[] | undefined;
  rejected?: readonly unknown[] | undefined;
  stats?:
    | {
        candidatesProduced?: number;
        candidatesRejected?: number;
        duplicatesMerged?: number;
        rejectionsByReason?: Record<string, number>;
        aiReview?: AiReportLike | null | undefined;
      }
    | undefined;
  /** What the model stage produced, in the engine's own report shape. */
  aiReview?: AiReportLike | null | undefined;
  /** The wire contract's own name for the same tally, for a live response. */
  rejections_by_reason?: Record<string, number> | undefined;
  /** The wire contract's name for the dropped candidates. */
  rejected_candidates?: readonly unknown[] | undefined;
  /** The wire contract's copy of the model tally. */
  ai_review?: AiReportLike | null | undefined;
  /** `complete` / `partial` / `degraded` / `failed`, when the run recorded one. */
  state?: string | undefined;
  review_state?: string | undefined;
  limitations?: readonly { code: string; detail?: string }[] | undefined;
  review_limitations?: readonly { code: string; detail?: string }[] | undefined;
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

    // The right file is not enough: the reported range has to overlap the
    // recorded anchor. Crediting a claim because its file is interesting would
    // score how much the review knows about the fixture, not what it found in
    // the code — which is the one thing this measurement exists to prevent.
    const defects = truth.defects.filter(
      (candidate) =>
        candidate.files.some((file) => fileMatches(finding.file, file)) &&
        anchorOverlaps(finding, candidate.anchor),
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
    return { id: defect.id, files: defect.files, anchor: defect.anchor, detected: anchors.length > 0, anchors };
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
      precision: ratio(truePositives, truePositives + unsupported + onNegatives),
      recall: ratio(defects.filter((defect) => defect.detected).length, truth.defects.length),
    },
    ai: aiAccuracyOf(report),
    reviewState: report.state ?? report.review_state ?? null,
    limitationCodes: (report.limitations ?? report.review_limitations ?? []).map(
      (limitation) => limitation.code,
    ),
    partialContext: partialContextOf(report.trace ?? []),
  };
}

/**
 * Files that were sent to the model with only part of their content.
 *
 * It is read from the request record rather than from the selection: a file can
 * be selected, sent, and still be shown only as a window. A report that says
 * "sent" without saying "sent all of it" reads as a full review of that file, and
 * that is exactly the claim this measurement refuses to make.
 */
function partialContextOf(trace: readonly ReportFileTraceLike[]): PartialContextFile[] {
  const files: PartialContextFile[] = [];

  for (const entry of trace) {
    if (entry.sentToModel !== true) continue;

    const request = entry.request;
    const fileLines = request?.fileLines;
    if (typeof fileLines !== "number" || !Number.isFinite(fileLines) || fileLines <= 0) continue;

    const { ranges, coveredLines } = coverageOf(request?.contextWindows ?? [], fileLines);
    if (coveredLines >= fileLines) continue;

    files.push({ file: entry.file, coveredLines, fileLines, windows: ranges });
  }

  return files;
}

/** A rate, or null when there is nothing to divide by. Null is not zero. */
function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * The model stage's tally, accepted from either the engine's report or the wire,
 * so a saved run and a live response are measured by the same implementation.
 */
function aiAccuracyOf(report: ReviewReportLike): AiAccuracy | null {
  const source = report.stats?.aiReview ?? report.aiReview ?? report.ai_review;
  if (source === undefined || source === null) return null;

  const attempted = source.attempted ?? 0;
  const notSent = source.notSent ?? source.not_sent ?? 0;

  return {
    attempted,
    valid: source.valid ?? 0,
    empty: source.empty ?? 0,
    partial: source.partial ?? 0,
    invalid: source.invalid ?? 0,
    unavailable: source.unavailable ?? 0,
    entriesDropped: source.entriesDropped ?? source.entries_dropped ?? 0,
    notSent,
    coverage: ratio(attempted, attempted + notSent),
  };
}

/**
 * Where a defect's claim was last alive.
 *
 * `missed` is not one state but several, and they have different owners. A file
 * that was never sent is a selection bug, an unreadable answer is a parser or
 * provider problem, and a correct file with a valid answer and no claim in it is
 * the model's own miss. Reporting all of them as "0/9" is what made the last live
 * run unactionable.
 */
export type ClaimStage =
  | "detected"
  | "not-selected"
  | "not-sent"
  /** The file was sent, but the defect's lines were not among the lines shown. */
  | "context-truncated"
  | "model-unavailable"
  | "model-response-empty"
  | "model-response-invalid"
  /** The provider cut the answer off at the output cap, so nothing could be read. */
  | "model-response-truncated"
  | "parser-dropped"
  | "missing-evidence"
  | "evidence-mismatch"
  | "wrong-file"
  | "wrong-line"
  | "validator-rejected"
  | "dedupe"
  | "policy-rejected"
  | "model-missed"
  | "not-measured";

/** One candidate the model produced that covers a defect's anchor. */
export interface DefectCandidateRecord {
  anchor: string;
  /** File the model was asked about. */
  requestedFile: string;
  /** File the candidate claims. */
  claimedFile: string;
  /** True when the candidate answered about another file than the one it was shown. */
  answeredAnotherFile: boolean;
  validator: string | null;
  rejectionReason: string | null;
  finalOutcome: string | null;
  /** The quote-level comparison behind the verdict, when the trace recorded one. */
  evidence: { quoteCount: number; quotesFound: number; anchored: boolean | null } | null;
}

/** What the model was shown for a defect's file. */
export interface DefectContextRecord {
  file: string;
  fileLines: number;
  windows: LineRange[];
  coveredLines: number;
  coversWholeFile: boolean;
  /** True when every line of the defect's anchor was inside what was sent. */
  coversAnchor: boolean;
}

export interface DefectDiagnosis {
  id: string;
  files: string[];
  anchor: LineRange | null;
  /** Null when the run left no trace, so selection cannot be stated either way. */
  selected: boolean | null;
  sentToModel: boolean | null;
  /** `valid` / `empty` / `partial` / `invalid` / `unavailable`, when known. */
  modelOutcome: string | null;
  /** Candidates from every stage that named the defect's file and were dropped. */
  candidatesOnFile: string[];
  /** Candidates the model produced that cover this defect's anchor. */
  mentionedCandidates: DefectCandidateRecord[];
  /** True when one covers the anchor. Null when the trace kept no candidate list. */
  mentioned: boolean | null;
  /** What was sent for this defect's file, or null when the trace does not say. */
  context: DefectContextRecord | null;
  /** Answer entries the parser discarded for this defect's file, or null when unknown. */
  parserDroppedEntries: number | null;
  /** True when the provider ended the answer at the output cap. Null when unknown. */
  truncated: boolean | null;
  claimDied: ClaimStage;
  /** The anchors and reasons behind the verdict, safe to show. */
  detail: string;
}

/**
 * Reads one rejected candidate, or null when it has no readable anchor.
 *
 * A candidate with no anchor is still evidence that the model said something
 * about a file, so the file is kept even when the lines are not.
 */
function rejectionLike(raw: unknown): { candidate: NormalisedFinding | null; file: string; record: ReportRejectionLike } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as ReportRejectionLike;
  const file = typeof record.file === "string" ? record.file : "";
  if (file === "") return null;

  const line = record.line;
  if (typeof line !== "number" || !Number.isFinite(line)) return { candidate: null, file, record };

  const rawEnd = record.lineEnd ?? record.line_end ?? line;
  return {
    candidate: {
      title: record.title ?? "",
      file,
      line,
      lineEnd: Number.isFinite(rawEnd) ? Math.max(rawEnd, line) : line,
      severity: null,
    },
    file,
    record,
  };
}

function anchorLabel(candidate: NormalisedFinding): string {
  return candidate.lineEnd > candidate.line
    ? `${candidate.file}:${candidate.line}-${candidate.lineEnd}`
    : `${candidate.file}:${candidate.line}`;
}

/**
 * Turns a rejection into the stage the claim died at and a readable reason.
 *
 * The mapping is deliberately one-way: the engine's rejection vocabulary decides,
 * and nothing here re-interprets a claim into a finding. It is shared by the
 * rejection list and by the trace's own candidate record, so the same claim is
 * described the same way whichever artifact it was read from.
 */
function stageFor(
  reason: string | undefined,
  input: {
    quoteCount: number;
    /** Quotes that were looked for and found in the reviewed file. */
    quotesFound: number;
    usedFileReference?: boolean | undefined;
    detail?: string | undefined;
  },
): { stage: ClaimStage; detail: string } {
  switch (reason) {
    case "merged-duplicate":
      return { stage: "dedupe", detail: "the same defect was already kept from another candidate" };
    case "over-finding-cap":
      return { stage: "policy-rejected", detail: "cleared the bar but fell outside the report's cap" };
    case "evidence-not-in-source": {
      // Nothing quoted is a claim with no evidence; quotes that were looked for and
      // not found is a claim whose evidence is wrong. Different failures, different
      // fixes, so they are not merged into one.
      if (input.quoteCount === 0) {
        return {
          stage: "missing-evidence",
          detail:
            input.usedFileReference === true
              ? "nothing was quoted, so a file reference decided and the gate refused it"
              : "the candidate quoted nothing that could be checked against the source",
        };
      }
      return {
        stage: "evidence-mismatch",
        detail: `${input.quoteCount} quote(s) checked, ${input.quotesFound} found in the reviewed file`,
      };
    }
    case "file-not-in-scope":
      return { stage: "wrong-file", detail: "the candidate named a file the review did not cover" };
    case "missing-field":
      return { stage: "missing-evidence", detail: input.detail ?? "a required field was absent" };
    case "line-out-of-range":
    case "invalid-location":
      return { stage: "wrong-line", detail: input.detail ?? "the anchor was not inside the file" };
    case "anchor-outside-changed-lines":
      return { stage: "validator-rejected", detail: "the anchor was not on a line this change touched" };
    default:
      return { stage: "validator-rejected", detail: input.detail ?? `rejected as ${reason ?? "unknown"}` };
  }
}

function stageForRejection(record: ReportRejectionLike): { stage: ClaimStage; detail: string } {
  const diagnostics = record.diagnostics;
  const quotes = diagnostics?.quotes ?? [];
  const found = (diagnostics?.quotesFound ?? []).filter((entry) => entry === true).length;

  return stageFor(record.reason, {
    quoteCount: quotes.length,
    quotesFound: found,
    ...(diagnostics?.usedFileReference === undefined ? {} : { usedFileReference: diagnostics.usedFileReference }),
    ...(record.detail === undefined ? {} : { detail: record.detail }),
  });
}

/**
 * The stage a trace-recorded candidate died at, from the candidate's own record.
 *
 * A candidate that was accepted and still not credited is an anomaly rather than a
 * stage, and it is reported as one instead of being folded into a nearby reason.
 */
function stageForCandidate(record: DefectCandidateRecord): { stage: ClaimStage; detail: string } {
  if (record.finalOutcome === "dedupe") {
    return { stage: "dedupe", detail: "the same defect was already kept from another candidate" };
  }
  if (record.finalOutcome === "policy-rejected") {
    return { stage: "policy-rejected", detail: "cleared the bar but fell outside the report's cap" };
  }
  if (record.validator === "accepted") {
    return {
      stage: "not-measured",
      detail: "an accepted candidate covers this anchor, but the scorer did not credit it as a finding",
    };
  }

  return stageFor(record.rejectionReason ?? undefined, {
    quoteCount: record.evidence?.quoteCount ?? 0,
    quotesFound: record.evidence?.quotesFound ?? 0,
  });
}

/** The candidates the trace recorded on a defect's own lines. */
function candidateRecords(fileTrace: ReportFileTraceLike, defect: GroundTruthDefect): DefectCandidateRecord[] {
  const records: DefectCandidateRecord[] = [];

  for (const raw of fileTrace.candidateDetails ?? []) {
    const claimed = raw.file ?? "";
    const line = raw.line;
    if (claimed === "" || typeof line !== "number" || !Number.isFinite(line)) continue;

    // A claim counts as mentioning the defect only when it is about the defect's
    // own file: a candidate that named another file was never a claim about this
    // code, and crediting it here would be the file-level mistake all over again.
    if (!defect.files.some((file) => fileMatches(claimed, file))) continue;

    const rawEnd = raw.lineEnd ?? line;
    const lineEnd = Number.isFinite(rawEnd) ? Math.max(rawEnd, line) : line;
    const candidate: NormalisedFinding = { title: "", file: claimed, line, lineEnd, severity: null };
    if (!anchorOverlaps(candidate, defect.anchor)) continue;

    const quoted = raw.evidence?.quotesFound ?? [];
    const requestedFile = raw.requestedFile ?? fileTrace.file;
    records.push({
      anchor: anchorLabel(candidate),
      requestedFile,
      claimedFile: claimed,
      // The model answered about a file other than the one the call was for.
      answeredAnotherFile: !fileMatches(claimed, requestedFile),
      validator: raw.validator ?? null,
      rejectionReason: raw.rejectionReason ?? null,
      finalOutcome: raw.finalOutcome ?? null,
      evidence:
        raw.evidence === undefined
          ? null
          : {
              quoteCount: raw.evidence.quoteCount ?? quoted.length,
              quotesFound: quoted.filter((entry) => entry === true).length,
              anchored: raw.evidence.anchored ?? null,
            },
    });
  }

  return records;
}

/** What the model was shown for a defect's file, when the trace recorded it. */
function contextRecord(fileTrace: ReportFileTraceLike, defect: GroundTruthDefect): DefectContextRecord | null {
  const fileLines = fileTrace.request?.fileLines;
  if (typeof fileLines !== "number" || !Number.isFinite(fileLines) || fileLines <= 0) return null;

  const { ranges, coveredLines } = coverageOf(fileTrace.request?.contextWindows ?? [], fileLines);
  const coversWholeFile = coveredLines >= fileLines;

  return {
    file: fileTrace.file,
    fileLines,
    windows: ranges,
    coveredLines,
    coversWholeFile,
    // A file-level defect (no recorded anchor) is only covered by the whole file.
    coversAnchor:
      defect.anchor === null ? coversWholeFile : coversRange(ranges, defect.anchor.start, defect.anchor.end),
  };
}

/** "lines L1-200 of 900" — what was sent, in the words a reviewer would use. */
function describeContext(context: DefectContextRecord): string {
  const ranges = context.windows.map((range) => `L${range.start}-${range.end}`).join(", ");
  return `${ranges === "" ? "no lines" : `lines ${ranges}`} of ${context.fileLines}`;
}

/**
 * Explains, per planted defect, where its claim stopped being alive.
 *
 * Detection is taken from `evaluateReview` rather than recomputed, so the score
 * and the explanation can never disagree about the same run. Everything else is
 * read from what the run recorded: the file trace says whether the file was
 * selected and sent and what the model's answer was, and the rejected candidates
 * say whether a claim existed and what evidence the gate found behind it.
 *
 * A defect is never credited here that the scorer did not credit: this function
 * answers "why", not "how many".
 */
export function diagnoseReview(report: ReviewReportLike, truth: GroundTruth): DefectDiagnosis[] {
  const evaluation = evaluateReview(report, truth);
  const rejected = (report.rejected ?? report.rejected_candidates ?? [])
    .map(rejectionLike)
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const trace = report.trace ?? [];

  return truth.defects.map((defect) => {
    const outcome = evaluation.defects.find((entry) => entry.id === defect.id);
    const fileTrace = trace.find((entry) => defect.files.some((file) => fileMatches(entry.file, file)));
    const onFile = rejected.filter((entry) => defect.files.some((file) => fileMatches(entry.file, file)));

    const mentionedCandidates = fileTrace === undefined ? [] : candidateRecords(fileTrace, defect);
    const context = fileTrace === undefined ? null : contextRecord(fileTrace, defect);
    const attempts = fileTrace?.response?.attempts ?? [];
    const lastAttempt = attempts[attempts.length - 1] ?? null;

    const base = {
      id: defect.id,
      files: defect.files,
      anchor: defect.anchor,
      selected: fileTrace?.selected ?? null,
      sentToModel: fileTrace?.sentToModel ?? null,
      modelOutcome: fileTrace?.modelOutcome ?? null,
      candidatesOnFile: onFile.map((entry) =>
        entry.candidate === null ? `${entry.file}:? (${entry.record.reason ?? "unknown"})` : `${anchorLabel(entry.candidate)} (${entry.record.reason ?? "unknown"})`,
      ),
      mentionedCandidates,
      // An absent candidate list is not the same as a list that contains nothing:
      // the first cannot support the claim that the model said nothing.
      mentioned: fileTrace === undefined || fileTrace.candidateDetails === undefined ? null : mentionedCandidates.length > 0,
      context,
      parserDroppedEntries: fileTrace?.parser?.entriesDropped ?? null,
      truncated: lastAttempt === null ? null : lastAttempt.finishReason === "length",
    };

    if (outcome?.detected === true) {
      return { ...base, claimDied: "detected", detail: `reported at ${outcome.anchors.join(", ")}` };
    }

    // A candidate on the defect's own lines is the most informative refusal: the
    // model found the place and the gate decided the claim behind it.
    const overlapping = onFile.find(
      (entry) => entry.candidate !== null && anchorOverlaps(entry.candidate, defect.anchor),
    );
    if (overlapping !== undefined && overlapping.candidate !== null) {
      const { stage, detail } = stageForRejection(overlapping.record);
      return { ...base, claimDied: stage, detail: `${anchorLabel(overlapping.candidate)} — ${detail}` };
    }

    // The trace's own candidate list answers the same question when the rejection
    // list is absent: a saved trace artifact, or a report read back from the wire.
    const nearest = mentionedCandidates[0];
    if (nearest !== undefined) {
      const { stage, detail } = stageForCandidate(nearest);
      const drift = nearest.answeredAnotherFile
        ? ` (answered about ${nearest.claimedFile} while ${nearest.requestedFile} was the file sent)`
        : "";
      return { ...base, claimDied: stage, detail: `${nearest.anchor} — ${detail}${drift}` };
    }

    // Otherwise: candidates existed on the file but not where the defect lives.
    if (onFile.length > 0) {
      return {
        ...base,
        claimDied: "wrong-line",
        detail: `the file was claimed at ${base.candidatesOnFile.join(", ")}, none of which cover the defect's lines`,
      };
    }

    if (fileTrace === undefined) {
      return {
        ...base,
        claimDied: "not-measured",
        detail: "the run left no per-file trace, so this defect cannot be explained from the report alone",
      };
    }
    if (!fileTrace.selected) {
      return { ...base, claimDied: "not-selected", detail: "selection did not keep this file for review" };
    }
    if (!fileTrace.sentToModel) {
      return { ...base, claimDied: "not-sent", detail: "the file was selected but never sent to the model" };
    }

    // Silence from a model that never saw the defect's lines is not a miss in the
    // code, and it must not be read as one.
    if (context !== null && !context.coversAnchor) {
      return {
        ...base,
        claimDied: "context-truncated",
        detail: `the model was shown ${describeContext(context)}, and the defect's lines were not among them`,
      };
    }

    // Entries the parser dropped before their anchor could be read are counted, so
    // a claim that never arrived is reported as a parse loss rather than as the
    // model's silence.
    if (base.parserDroppedEntries !== null && base.parserDroppedEntries > 0) {
      return {
        ...base,
        claimDied: "parser-dropped",
        detail: `${base.parserDroppedEntries} entr(ies) in this file's answer were unusable and discarded before validation`,
      };
    }

    // An answer the provider ended at the output cap is a request that was too
    // small to hold a review, and it is reported as that rather than as the
    // model's own failure to produce one.
    if (base.truncated === true) {
      const completionTokens = lastAttempt?.usage?.completionTokens;
      const budget =
        completionTokens === null || completionTokens === undefined ? "" : `, ${completionTokens} completion tokens`;
      return {
        ...base,
        claimDied: "model-response-truncated",
        detail: `the answer was cut off at the output cap (finish_reason=length${budget}), so nothing in it could be read as a review`,
      };
    }

    switch (fileTrace.modelOutcome) {
      case "unavailable":
        return { ...base, claimDied: "model-unavailable", detail: "the provider produced no answer for this file" };
      case "invalid":
        return { ...base, claimDied: "model-response-invalid", detail: "the answer could not be read as a review" };
      case "empty":
        return { ...base, claimDied: "model-response-empty", detail: "the model answered with no findings for this file" };
      case "partial":
        return { ...base, claimDied: "parser-dropped", detail: "the answer was readable only in part, this file among the dropped entries" };
      case "valid":
        return {
          ...base,
          claimDied: "model-missed",
          detail:
            context === null || context.coversWholeFile
              ? "the model answered readably about this file and claimed nothing in it"
              : `the model answered readably and claimed nothing; it was shown ${describeContext(context)}`,
        };
      default:
        return {
          ...base,
          claimDied: "not-measured",
          detail: `no model outcome was recorded for ${fileTrace.file}`,
        };
    }
  });
}

/** The diagnosis as data, for a trace artifact. */
export function diagnosisToJson(rows: readonly DefectDiagnosis[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    id: row.id,
    file: row.files.join(", "),
    anchor: row.anchor === null ? null : `${row.anchor.start}-${row.anchor.end}`,
    selected: row.selected,
    sent_to_model: row.sentToModel,
    model_outcome: row.modelOutcome,
    mentioned: row.mentioned,
    mentioned_candidates: row.mentionedCandidates.map((candidate) => ({
      anchor: candidate.anchor,
      requested_file: candidate.requestedFile,
      claimed_file: candidate.claimedFile,
      answered_another_file: candidate.answeredAnotherFile,
      validator: candidate.validator,
      rejection_reason: candidate.rejectionReason,
      final_outcome: candidate.finalOutcome,
      evidence: candidate.evidence,
    })),
    parser_dropped_entries: row.parserDroppedEntries,
    truncated: row.truncated,
    context:
      row.context === null
        ? null
        : {
            file: row.context.file,
            windows: row.context.windows,
            covered_lines: row.context.coveredLines,
            file_lines: row.context.fileLines,
            covers_whole_file: row.context.coversWholeFile,
            covers_anchor: row.context.coversAnchor,
          },
    candidates_on_file: row.candidatesOnFile,
    claim_died: row.claimDied,
    detail: row.detail,
  }));
}

/**
 * The diagnosis as one line per defect, so a run can be read from a log.
 *
 * A short line is the whole point: `MODEL_MISSED` and `EVIDENCE_MISMATCH` are the
 * same zero in a summary and two different jobs in this table.
 */
export function formatDiagnosis(rows: readonly DefectDiagnosis[]): string {
  const lines = ["Defect diagnosis (where each claim stopped)"];
  for (const row of rows) {
    const sent = row.sentToModel === null ? "?" : row.sentToModel ? "yes" : "no";
    const anchor = row.anchor === null ? "any line" : `L${row.anchor.start}-${row.anchor.end}`;
    lines.push(`  ${row.id.padEnd(3)} sent=${sent.padEnd(3)} outcome=${(row.modelOutcome ?? "-").padEnd(11)} ${anchor.padEnd(10)} ${row.claimDied}`);
    lines.push(`      ${row.detail}`);

    if (row.context !== null) {
      const whole = row.context.coversWholeFile ? ", the whole file" : "";
      lines.push(`      context: ${describeContext(row.context)}${whole}`);
    }
    for (const candidate of row.mentionedCandidates) {
      const evidence =
        candidate.evidence === null
          ? "no evidence record"
          : `${candidate.evidence.quotesFound}/${candidate.evidence.quoteCount} quote(s) found`;
      const reason = candidate.rejectionReason === null ? "" : `: ${candidate.rejectionReason}`;
      lines.push(
        `      candidate: ${candidate.anchor} (${candidate.validator ?? "?"}${reason}, ${candidate.finalOutcome ?? "?"}, ${evidence})`,
      );
    }
    if (row.parserDroppedEntries !== null && row.parserDroppedEntries > 0) {
      lines.push(`      parser dropped ${row.parserDroppedEntries} entr(ies) of this file's answer`);
    }
  }
  return lines.join("\n");
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
    review_state: evaluation.reviewState,
    limitations: evaluation.limitationCodes,
    partial_context: evaluation.partialContext.map((entry) => ({
      file: entry.file,
      covered_lines: entry.coveredLines,
      file_lines: entry.fileLines,
      windows: entry.windows,
    })),
    ai: evaluation.ai,
    totals: evaluation.totals,
  };
}

/** A rate as a percentage, or `n/a` when it is not measurable. Null is not zero. */
function formatRate(rate: number | null): string {
  return rate === null ? "n/a" : `${Math.round(rate * 100)}%`;
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
    const expected = defect.anchor === null ? "any line" : `L${defect.anchor.start}-${defect.anchor.end}`;
    lines.push(
      `  ${defect.id.padEnd(3)} ${verdict}  ${defect.files.join(", ")}  ${defect.anchors.join(", ") || "-"}  [expected ${expected}]`,
    );
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

  lines.push("Review");
  lines.push(`  state: ${evaluation.reviewState ?? "not recorded"}`);
  lines.push(
    `  limitations: ${evaluation.limitationCodes.length === 0 ? "none" : evaluation.limitationCodes.join(" ")}`,
  );
  if (evaluation.ai === null) {
    lines.push("  model stage: did not run");
  } else {
    const ai = evaluation.ai;
    lines.push(
      `  model stage: ${ai.attempted} call(s) — valid=${ai.valid} empty=${ai.empty} partial=${ai.partial} ` +
        `invalid=${ai.invalid} unavailable=${ai.unavailable} entries-dropped=${ai.entriesDropped} not-sent=${ai.notSent} ` +
        `coverage=${formatRate(ai.coverage)}`,
    );
  }

  if (evaluation.partialContext.length > 0) {
    lines.push("Partial context sent to the model");
    for (const entry of evaluation.partialContext) {
      lines.push(`  ${entry.file}: ${entry.coveredLines} of ${entry.fileLines} lines`);
    }
  }

  lines.push("Totals");
  lines.push(
    `  defects ${totals.detectedDefects}/${totals.plantedDefects} detected, ` +
      `TP=${totals.truePositives} FP=${totals.falsePositives} ` +
      `(unsupported=${totals.unsupported} on-negative-controls=${totals.falsePositiveOnNegatives}) ` +
      `FN=${totals.falseNegatives} duplicate-anchors=${totals.duplicateAnchors} unanchorable=${totals.unanchorable}`,
  );
  lines.push(`  precision=${formatRate(totals.precision)} recall=${formatRate(totals.recall)}`);
  if (evaluation.missedDefectIds.length > 0) {
    lines.push(`  missed: ${evaluation.missedDefectIds.join(", ")} of ${truth.defects.length}`);
  }

  return lines.join("\n");
}
