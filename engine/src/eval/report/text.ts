/**
 * The score and the diagnosis as text, so a run can be read from a log.
 *
 * A short line per defect is the whole point: `MODEL_MISSED` and
 * `EVIDENCE_MISMATCH` are the same zero in a summary and two different jobs in
 * this table. Every defect and every negative control is listed whether or not it
 * was hit, because a report of only the successes is how a fixture stops being a
 * measurement.
 */

import type { GroundTruth } from "../ground-truth/parse.ts";
import { describeContext, type DefectDiagnosis } from "../scoring/diagnose.ts";
import type { ReviewEvaluation } from "../scoring/evaluate.ts";

/** A rate as a percentage, or `n/a` when it is not measurable. Null is not zero. */
function formatRate(rate: number | null): string {
  return rate === null ? "n/a" : `${Math.round(rate * 100)}%`;
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
