/**
 * The per-file trace: how far every candidate from every origin travelled.
 *
 * A trace is a diagnostic, and a report that carries one says, for each reviewed
 * file, whether it was sent to the model, what the model answered, which
 * candidates came from where, and why the rest were dropped. It holds counts,
 * identifiers and the evidence comparison — never source content, a prompt, or a
 * model response.
 */

import type {
  ReviewCandidateTrace,
  ReviewFileTrace,
  ReviewFinding,
  RejectedCandidate,
} from "../../findings/model.ts";
import type { EvidenceComparison } from "../../findings/evidence.ts";
import type { CandidateFinding } from "../../findings/validate.ts";
import type { ReviewTarget } from "../../repository/select.ts";
import type { AiStageResult, AttributedCandidate } from "../candidates.ts";

interface TraceInput {
  targets: readonly ReviewTarget[];
  journeys: readonly ReviewCandidateTrace[];
  rejections: readonly RejectedCandidate[];
  findings: readonly ReviewFinding[];
  aiStage: AiStageResult;
}

export function buildTrace(input: TraceInput): ReviewFileTrace[] {
  const selectedForModel = new Set(input.aiStage.selectedForModel);

  return input.targets.map((target) => {
    const file = target.file.path;
    const attempt = input.aiStage.outcomes.get(file);
    const fromFile = input.journeys.filter((journey) => journey.requestedFile === file);

    return {
      file,
      selected: true,
      selectedForModel: selectedForModel.has(file),
      sentToModel: attempt !== undefined,
      ...(attempt === undefined
        ? {}
        : {
            modelOutcome: attempt.outcome,
            ...(attempt.modelErrorName === undefined ? {} : { modelErrorName: attempt.modelErrorName }),
            request: attempt.request,
            ...(attempt.parser === undefined ? {} : { parser: attempt.parser }),
            // Provider and model are only claimed when the reviewer reported a
            // call record: an absent record is not evidence of either. A replay
            // reports a record with no attempts, which says no call was made.
            ...(attempt.telemetry === undefined
              ? {}
              : { provider: attempt.telemetry.provider, model: attempt.telemetry.model, response: attempt.telemetry }),
          }),
      candidateDetails: fromFile,
      candidates: {
        detector: fromFile.filter((journey) => journey.origin === "detector").length,
        ai: fromFile.filter((journey) => journey.origin === "ai").length,
      },
      findings: input.findings.filter((finding) => finding.location.file === file).length,
      rejections: countRejections(input.rejections, file),
    };
  });
}

function countRejections(rejections: readonly RejectedCandidate[], file: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const rejection of rejections) {
    if (rejection.file !== file) continue;
    counts[rejection.reason] = (counts[rejection.reason] ?? 0) + 1;
  }
  return counts;
}

/** A candidate that passed the bar, with the comparison the evidence gate ran. */
export function acceptedJourney(
  entry: AttributedCandidate,
  finding: ReviewFinding,
  comparison: EvidenceComparison,
): ReviewCandidateTrace {
  return {
    requestedFile: entry.requestedFile,
    origin: entry.origin,
    file: finding.location.file,
    line: finding.location.line,
    lineEnd: finding.location.lineEnd,
    fieldsPresent: fieldPresence(entry.candidate),
    evidence: {
      quoteCount: comparison.quotes.length,
      quotesFound: comparison.quotesFound,
      anchored: comparison.anchored,
    },
    validator: "accepted",
    finalOutcome: "retained",
    findingId: finding.id,
  };
}

/**
 * A rejected candidate, with the comparison behind the rejection when it was the
 * evidence gate that rejected it. `anchored: null` is a candidate that never
 * reached the gate, which is not the same as a comparison that failed.
 */
export function rejectedJourney(entry: AttributedCandidate, rejection: RejectedCandidate): ReviewCandidateTrace {
  const diagnostics = rejection.diagnostics;
  const compared = diagnostics?.quotesFound !== undefined;

  return {
    requestedFile: entry.requestedFile,
    origin: entry.origin,
    file: rejection.file,
    line: rejection.line,
    lineEnd: rejection.lineEnd,
    fieldsPresent: fieldPresence(entry.candidate),
    evidence: {
      quoteCount: diagnostics?.quotes?.length ?? 0,
      quotesFound: compared ? [...(diagnostics?.quotesFound ?? [])] : [],
      anchored: compared ? false : null,
    },
    validator: "rejected",
    rejectionReason: rejection.reason,
    finalOutcome: "rejected",
  };
}

function fieldPresence(candidate: CandidateFinding): ReviewCandidateTrace["fieldsPresent"] {
  const filled = (value: string): boolean => value.trim() !== "";
  return {
    title: filled(candidate.title),
    problem: filled(candidate.problem),
    why: filled(candidate.why),
    impact: filled(candidate.impact),
    evidence: filled(candidate.evidence),
    fix: filled(candidate.fix),
  };
}

/**
 * Relabels a candidate that cleared validation but did not reach the report.
 *
 * The link back to the candidate is the finding id, which is derived from the
 * anchor and the title and can therefore be recomputed from the rejection's own
 * fields. When two candidates are similar enough to share an id, one was kept
 * and one was merged; which one lost is decided by quality, not by anything a
 * trace holds, so the first still-retained match is relabelled and the pair is
 * still reported as one kept and one merged.
 */
export function markJourney(
  journeys: readonly ReviewCandidateTrace[],
  id: string,
  outcome: "dedupe" | "policy-rejected",
): void {
  const journey = journeys.find((entry) => entry.findingId === id && entry.finalOutcome === "retained");
  if (journey !== undefined) journey.finalOutcome = outcome;
}
