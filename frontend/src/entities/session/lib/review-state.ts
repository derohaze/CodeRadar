import type { ReviewLimitationSummary, ReviewState } from "@/shared/api";

/**
 * Reading a review's own state.
 *
 * A review reports nothing in two very different situations: the code was read
 * and is clean, or a stage did not run. Those need opposite responses, and the
 * findings count cannot tell them apart — which is why the state is a field the
 * engine records rather than something this module infers.
 *
 * The one rule here: only `"complete"` may be presented as a finished review. A
 * missing state, a partial review and a failed one all mean "do not claim the
 * code is clean".
 */

/** True only for a review that read everything and answered for every stage. */
export function isReviewComplete(state: ReviewState | null): boolean {
  return state === "complete";
}

/**
 * The state as a short label.
 *
 * A null state reads as unreported rather than complete, because an engine that
 * did not say has not said anything.
 */
export function getReviewStateLabel(state: ReviewState | null): string {
  switch (state) {
    case "complete":
      return "Complete review";
    case "partial":
      return "Reviewed with limitations";
    case "degraded":
      return "Review incomplete";
    case "failed":
      return "Review did not complete";
    default:
      return "Review completeness not reported";
  }
}

/** The heading a limitation is filed under, keyed by the engine's own code. */
const LIMITATION_LABELS: Record<string, string> = {
  "ai-unavailable": "The model did not run",
  "ai-provider-unavailable": "The model did not answer",
  "ai-response-invalid": "A model answer could not be read",
  "ai-not-requested": "The model was left out of this run",
  "ai-entries-dropped": "Some model findings were unusable",
  "ai-coverage-incomplete": "Part of the scope was not sent to the model",
  "coverage-incomplete": "Part of the scope was not reviewed",
  "index-content-unavailable": "File contents were unavailable",
  "index-truncated-files": "Some files were too large to index",
  "diff-scoped": "Anchored to the changed lines",
};

/** A limitation's heading. Unknown codes are de-slugged rather than hidden. */
export function getLimitationLabel(code: string): string {
  return LIMITATION_LABELS[code] ?? code.replace(/-/g, " ");
}

/**
 * True when a stage failed rather than the scope simply being narrower.
 *
 * The distinction decides the wording: a request the system could not serve is a
 * gap to fix, while a narrower scope was chosen. Saying one when the other is
 * true is how a user learns to distrust the report.
 */
export function isDegraded(state: ReviewState | null): boolean {
  return state === "degraded" || state === "failed";
}

/**
 * One sentence for the top of the results screen.
 *
 * It never states that the code is clean: the whole reason this exists is that a
 * limitations-only review must not read like a passed one.
 */
export function describeReviewCompleteness(state: ReviewState | null, limitations: readonly ReviewLimitationSummary[]): string {
  if (state === "complete") {
    return "Every file in the selected scope was read, and every model answer could be read.";
  }

  const first = limitations[0];
  const lead = isDegraded(state)
    ? "This review is incomplete, so a missing finding is not evidence of clean code."
    : "This review covered less than the full scope.";

  return first === undefined ? lead : `${lead} ${first.detail}`;
}
