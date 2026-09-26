/**
 * The model stage.
 *
 * A provider failure is reported as an event and the review continues:
 * deterministic findings are better than no review at all, and a provider outage
 * must never look like clean code.
 *
 * Every attempt's outcome is kept, not just its candidates. A response that
 * could not be read and a file the model was never asked about produce no
 * candidates either, and the difference between those three cases is the whole
 * reason this stage returns an outcome per file.
 *
 * The stage owns the model budget (which files are worth the call) and the way a
 * call is read; it owns nothing about the report.
 */

import type { RepositoryHotspot, RepositoryIndex, ReviewRequestTrace } from "../../findings/model.ts";
import type { AiReviewRequest, AiReviewTelemetry, AiReviewerPort, FileSystemPort, ReviewEventSink } from "../../ports.ts";
import { aiReviewExecutionError } from "../../ports.ts";
import { detectProjectProfile } from "../../languages/detect.ts";
import { buildRelatedFiles } from "../../repository/context.ts";
import type { FileContext } from "../../repository/context.ts";
import { detectTooling } from "../../repository/tooling.ts";
import type { ReviewTarget } from "../../repository/select.ts";
import { classifyReviewResponse, parseReviewResponse } from "../ai-reviewer.ts";
import type { AiAttemptOutcome, AiStageResult, AttributedCandidate } from "../candidates.ts";
import { RELATED_FILE_LIMIT, buildSystemPrompt, buildUserPrompt } from "../prompt.ts";
import { loadPromptBundle } from "../prompts.ts";
import { mapWithConcurrency } from "../../concurrency.ts";
import { describeRepositoryIndex } from "../../indexing/index-repository.ts";

/**
 * Prompt sizes are reported in UTF-8 bytes, because that is the unit a context
 * window is measured in. `TextEncoder` is a web standard and is available in
 * every runtime this core is embedded in; the core itself stays free of imports
 * from any one of them.
 */
const UTF8 = new TextEncoder();

export interface AiStageOptions {
  /** Omit to run deterministically: the stage then reports that it did nothing. */
  reviewer?: AiReviewerPort | undefined;
  fs: FileSystemPort;
  /** Absolute path of the directory holding `shared_code_review_bar.md`. */
  promptsDir: string;
  /** Files the review selected, in pipeline order. */
  targets: readonly ReviewTarget[];
  contexts: ReadonlyMap<string, FileContext>;
  repositoryIndex: RepositoryIndex;
  /** Paths of every reviewed file, for project profiling. */
  projectPaths: readonly string[];
  /** Base the project's tooling is detected against. */
  pathBase: string;
  /** Lines the change touched, per path. Only read when `diffAware` is true. */
  changedLinesByPath: ReadonlyMap<string, ReadonlySet<number>>;
  diffAware: boolean;
  /** Files sent to the model. Detectors run on every reviewed file regardless. */
  maxAiFiles: number;
  maxFindings: number;
  concurrency: number;
  emit: ReviewEventSink;
}

