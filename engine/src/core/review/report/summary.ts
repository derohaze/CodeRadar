/**
 * What a report says about itself, in prose.
 *
 * A model's own summary is not enough here: a model that never read a file cannot
 * describe the review, and the deterministic sentence must not read like a clean
 * bill of health either. Both are augmented with the state, so a run with zero
 * findings behind a broken stage cannot read as clean code.
 */

import type { ReviewFinding, ReviewScope, ReviewState, ReviewStats } from "../../findings/model.ts";

const INCOMPLETE_NOTICE: Record<Exclude<ReviewState, "complete">, string> = {
  partial: "The review covered less than the full scope; see the recorded limitations.",
  degraded:
    "This review is incomplete: a stage did not produce a result, so a missing finding is not evidence of clean code.",
  failed: "The review did not complete, so this result is not a statement about the code.",
};

export function buildSummary(
  findings: readonly ReviewFinding[],
  scope: ReviewScope,
  stats: ReviewStats,
  aiSummary: string | null,
  state: ReviewState,
): string {
  const notice = state === "complete" ? "" : INCOMPLETE_NOTICE[state];
  const body =
    aiSummary !== null && aiSummary !== ""
      ? aiSummary
      : deterministicSummary(findings, scope, stats);

  return notice === "" ? body : `${body} ${notice}`;
}

/**
 * A deterministic summary, used when the model did not supply one. It states
 * only what the numbers support, because a summary that overstates coverage is
 * worse than a terse one.
 */
function deterministicSummary(
  findings: readonly ReviewFinding[],
  scope: ReviewScope,
  stats: ReviewStats,
): string {
  if (findings.length === 0) {
    const compared =
      scope.diffAware && scope.baseBranch !== null ? ` Changes were compared against ${scope.baseBranch}.` : "";
    return `Reviewed ${stats.filesReviewed} files and found no defect that cleared the review bar.${compared}`;
  }

  const bySeverity = new Map<string, number>();
  for (const finding of findings) {
    bySeverity.set(finding.severity, (bySeverity.get(finding.severity) ?? 0) + 1);
  }
  const breakdown = ["critical", "high", "medium", "low"]
    .filter((severity) => bySeverity.has(severity))
    .map((severity) => `${bySeverity.get(severity)} ${severity}`)
    .join(", ");

  return `${findings.length} findings across ${stats.filesReviewed} reviewed files: ${breakdown}. Of ${stats.candidatesProduced} candidates, ${stats.candidatesRejected} were dropped by the review bar and ${stats.duplicatesMerged} were duplicates.`;
}
