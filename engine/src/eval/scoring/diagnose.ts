/**
 * Where a defect's claim was last alive.
 *
 * A missed defect is not one state but several, and they have different owners. A
 * file that was never sent is a selection bug, an unreadable answer is a parser or
 * provider problem, and a correct file with a valid answer and no claim in it is
 * the model's own miss. Reporting all of them as "0/9" is what made the last live
 * run unactionable.
 */

import { coverageOf, coversRange, type LineRange } from "../coverage.ts";
import type { GroundTruth, GroundTruthDefect } from "../ground-truth/parse.ts";
import {
  anchorOverlaps,
  fileMatches,
  type NormalisedFinding,
  type ReportFileTraceLike,
  type ReportRejectionLike,
  type ReviewReportLike,
} from "../report/contract.ts";
import { evaluateReview } from "./evaluate.ts";

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
export function describeContext(context: DefectContextRecord): string {
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