export async function runAiStage(options: AiStageOptions): Promise<AiStageResult> {
  const reviewer = options.reviewer;
  if (reviewer === undefined) {
    return { candidates: [], summary: null, outcomes: new Map(), attempted: 0, selectedForModel: [] };
  }

  const bundle = await loadPromptBundle(options.fs, options.promptsDir);
  const selected = prioritiseHotspots(options.targets, options.repositoryIndex.hotspots).slice(0, options.maxAiFiles);
  if (selected.length === 0) {
    return { candidates: [], summary: null, outcomes: new Map(), attempted: 0, selectedForModel: [] };
  }

  const project = detectProjectProfile(options.projectPaths);
  const tooling = await detectTooling(options.fs, options.pathBase);
  const projectLine = [
    describeProject(project.kind, project.packageManager, project.languages, tooling.linterConfigs),
    describeRepositoryIndex(options.repositoryIndex),
  ]
    .filter((part) => part !== "")
    .join(". ");
  const systemPrompt = buildSystemPrompt({ bundle, maxFindings: options.maxFindings, projectLine });
  const systemPromptBytes = utf8Bytes(systemPrompt);

  const candidates: AttributedCandidate[] = [];
  const outcomes = new Map<string, AiAttemptOutcome>();
  let summary: string | null = null;
  let lastFailure: string | null = null;
  let attempted = 0;

  options.emit({
    type: "ai:start",
    message: `Reviewing ${selected.length} files with ${reviewer.name}`,
    counts: { files: selected.length },
  });

  await mapWithConcurrency(selected, options.concurrency, async (target) => {
    const context = options.contexts.get(target.file.path);
    if (context === undefined) return;

    const changedLines = options.diffAware
      ? (options.changedLinesByPath.get(target.file.path) ?? new Set<number>())
      : new Set<number>();

    const related = buildRelatedFiles(context, options.contexts);
    const userPrompt = buildUserPrompt({ bundle, context, maxFindings: options.maxFindings, changedLines, related });
    // What the request carried, in sizes and counts only. A trace that held
    // prompt text would leak the code under review into a diagnostic artifact.
    const request: ReviewRequestTrace = {
      maxFindings: options.maxFindings,
      systemPromptBytes,
      userPromptBytes: utf8Bytes(userPrompt),
      fileLines: context.file.lines.length,
      contextWindows: context.windows.map((window) => ({ startLine: window.startLine, endLine: window.endLine })),
      relatedFiles: related.slice(0, RELATED_FILE_LIMIT).map((file) => file.path),
      changedLineCount: changedLines.size,
    };

    attempted += 1;
    const call = await callReviewer(reviewer, { systemPrompt, userPrompt, maxFindings: options.maxFindings });

    if (!call.ok) {
      // Only the exception class is recorded: a provider message can echo the
      // source it was shown. Error bodies were already redacted in transport.
      outcomes.set(target.file.path, {
        outcome: "unavailable",
        entriesDropped: 0,
        modelErrorName: call.error instanceof Error ? call.error.name : "Error",
        telemetry: call.telemetry,
        request,
      });
      lastFailure = describeCallFailure(call.error, call.telemetry);
      return;
    }

    const parsed = parseReviewResponse(call.response);
    outcomes.set(target.file.path, {
      outcome: classifyReviewResponse(parsed),
      entriesDropped: parsed.entriesDropped,
      parser: {
        shape: parsed.shape,
        issues: parsed.issues,
        entriesDropped: parsed.entriesDropped,
        candidateCount: parsed.candidates.length,
        answerField: parsed.answerField,
      },
      telemetry: call.telemetry,
      request,
    });
    candidates.push(
      ...parsed.candidates.map((candidate) => ({
        candidate,
        requestedFile: target.file.path,
        origin: "ai" as const,
      })),
    );
    if (summary === null && parsed.summary !== "") summary = parsed.summary;
  });

  if (lastFailure !== null && candidates.length === 0) {
    const unreadable = [...outcomes.values()].filter((entry) => entry.outcome === "invalid").length;
    const detail = unreadable > 0 ? `, ${unreadable} response(s) unreadable` : "";
    options.emit({
      type: "ai:failed",
      message: `AI review unavailable, continuing with detectors only (${lastFailure}${detail})`,
    });
  }

  options.emit({
    type: "ai:done",
    message: `${candidates.length} candidate defects from ${reviewer.name}`,
    counts: { candidates: candidates.length },
  });

  return {
    candidates,
    summary,
    outcomes,
    attempted,
    selectedForModel: selected.map((target) => target.file.path),
  };
}

/**
 * One reviewer call as the pipeline sees it.
 *
 * `telemetry` is absent, not empty, when the reviewer reports none: "this
 * reviewer has no call record" and "this call made no attempt" are different
 * facts, and only the second one belongs in a trace.
 */
