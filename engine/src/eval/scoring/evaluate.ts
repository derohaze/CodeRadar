/**
 * Scoring a report against the fixture's ground truth.
 *
 * A review run produces a report, and a report is not a score. The only way to
 * know whether the engine is getting better is to compare a run against what is
 * actually wrong in the fixture: which planted defects it surfaced, which it
 * missed, and which findings it produced that nothing supports.
 *
 * One rule keeps the score honest: a finding is only a true positive when the file
 * it names is the file the defect lives in. Anchors are reported next to the
 * verdict so a human can check the line, but the score itself does not pretend to
 * know the exact line the fixture author meant.
 */

import { coverageOf, type LineRange } from "../coverage.ts";
import type { GroundTruth } from "../ground-truth/parse.ts";
import {
  anchorOverlaps,
  fileMatches,
  normaliseFinding,
  type AiReportLike,
  type NormalisedFinding,
  type ReportFileTraceLike,
  type ReviewReportLike,
} from "../report/contract.ts";

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

function anchorOf(finding: NormalisedFinding): string {
  return finding.lineEnd > finding.line
    ? `${finding.file}:${finding.line}-${finding.lineEnd}`
    : `${finding.file}:${finding.line}`;
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
  const source: AiReportLike | null | undefined = report.stats?.aiReview ?? report.aiReview ?? report.ai_review;
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
