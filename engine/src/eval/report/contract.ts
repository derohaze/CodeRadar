/**
 * What a report may look like when this package did not produce it.
 *
 * Three documents arrive here and none of them has been checked: the engine's
 * report read back from a saved run, the wire response the desktop app reads, and
 * a hand-written fixture. All three speak the review's vocabulary; they differ in
 * how much of it is present, and the wire renames a field or two.
 *
 * So the boundary is stated as *the contract, read loosely* instead of as a second
 * copy of it. Every shape below is derived from `core/findings/model.ts`, which is
 * what keeps the two in step: a field the contract renames cannot go on being read
 * here under its old name, and a field the contract adds needs no edit.
 */

import type {
  AiReviewSummary,
  RejectedCandidate,
  ReviewCandidateTrace,
  ReviewFileTrace,
  ReviewFinding,
  ReviewLimitation,
  ReviewReport,
  ReviewRequestTrace,
  ReviewStats,
} from "../../core/findings/model.ts";
import type { AiReviewAttemptTelemetry } from "../../core/ports.ts";
import type { LineRange } from "../coverage.ts";

/**
 * A value read from a document this package did not produce.
 *
 * Every field may be absent at every depth, because nothing checked it: a missing
 * number is not zero and a missing string is not empty, and only the reader can
 * decide what a hole means.
 */
export type Untrusted<T> =
  T extends readonly (infer Element)[]
    ? readonly Untrusted<Element>[] | undefined
    : T extends object
      ? { [K in keyof T]?: Untrusted<T[K]> }
      : T | undefined;

/**
 * A finding as it arrives from a run.
 *
 * Two shapes are in play and both are real: the engine's own report nests the
 * anchor under `location`, while the wire contract the app reads flattens it.
 * Reading either one here means a saved report and a live response are scored by
 * the same code, which is the only way the two numbers can be compared.
 */
export type ReportFindingLike = Untrusted<Pick<ReviewFinding, "title" | "severity">> & {
  /** Required: an entry with no title is not a claim about the code. */
  title: string;
  location?: Untrusted<ReviewFinding["location"]> | undefined;
  /** The wire's flattened copy of the anchor. */
  file?: string | undefined;
  line?: number | undefined;
  lineEnd?: number | undefined;
  line_end?: number | undefined;
};

export interface NormalisedFinding {
  title: string;
  file: string;
  line: number;
  lineEnd: number;
  severity: string | null;
}

/** Flattens either finding shape, or null when the anchor is not readable. */
export function normaliseFinding(raw: ReportFindingLike): NormalisedFinding | null {
  const nested = raw.location;
  const file = nested?.file ?? raw.file;
  const line = nested?.line ?? raw.line;
  if (typeof file !== "string" || file.trim() === "" || typeof line !== "number" || !Number.isFinite(line)) {
    return null;
  }

  const rawEnd = nested?.lineEnd ?? raw.lineEnd ?? raw.line_end ?? line;
  const lineEnd = Number.isFinite(rawEnd) ? Math.max(rawEnd, line) : line;
  return { title: raw.title, file, line, lineEnd, severity: raw.severity ?? null };
}