type ReviewerCall =
  | { ok: true; response: unknown; telemetry: AiReviewTelemetry | undefined }
  | { ok: false; error: unknown; telemetry: AiReviewTelemetry | undefined };

/**
 * Calls the reviewer once, preferring its telemetry path when it has one.
 *
 * A reviewer that only implements `review()` is called exactly as before, with no
 * call record: the trace then omits the provider rather than inventing one.
 */
async function callReviewer(reviewer: AiReviewerPort, request: AiReviewRequest): Promise<ReviewerCall> {
  const withTelemetry = reviewer.reviewWithTelemetry;
  if (withTelemetry === undefined) {
    try {
      return { ok: true, response: await reviewer.review(request), telemetry: undefined };
    } catch (error) {
      return { ok: false, error, telemetry: undefined };
    }
  }

  try {
    const execution = await withTelemetry.call(reviewer, request);
    return execution.status === "response"
      ? { ok: true, response: execution.response, telemetry: execution.telemetry }
      : { ok: false, error: aiReviewExecutionError(execution), telemetry: execution.telemetry };
  } catch (error) {
    // A reviewer that throws out of its own telemetry path still degrades the
    // review to the deterministic findings rather than failing it.
    return { ok: false, error, telemetry: undefined };
  }
}

/**
 * A failure sentence built from the transport record.
 *
 * The provider's own prose is deliberately not repeated here: a provider error
 * body can echo the source the model was shown. The attempt outcome and its status
 * carry the same information in a form that is safe to show and to log. A
 * reviewer with no call record falls back to its own message, as it always did.
 */
function describeCallFailure(error: unknown, telemetry: AiReviewTelemetry | undefined): string {
  const name = error instanceof Error ? error.name : "Error";
  if (telemetry === undefined || telemetry.attempts.length === 0) {
    return error instanceof Error ? `${name}: ${error.message}` : `${name}: provider call failed`;
  }

  const last = telemetry.attempts[telemetry.attempts.length - 1];
  const status = last?.status === null || last?.status === undefined ? "" : ` ${last.status}`;
  return `${name}: ${last?.outcome ?? "no outcome"}${status} after ${telemetry.attempts.length} attempt(s)`;
}

/**
 * Orders review targets so hotspot files reach the model before the review
 * budget runs out, preserving the caller's ordering inside each group.
 *
 * This is the only job the ported index has in the pipeline. Scoring a file as a
 * hotspot never produces a finding — a marker match is not evidence of a defect.
 */
function prioritiseHotspots(
  targets: readonly ReviewTarget[],
  hotspots: readonly RepositoryHotspot[],
): ReviewTarget[] {
  if (hotspots.length === 0) return [...targets];

  const hotspotPaths = new Set(hotspots.map((hotspot) => hotspot.file));
  const ranked: ReviewTarget[] = [];
  const remaining: ReviewTarget[] = [];

  for (const target of targets) {
    if (hotspotPaths.has(target.file.path)) ranked.push(target);
    else remaining.push(target);
  }

  return [...ranked, ...remaining];
}

/**
 * One line of project context for the reviewer's system prompt.
 *
 * The linter names are the useful part: knowing the project runs ESLint tells
 * the model which class of finding not to spend its budget on, which is exactly
 * what the review bar asks a human reviewer to do.
 */
function describeProject(
  kind: string,
  packageManager: string | null,
  languages: readonly string[],
  linterConfigs: readonly string[],
): string {
  const parts: string[] = [];
  if (kind !== "unknown") parts.push(`${kind} project`);
  if (packageManager !== null) parts.push(`using ${packageManager}`);
  if (languages.length > 0) parts.push(`languages: ${languages.slice(0, 4).join(", ")}`);
  if (linterConfigs.length > 0) parts.push(`linters configured: ${linterConfigs.slice(0, 3).join(", ")}`);
  return parts.join(", ");
}

/** UTF-8 length, so a prompt is measured the way a context window is. */
function utf8Bytes(text: string): number {
  return UTF8.encode(text).length;
}
