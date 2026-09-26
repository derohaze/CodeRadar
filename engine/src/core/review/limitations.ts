/**
 * Turning what a run observed into limitations and a review state.
 *
 * This is the honesty layer of the pipeline. A review that could not read a file,
 * or could not read the model's answer, must not be presentable as a review that
 * read everything and found nothing — those two need opposite responses, and the
 * difference is not visible in a findings count.
 *
 * Two rules keep the mapping stable:
 *
 * - Limitations are built only from facts the run recorded. A limitation is never
 *   inferred from an absence, so a stage that was not asked to run produces no
 *   limitation.
 * - The state is a pure function of the limitations and the model summary. It is
 *   never derived from `findings.length`, because zero findings is exactly the
 *   case that cannot be told apart by counting.
 */

import type {
  AiReviewSummary,
  ReviewLimitation,
  ReviewLimitationCode,
  ReviewReport,
  ReviewState,
} from "../findings/model.ts";

/**
 * A model was asked for and none could run.
 *
 * Worded for the person reading the result: what was skipped and what is not
 * covered as a consequence.
 */
export const AI_UNAVAILABLE_DETAIL =
  "The model did not review this run, so every finding comes from the deterministic checks. Cross-file and intent-level defects are not covered.";

/** A model was left out on purpose. It narrows the review; it is not a failure. */
export const AI_NOT_REQUESTED_DETAIL =
  "The model was not part of this run by request, so every finding comes from the deterministic checks. Cross-file and intent-level defects are not covered.";

export interface LimitationInput {
  /** What the model stage produced, or null when no reviewer was configured. */
  ai: AiReviewSummary | null;
  filesDiscovered: number;
  filesReviewed: number;
  indexContentUnavailable: boolean;
  indexTruncatedFiles: number;
  diffAware: boolean;
  baseBranch: string | null;
}

/** "2 files" / "1 file", for a sentence a person reads. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Every limitation the run can honestly report, in a fixed order.
 *
 * The order is stable so two runs with the same problems render the same way; a
 * list that reorders itself hides a change behind identical-looking output.
 */
export function collectLimitations(input: LimitationInput): ReviewLimitation[] {
  const limitations: ReviewLimitation[] = [];
  const ai = input.ai;

  if (ai !== null) {
    if (ai.attempted === 0 && ai.notSent > 0) {
      limitations.push({ code: "ai-unavailable", detail: AI_UNAVAILABLE_DETAIL });
    }
    if (ai.unavailable > 0) {
      limitations.push({
        code: "ai-provider-unavailable",
        count: ai.unavailable,
        detail: `${plural(ai.unavailable, "model call")} did not produce a response, so ${plural(
          ai.unavailable,
          "file",
        )} was reviewed by the deterministic checks alone.`,
      });
    }
    if (ai.invalid > 0) {
      limitations.push({
        code: "ai-response-invalid",
        count: ai.invalid,
        detail: `${plural(ai.invalid, "model response")} could not be read as a review, so ${plural(
          ai.invalid,
          "file",
        )} was checked deterministically only.`,
      });
    }
    if (ai.entriesDropped > 0) {
      limitations.push({
        code: "ai-entries-dropped",
        count: ai.entriesDropped,
        detail: `${plural(ai.entriesDropped, "model finding")} was unusable and was discarded before validation.`,
      });
    }
    if (ai.notSent > 0 && input.filesReviewed > 0) {
      limitations.push({
        code: "ai-coverage-incomplete",
        count: ai.notSent,
        detail: `${plural(ai.notSent, "reviewed file")} was not sent to the model, so it was checked deterministically only.`,
      });
    }
  }

  if (input.filesReviewed < input.filesDiscovered) {
    limitations.push({
      code: "coverage-incomplete",
      count: input.filesDiscovered - input.filesReviewed,
      detail: `${input.filesReviewed} of ${input.filesDiscovered} discovered files were reviewed; the rest were outside the selected scope or beyond the review budget.`,
    });
  }
  if (input.indexContentUnavailable) {
    limitations.push({
      code: "index-content-unavailable",
      detail: "File contents were unavailable, so route, auth, and sink markers could not be counted.",
    });
  }
  if (input.indexTruncatedFiles > 0) {
    limitations.push({
      code: "index-truncated-files",
      count: input.indexTruncatedFiles,
      detail: `${plural(input.indexTruncatedFiles, "file")} too large to index in full.`,
    });
  }
  if (input.diffAware) {
    limitations.push({
      code: "diff-scoped",
      detail: `Findings are anchored to lines changed against ${input.baseBranch ?? "the base branch"}; the other files in scope were still reviewed in full.`,
    });
  }

  return limitations;
}

/**
 * Codes that mean a stage did not produce a judgement at all.
 *
 * These are the difference between "no defect was found" and "no search was
 * made", so they degrade the review rather than narrowing it.
 */
const DEGRADING: ReadonlySet<ReviewLimitationCode> = new Set([
  "ai-unavailable",
  "ai-provider-unavailable",
  "ai-response-invalid",
]);

/**
 * Codes that narrow the review without breaking it.
 *
 * `diff-scoped` is deliberately absent: it is a documented scope the caller
 * asked for, not something that went wrong.
 */
const NARROWING: ReadonlySet<ReviewLimitationCode> = new Set([
  "ai-not-requested",
  "ai-entries-dropped",
  "ai-coverage-incomplete",
  "coverage-incomplete",
  "index-content-unavailable",
  "index-truncated-files",
]);

/**
 * The order limitations are reported in: what a stage failed to do first, then
 * what narrowed the scope, then the scope the caller asked for.
 */
const CANONICAL_ORDER: readonly ReviewLimitationCode[] = [
  "ai-unavailable",
  "ai-provider-unavailable",
  "ai-response-invalid",
  "ai-not-requested",
  "ai-entries-dropped",
  "ai-coverage-incomplete",
  "coverage-incomplete",
  "index-content-unavailable",
  "index-truncated-files",
  "diff-scoped",
];

/**
 * A report with one more limitation, and a state recomputed from the whole list.
 *
 * Some limitations are only knowable outside the engine — whether the caller
 * asked for the model is an app-level fact — so the engine cannot be the only
 * place that adds them. Adding one here keeps a single derivation of the state
 * and a single ordering, so the list reads the same however it was assembled.
 */
export function withLimitation(report: ReviewReport, limitation: ReviewLimitation): ReviewReport {
  if (report.limitations.some((existing) => existing.code === limitation.code)) return report;

  const limitations = [...report.limitations, limitation].sort(
    (left, right) => CANONICAL_ORDER.indexOf(left.code) - CANONICAL_ORDER.indexOf(right.code),
  );

  return { ...report, limitations, state: resolveReviewState(limitations) };
}

/**
 * The review state implied by the limitations actually recorded.
 *
 * Nothing here looks at the findings. A run that found nothing and read
 * everything is `complete`; a run that found nothing because a stage did not run
 * is `degraded`, and the two must never collapse into one word.
 */
export function resolveReviewState(limitations: readonly ReviewLimitation[]): ReviewState {
  if (limitations.some((limitation) => DEGRADING.has(limitation.code))) return "degraded";
  if (limitations.some((limitation) => NARROWING.has(limitation.code))) return "partial";
  return "complete";
}
