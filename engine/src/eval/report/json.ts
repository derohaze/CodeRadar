/**
 * The score and the diagnosis as data.
 *
 * The text report is for a human reading a log; this is the same verdicts in a
 * shape a test, a CI gate or a saved artifact can compare without parsing prose.
 */

import type { DefectDiagnosis } from "../scoring/diagnose.ts";
import type { ReviewEvaluation } from "../scoring/evaluate.ts";

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
