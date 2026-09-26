/**
 * The numbers a report carries about itself.
 *
 * Every count here is derived from what the pipeline actually did — candidates
 * produced, candidates dropped and why, duplicates merged — so a reader can tell
 * a review that found nothing from a review that could not look.
 */

import type { AiReviewSummary, RejectedCandidate, ReviewFinding, ReviewStats } from "../../findings/model.ts";
import type { AiStageResult } from "../candidates.ts";

export function buildStats(input: {
  discovered: number;
  reviewed: number;
  candidatesProduced: number;
  rejections: readonly RejectedCandidate[];
  merged: number;
  findings: readonly ReviewFinding[];
  aiReview: AiReviewSummary | null;
}): ReviewStats {
  const rejectionsByReason: Record<string, number> = {};
  for (const rejection of input.rejections) {
    rejectionsByReason[rejection.reason] = (rejectionsByReason[rejection.reason] ?? 0) + 1;
  }

  // Merged duplicates are counted in `rejections` too, so they are subtracted
  // here to keep the candidate arithmetic honest.
  const candidatesRejected = Math.max(0, input.candidatesProduced - input.findings.length - input.merged);

  return {
    filesDiscovered: input.discovered,
    filesReviewed: input.reviewed,
    candidatesProduced: input.candidatesProduced,
    candidatesRejected,
    duplicatesMerged: input.merged,
    findingsKept: input.findings.length,
    rejectionsByReason,
    aiReview: input.aiReview,
  };
}

/** The model stage's tally, from one outcome per call the reviewer made. */
export function summariseAiReview(result: AiStageResult, filesReviewed: number): AiReviewSummary {
  const counts = { valid: 0, empty: 0, partial: 0, invalid: 0, unavailable: 0 };
  let entriesDropped = 0;

  for (const attempt of result.outcomes.values()) {
    counts[attempt.outcome] += 1;
    entriesDropped += attempt.entriesDropped;
  }

  return {
    attempted: result.attempted,
    valid: counts.valid,
    empty: counts.empty,
    partial: counts.partial,
    invalid: counts.invalid,
    unavailable: counts.unavailable,
    entriesDropped,
    // Reviewed files the model was never asked about. The AI budget is a real
    // limitation, and leaving it implicit made it invisible in the report.
    notSent: Math.max(0, filesReviewed - result.attempted),
  };
}
