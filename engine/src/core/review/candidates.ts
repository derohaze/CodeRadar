/**
 * The pipeline's internal candidate vocabulary.
 *
 * A candidate is what an origin *claims*; an `AttributedCandidate` is that claim
 * plus the file it entered the pipeline under. Attribution is deliberately not
 * the candidate's own `file` field: a model that answers about a different file
 * is exactly the case `file-not-in-scope` exists for, and a trace that filed such
 * a candidate under the claimed path would report a file that produced nothing
 * while the file actually sent to the model looked clean.
 *
 * These types are shared by the orchestrator (which produces them) and the report
 * builders (which describe them), so they live beside the pipeline rather than
 * inside either.
 */

import type {
  AiReviewOutcome,
  ReviewFileTrace,
  ReviewRequestTrace,
} from "../findings/model.ts";
import type { CandidateFinding } from "../findings/validate.ts";
import type { AiReviewTelemetry } from "../ports.ts";

/** The parser's own record of one answer. Absent when the call itself threw. */
export type ParserTrace = NonNullable<ReviewFileTrace["parser"]>;

/** A candidate plus the reviewed file it entered the pipeline under. */
export interface AttributedCandidate {
  candidate: CandidateFinding;
  requestedFile: string;
  origin: "detector" | "ai";
}

/** One file's model attempt, as it is recorded for the report. */
export interface AiAttemptOutcome {
  outcome: AiReviewOutcome;
  entriesDropped: number;
  parser?: ParserTrace | undefined;
  /** Exception class only: a provider message can echo the source it was shown. */
  modelErrorName?: string | undefined;
  /** What the call carried, in sizes and counts. Never prompt text. */
  request: ReviewRequestTrace;
  /** What the transport recorded. Empty for a reviewer that reports no telemetry. */
  telemetry?: AiReviewTelemetry | undefined;
}

export interface AiStageResult {
  candidates: AttributedCandidate[];
  summary: string | null;
  /** Keyed by reviewed-file path. A file absent here was never sent. */
  outcomes: ReadonlyMap<string, AiAttemptOutcome>;
  /** Files the reviewer was actually called for. */
  attempted: number;
  /** Reviewed files the model budget selected, sent or not. */
  selectedForModel: readonly string[];
}
