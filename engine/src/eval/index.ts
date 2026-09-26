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
 *
 * The roles behind this surface are separate modules, one reason to change each:
 *
 * - `ground-truth/parse.ts` — the fixture's document read into defects and
 *   negative controls.
 * - `report/contract.ts` — the boundary: what a report may look like when this
 *   package did not produce it, derived from the review contract itself.
 * - `scoring/evaluate.ts` — a report plus the ground truth, classified into
 *   verdicts, totals and precision/recall.
 * - `scoring/diagnose.ts` — per planted defect, the stage at which its claim
 *   stopped being alive.
 * - `report/json.ts` and `report/text.ts` — the same two answers as data and as
 *   a log a person reads.
 * - `coverage.ts` — the one implementation of "how much of the file was sent",
 *   shared by the score and the diagnosis so they cannot disagree.
 *
 * Import from here, not from a file inside: the roles are free to move, and a
 * harness that scores a run should not have to know which module its answer lives
 * in.
 */

// The coverage measurement stays internal to the eval package: the score and the
// diagnosis read it through `evaluateReview`, and nothing outside needs the math.
export type { LineRange } from "./coverage.ts";

export { parseAnchor, parseGroundTruth } from "./ground-truth/parse.ts";
export type { GroundTruth, GroundTruthDefect, GroundTruthNegativeControl } from "./ground-truth/parse.ts";

export {
  anchorOverlaps,
  fileMatches,
  normaliseFinding,
  readReviewReport,
} from "./report/contract.ts";
export type {
  AiReportLike,
  NormalisedFinding,
  ReportAttemptLike,
  ReportCandidateTraceLike,
  ReportFileTraceLike,
  ReportFindingLike,
  ReportLimitationLike,
  ReportRejectionLike,
  ReportRequestTraceLike,
  ReportStatsLike,
  ReportWindowLike,
  ReviewReportLike,
  Untrusted,
} from "./report/contract.ts";

export { evaluateReview } from "./scoring/evaluate.ts";
export type {
  AiAccuracy,
  CandidateCounts,
  ClassifiedFinding,
  DefectOutcome,
  FindingVerdict,
  NegativeOutcome,
  PartialContextFile,
  ReviewEvaluation,
} from "./scoring/evaluate.ts";

export { diagnoseReview } from "./scoring/diagnose.ts";
export type {
  ClaimStage,
  DefectCandidateRecord,
  DefectContextRecord,
  DefectDiagnosis,
} from "./scoring/diagnose.ts";

export { diagnosisToJson, evaluationToJson } from "./report/json.ts";
export { formatDiagnosis, formatEvaluation } from "./report/text.ts";