/** Matches a reported path against a fixture path, whatever root it was named from. */
export function fileMatches(claimed: string, expected: string): boolean {
  const left = claimed.replace(/\\/g, "/");
  const right = expected.replace(/\\/g, "/").replace(/^\.\//, "");
  return left === right || left.endsWith(`/${right}`);
}

/**
 * True when a finding's range touches the defect's anchor.
 *
 * A null anchor is the file-level claim, so any finding on that file satisfies
 * it. A recorded anchor is intersected inclusively: a one-line report inside a
 * recorded range counts, and a report one line past it does not.
 */
export function anchorOverlaps(finding: NormalisedFinding, anchor: LineRange | null): boolean {
  if (anchor === null) return true;
  return finding.line <= anchor.end && finding.lineEnd >= anchor.start;
}

/**
 * The model stage's tally.
 *
 * The contract's own `AiReviewSummary`, plus the two names the wire uses for it —
 * nothing else differs, so nothing else is restated.
 */
export type AiReportLike = Untrusted<AiReviewSummary> & {
  entries_dropped?: number | undefined;
  not_sent?: number | undefined;
};

/**
 * One dropped candidate as it arrives from a report or from the wire.
 *
 * `diagnostics` is where a refusal can be checked rather than believed: the
 * quotes the gate extracted and whether the file contained each one. That is the
 * difference between a claim that was made and could not be proved, and a claim
 * that was never quoted at all.
 */
export type ReportRejectionLike = Untrusted<
  Pick<RejectedCandidate, "file" | "line" | "lineEnd" | "title" | "reason" | "detail" | "diagnostics">
> & {
  /** The wire's name for `lineEnd`. */
  line_end?: number | undefined;
};

/** A numbered window that was sent to the model, as the trace records it. */
export type ReportWindowLike = Untrusted<ReviewRequestTrace["contextWindows"][number]>;

/** What a call carried, in sizes and counts. Never prompt text. */
export type ReportRequestTraceLike = Untrusted<ReviewRequestTrace>;

/** One candidate's journey, as the trace records it. */
export type ReportCandidateTraceLike = Untrusted<ReviewCandidateTrace>;

/**
 * One provider attempt, as the trace records it.
 *
 * Counts, identifiers and token totals only: no prompt, no response text and no
 * credential is ever part of it, which is what makes it safe to keep next to a
 * report and to commit as a fixture.
 */
export type ReportAttemptLike = Untrusted<AiReviewAttemptTelemetry>;

/** The per-file record a run leaves when the caller asked for a trace. */
export type ReportFileTraceLike = Untrusted<ReviewFileTrace> & {
  /** Required: an entry that names no file is not a file's record. */
  file: string;
};

/** The engine's own tally, read loosely; `aiReview` is the boundary's own shape. */
export type ReportStatsLike = Untrusted<
  Pick<ReviewStats, "candidatesProduced" | "candidatesRejected" | "duplicatesMerged">
> & {
  // A tally is read as the contract states one — a reason mapped to a count —
  // rather than field by field: a hole in it is not a missing number, it is a
  // reason nobody recorded.
  rejectionsByReason?: ReviewStats["rejectionsByReason"] | undefined;
  aiReview?: AiReportLike | null | undefined;
};

/** One reason a review is not a complete answer. A row with no code says nothing. */
export type ReportLimitationLike = Untrusted<Pick<ReviewLimitation, "detail">> & { code: string };

/**
 * A report, from any of the three places one arrives.
 *
 * Only `findings` is required. A document that has it is a report; one that does
 * not is not, and `readReviewReport` is where that is decided.
 */
export type ReviewReportLike = Untrusted<Pick<ReviewReport, "state">> & {
  findings: readonly ReportFindingLike[];
  /** The engine's own trace, when the run collected one. */
  trace?: readonly ReportFileTraceLike[] | undefined;
  /** Dropped candidates, read as opaque: how one is read is decided per entry. */
  rejected?: readonly unknown[] | undefined;
  stats?: ReportStatsLike | undefined;
  /** What the model stage produced, in the engine's own report shape. */
  aiReview?: AiReportLike | null | undefined;
  /** The wire contract's own name for the same tally, for a live response. */
  rejections_by_reason?: ReviewStats["rejectionsByReason"] | undefined;
  /** The wire contract's name for the dropped candidates. */
  rejected_candidates?: readonly unknown[] | undefined;
  /** The wire contract's copy of the model tally. */
  ai_review?: AiReportLike | null | undefined;
  /** `complete` / `partial` / `degraded` / `failed`, when the run recorded one. */
  review_state?: string | undefined;
  limitations?: readonly ReportLimitationLike[] | undefined;
  review_limitations?: readonly ReportLimitationLike[] | undefined;
};

/**
 * Pulls the report object out of a saved run.
 *
 * The CLI writes its human-readable summary to the same stream as the JSON, so a
 * saved run is not pure JSON. Scanning for the first object that carries a review
 * schema is more honest than trimming a fixed prefix, which would break the day
 * the summary grows a line.
 */
export function readReviewReport(text: string): ReviewReportLike {
  for (let index = text.indexOf("{"); index !== -1; index = text.indexOf("{", index + 1)) {
    const candidate = text.slice(index);
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    // `findings` as an array is the one thing both shapes agree on: the engine's
    // report and the wire detail it is mapped onto.
    if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { findings?: unknown }).findings)) {
      return parsed as ReviewReportLike;
    }
  }
  throw new Error("no review report was found in the input");
}
