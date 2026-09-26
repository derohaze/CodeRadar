/**
 * The review pipeline.
 *
 * Git or filesystem, then discovery, then selection, then context, then the
 * deterministic detectors and the model in parallel, then validation, then
 * deduplication and confidence filtering, then the report. That order is the
 * product, and each stage has one job.
 *
 * Three properties are load-bearing and must survive any future edit:
 *
 * - Nothing reaches the report without passing `validateCandidate`. There is no
 *   bypass for detectors, for the model, or for a future GitHub adapter.
 * - The engine never throws because a model call failed. An unavailable provider
 *   degrades the review to the deterministic findings; it does not fail it.
 * - The review never reads outside the path it was given. Git is used to name
 *   paths and to order files, never to widen the scope, because a review that
 *   quietly covers a different directory than the one chosen is worthless.
 */

import { mapWithConcurrency } from "../concurrency.ts";
import { changedLineNumbers, diffPaths, parseUnifiedDiff } from "../diff/unified.ts";
import { toPosixPath } from "../findings/model.ts";
import type {
  AiReviewOutcome,
  AiReviewSummary,
  RejectedCandidate,
  ReviewCandidateTrace,
  ReviewFileTrace,
  ReviewFinding,
  ReviewReport,
  ReviewRequestTrace,
  ReviewScope,
  ReviewState,
  ReviewStats,
} from "../findings/model.ts";
import { compareFindings } from "../findings/policy.ts";
import { dedupeFindings } from "../findings/dedupe.ts";
import { findingId, validateCandidate } from "../findings/validate.ts";
import type { CandidateFinding, EvidenceComparison } from "../findings/validate.ts";
import { describeRepositoryIndex, indexRepository } from "../indexing/index-repository.ts";
import { detectLanguage, detectProjectProfile } from "../languages/detect.ts";
import type { RepositoryHotspot, RepositoryIndex } from "../findings/model.ts";
import type {
  AiReviewRequest,
  AiReviewTelemetry,
  AiReviewerPort,
  FileSystemPort,
  GitPort,
  ReviewEvent,
  ReviewEventSink,
} from "../ports.ts";
import { aiReviewExecutionError } from "../ports.ts";
import { buildFileContext, buildRelatedFiles } from "../repository/context.ts";
import type { FileContext } from "../repository/context.ts";
import { discoverRepository, isReviewableContent } from "../repository/discover.ts";
import type { DiscoveredFile, DiscoveryLimits } from "../repository/discover.ts";
import { selectReviewTargets } from "../repository/select.ts";
import type { ReviewTarget } from "../repository/select.ts";
import { createSourceFile, createSourceIndex } from "../repository/source.ts";
import type { SourceFile, SourceIndex } from "../repository/source.ts";
import { detectTooling } from "../repository/tooling.ts";
import { runDetectors } from "./detectors/index.ts";
import { classifyReviewResponse, parseReviewResponse } from "./ai-reviewer.ts";
import { collectLimitations, resolveReviewState } from "./limitations.ts";
import { RELATED_FILE_LIMIT, buildSystemPrompt, buildUserPrompt } from "./prompt.ts";
import { loadPromptBundle } from "./prompts.ts";

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_AI_FILES = 40;
const DEFAULT_MAX_FINDINGS = 15;
const DEFAULT_CONCURRENCY = 8;

/**
 * Prompt sizes are reported in UTF-8 bytes, because that is the unit a context
 * window is measured in. `TextEncoder` is a web standard and is available in
 * every runtime this core is embedded in; the core itself stays free of imports
 * from any one of them.
 */
const UTF8 = new TextEncoder();

export interface ReviewEngineOptions {
  fs: FileSystemPort;
  /** Absolute path of the directory holding `shared_code_review_bar.md`. */
  promptsDir: string;
  /** Omit to review without git awareness. */
  git?: GitPort | undefined;
  /** Omit to run deterministically with detectors only. */
  aiReviewer?: AiReviewerPort | undefined;
  limits?: Partial<DiscoveryLimits> | undefined;
  /** Files reviewed after ordering. */
  maxFiles?: number;
  /** Files sent to the model. Detectors run on every reviewed file regardless. */
  maxAiFiles?: number;
  maxFindings?: number;
  /** Review only files that differ from the base branch. */
  changedOnly?: boolean;
  baseBranch?: string | undefined;
  onEvent?: ReviewEventSink | undefined;
  concurrency?: number;
  /**
   * Record a per-file trace on the report.
   *
   * Off by default: a trace is a diagnostic, and the report is a product
   * surface. When it is on, the report carries counts and reasons only — never
   * source content, a prompt, or a model response.
   */
  collectTrace?: boolean | undefined;
}

export interface ReviewRequest {
  /** Absolute path to a file or a directory. */
  target: string;
}

interface DiffState {
  /** Root of the repository git reported, or null when there is none. */
  repositoryRoot: string | null;
  branch: string | null;
  baseBranch: string | null;
  changedPaths: Set<string>;
  changedLinesByPath: Map<string, Set<number>>;
  diffAware: boolean;
}

const EMPTY_DIFF: DiffState = {
  repositoryRoot: null,
  branch: null,
  baseBranch: null,
  changedPaths: new Set(),
  changedLinesByPath: new Map(),
  diffAware: false,
};

export class ReviewEngine {
  private readonly options: ReviewEngineOptions;

  constructor(options: ReviewEngineOptions) {
    this.options = options;
  }

  private emit(event: ReviewEvent): void {
    this.options.onEvent?.(event);
  }

  async review(request: ReviewRequest): Promise<ReviewReport> {
    const fs = this.options.fs;
    const maxFiles = this.options.maxFiles ?? DEFAULT_MAX_FILES;
    const maxAiFiles = this.options.maxAiFiles ?? DEFAULT_MAX_AI_FILES;
    const maxFindings = this.options.maxFindings ?? DEFAULT_MAX_FINDINGS;
    const concurrency = Math.max(1, this.options.concurrency ?? DEFAULT_CONCURRENCY);

    const absoluteTarget = fs.resolve(request.target);
    const targetStat = await fs.stat(absoluteTarget);
    if (!targetStat.isFile && !targetStat.isDirectory) {
      throw new Error("review target must be a file or a directory");
    }

    // `walkRoot` is the review boundary and never changes: it is the directory
    // the caller chose. `pathBase` only decides how paths are named.
    const walkRoot = targetStat.isFile ? fs.directoryName(absoluteTarget) : absoluteTarget;
    let pathBase = walkRoot;

    // A diff is read only when the caller asked for a diff review. Anchoring a
    // plain review to whichever branch git happens to name would silently demote
    // every finding on an unchanged line, which is a false negative nobody
    // asked for. `--changed-only` / an explicit base branch is the request.
    const diffRequested = this.options.changedOnly === true || this.options.baseBranch !== undefined;

    let diffState = EMPTY_DIFF;
    if (this.options.git !== undefined) {
      this.emit({ type: "git:start", message: "Inspecting git state" });
      diffState = await this.collectDiff(absoluteTarget, walkRoot, targetStat.isFile, diffRequested);

      // Paths are named against the repository so they match the diff and the
      // editor, but only when the target is genuinely inside it.
      if (diffState.repositoryRoot !== null && isInside(diffState.repositoryRoot, absoluteTarget)) {
        pathBase = diffState.repositoryRoot;
      }

      this.emit({
        type: "git:done",
        message: diffState.diffAware
          ? `Comparing against ${diffState.baseBranch ?? "the base branch"}`
          : diffRequested
            ? "No usable diff, reviewing the files as they are"
            : "Reviewing the selected scope in full",
        counts: { changedFiles: diffState.changedPaths.size },
      });
    }

    const scopeKind: ReviewScope["kind"] = targetStat.isFile
      ? "file"
      : diffState.repositoryRoot !== null && diffState.repositoryRoot === absoluteTarget
        ? "repository"
        : "directory";

    this.emit({ type: "discovery:start", message: "Collecting repository files" });

    const discovered = await this.discoverFiles(absoluteTarget, walkRoot, pathBase, targetStat.isFile, maxFiles);
    this.emit({
      type: "discovery:done",
      message: `Found ${discovered.length} candidate files`,
      counts: { files: discovered.length },
    });

    // Read and filter before selection: a file that turns out to be binary or
    // generated must not consume a slot in the review budget.
    const sources = await this.readSources(discovered, concurrency);
    const index = createSourceIndex(sources);
    const sourcesByPath = new Map(sources.map((source) => [source.path, source]));

    // Repository intelligence is computed from files already in hand, so it
    // costs no additional reads. The Rust indexer owned this step before the
    // migration; the numbers are the same, the runtime is no longer separate.
    const repositoryIndex = indexRepository({
      paths: discovered.map((file) => file.path),
      contents: new Map(sources.map((source) => [source.path, source.content])),
    });
    this.emit({
      type: "index:done",
      message: describeRepositoryIndex(repositoryIndex),
      counts: {
        files: repositoryIndex.filesIndexed,
        hotspots: repositoryIndex.hotspots.length,
        routeFiles: repositoryIndex.routeFiles,
      },
    });

    const targets = selectReviewTargets(
      discovered.filter((file) => index.has(file.path)),
      {
        changedPaths: diffState.diffAware ? [...diffState.changedPaths] : undefined,
        changedLinesByPath: diffState.changedLinesByPath,
        changedOnly: this.options.changedOnly,
        maxFiles,
      },
    );

    const contexts = new Map<string, FileContext>();
    for (const target of targets) {
      const source = sourcesByPath.get(target.file.path);
      if (source === undefined) continue;
      contexts.set(target.file.path, buildFileContext(source));
    }

    this.emit({
      type: "context:done",
      message: `Prepared context for ${contexts.size} files`,
      counts: { files: contexts.size },
    });

    const detectorResult = this.runDetectorStage(targets, sourcesByPath);
    this.emit({
      type: "detectors:done",
      message: `${detectorResult.candidates.length} candidate defects from deterministic detectors`,
      counts: { candidates: detectorResult.candidates.length, failedDetectors: detectorResult.failed.length },
    });

    const aiResult = await this.runAiStage(
      targets,
      contexts,
      diffState,
      index,
      repositoryIndex,
      pathBase,
      maxAiFiles,
      maxFindings,
      concurrency,
    );

    const allCandidates: AttributedCandidate[] = [...detectorResult.candidates, ...aiResult.candidates];

    const rejected: RejectedCandidate[] = [];
    const validated: ReviewFinding[] = [];
    /** One record per candidate, saying how far it travelled. */
    const journeys: ReviewCandidateTrace[] = [];

    for (const entry of allCandidates) {
      // A diff-scoped review only accepts anchors on lines the change touched.
      const changedLines = diffState.diffAware
        ? diffState.changedLinesByPath.get(toPosixPath(entry.candidate.file.trim()))
        : undefined;

      const outcome = validateCandidate(entry.candidate, index, { origin: entry.origin, changedLines });

      if (outcome.ok) {
        validated.push(outcome.finding);
        journeys.push(acceptedJourney(entry, outcome.finding, outcome.comparison));
      } else {
        rejected.push(outcome.rejected);
        journeys.push(rejectedJourney(entry, outcome.rejected));
      }
    }

    const { findings: unique, merged } = dedupeFindings(validated);
    rejected.push(...merged);
    for (const duplicate of merged) {
      markJourney(journeys, findingId(duplicate.file, duplicate.line, duplicate.title), "dedupe");
    }

    unique.sort(compareFindings);
    const findings = unique.slice(0, maxFindings);
    for (const dropped of unique.slice(maxFindings)) {
      rejected.push({
        file: dropped.location.file,
        line: dropped.location.line,
        lineEnd: dropped.location.lineEnd,
        title: dropped.title,
        reason: "over-finding-cap",
        detail: `dropped by the cap of ${maxFindings} findings`,
      });
      markJourney(journeys, dropped.id, "policy-rejected");
    }

    // The model stage's own tally, so the report says how much of the scope the
    // model actually judged rather than how many candidates it happened to emit.
    const aiReview =
      this.options.aiReviewer === undefined ? null : summariseAiReview(aiResult, targets.length);

    const stats = buildStats({
      discovered: discovered.length,
      reviewed: targets.length,
      candidatesProduced: allCandidates.length,
      rejections: rejected,
      merged: merged.length,
      findings,
      aiReview,
    });

    const limitations = collectLimitations({
      ai: aiReview,
      filesDiscovered: discovered.length,
      filesReviewed: targets.length,
      indexContentUnavailable: repositoryIndex.contentUnavailable,
      indexTruncatedFiles: repositoryIndex.truncatedFiles,
      diffAware: diffState.diffAware,
      baseBranch: diffState.baseBranch,
    });
    const state = resolveReviewState(limitations);

    this.emit({
      type: "validation:done",
      message: `${findings.length} findings kept, ${rejected.length} candidates dropped`,
      counts: { findings: findings.length, dropped: rejected.length },
    });

    const scope: ReviewScope = {
      root: absoluteTarget,
      pathBase,
      kind: scopeKind,
      branch: diffState.branch,
      baseBranch: diffState.baseBranch,
      diffAware: diffState.diffAware,
    };

    this.emit({ type: "done", message: "Review complete", progress: 1 });

    return {
      schema: "coderadar.review.findings.v1",
      verdict: findings.length === 0 ? "approve" : "needs-attention",
      summary: buildSummary(findings, scope, stats, aiResult.summary, state),
      scope,
      findings,
      rejected,
      state,
      limitations,
      stats,
      repositoryIndex,
      ...(this.options.collectTrace === true
        ? { trace: buildTrace({ targets, journeys, rejections: rejected, findings, aiStage: aiResult }) }
        : {}),
    };
  }

  /** Best-effort git state. A missing repository is normal, not an error. */
  private async collectDiff(
    target: string,
    root: string,
    isFile: boolean,
    diffRequested: boolean,
  ): Promise<DiffState> {
    const git = this.options.git;
    if (git === undefined) return EMPTY_DIFF;

    try {
      const repository = await git.detectRepository(isFile ? target : root);
      if (repository === null) return EMPTY_DIFF;

      // The repository is still detected without a diff review, because paths
      // are named against it. No base branch is resolved and no diff is read, so
      // `diffAware` stays false and no finding is anchored to a changed line.
      const base: DiffState = {
        repositoryRoot: repository.root,
        branch: repository.branch,
        baseBranch: null,
        changedPaths: new Set(),
        changedLinesByPath: new Map(),
        diffAware: false,
      };

      if (!diffRequested) return base;

      const baseBranch =
        this.options.baseBranch ?? (await git.resolveBaseBranch(repository.root, this.options.baseBranch));
      if (baseBranch === null) return base;

      const diffText = await git.diff(repository.root, baseBranch);
      const parsed = parseUnifiedDiff(diffText);
      if (!parsed.hasContent) return { ...base, baseBranch };

      const changedLinesByPath = new Map<string, Set<number>>();
      for (const file of parsed.files) {
        changedLinesByPath.set(file.path, changedLineNumbers(file));
      }

      return {
        ...base,
        baseBranch,
        changedPaths: new Set(diffPaths(parsed)),
        changedLinesByPath,
        diffAware: true,
      };
    } catch {
      // Git is an enhancement. When it fails the review still runs on the files.
      return EMPTY_DIFF;
    }
  }

  private async discoverFiles(
    target: string,
    walkRoot: string,
    pathBase: string,
    isFile: boolean,
    maxFiles: number,
  ): Promise<DiscoveredFile[]> {
    const fs = this.options.fs;

    /**
     * Names a file relative to `pathBase`. A file that is not below the base
     * cannot be described that way, so its own name is used rather than an
     * unhelpful path full of `..` segments.
     */
    const nameRelativeTo = (absolutePath: string): string => {
      const relative = fs.relative(pathBase, absolutePath);
      if (relative === "" || relative === ".." || relative.startsWith("../")) {
        return toPosixPath(fs.basename(absolutePath));
      }
      return toPosixPath(relative);
    };

    if (isFile) {
      const name = fs.basename(target);
      const stat = await fs.stat(target);
      return [
        {
          path: nameRelativeTo(target),
          absolutePath: target,
          size: stat.size,
          language: detectLanguage(name),
        },
      ];
    }

    const result = await discoverRepository(walkRoot, fs, {
      limits: { ...this.options.limits, maxFiles: this.options.limits?.maxFiles ?? maxFiles },
    });

    return result.files.map((file) => ({ ...file, path: nameRelativeTo(file.absolutePath) }));
  }

  /** Reads the files worth reviewing and drops the rest. */
  private async readSources(files: readonly DiscoveredFile[], concurrency: number): Promise<SourceFile[]> {
    const fs = this.options.fs;

    const results = await mapWithConcurrency(files, concurrency, async (file) => {
      try {
        const content = await fs.readTextFile(file.absolutePath);
        if (!isReviewableContent(file.path, content)) return null;
        return createSourceFile(file.path, content);
      } catch {
        return null;
      }
    });

    return results.filter((source): source is SourceFile => source !== null);
  }

  private runDetectorStage(
    targets: readonly ReviewTarget[],
    sourcesByPath: ReadonlyMap<string, SourceFile>,
  ): { candidates: AttributedCandidate[]; failed: string[] } {
    const candidates: AttributedCandidate[] = [];
    const failed: string[] = [];

    for (const target of targets) {
      const source = sourcesByPath.get(target.file.path);
      if (source === undefined) continue;

      const result = runDetectors(source, target.file.language);
      candidates.push(
        ...result.candidates.map((candidate) => ({
          candidate,
          requestedFile: target.file.path,
          origin: "detector" as const,
        })),
      );
      failed.push(...result.failed);
    }

    return { candidates, failed };
  }

  /**
   * The model stage. A provider failure is reported as an event and the review
   * continues: deterministic findings are better than no review at all, and a
   * provider outage must never look like clean code.
   *
   * Every attempt's outcome is kept, not just its candidates. A response that
   * could not be read and a file the model was never asked about produce no
   * candidates either, and the difference between those three cases is the whole
   * reason this method returns an outcome per file.
   */
  private async runAiStage(
    targets: readonly ReviewTarget[],
    contexts: ReadonlyMap<string, FileContext>,
    diffState: DiffState,
    index: SourceIndex,
    repositoryIndex: RepositoryIndex,
    pathBase: string,
    maxAiFiles: number,
    maxFindings: number,
    concurrency: number,
  ): Promise<AiStageResult> {
    const reviewer: AiReviewerPort | undefined = this.options.aiReviewer;
    if (reviewer === undefined) {
      return { candidates: [], summary: null, outcomes: new Map(), attempted: 0, selectedForModel: [] };
    }

    const bundle = await loadPromptBundle(this.options.fs, this.options.promptsDir);
    const selected = prioritiseHotspots(targets, repositoryIndex.hotspots).slice(0, maxAiFiles);
    if (selected.length === 0) {
      return { candidates: [], summary: null, outcomes: new Map(), attempted: 0, selectedForModel: [] };
    }

    const project = detectProjectProfile(index.paths());
    const tooling = await detectTooling(this.options.fs, pathBase);
    const projectLine = [
      describeProject(project.kind, project.packageManager, project.languages, tooling.linterConfigs),
      describeRepositoryIndex(repositoryIndex),
    ]
      .filter((part) => part !== "")
      .join(". ");
    const systemPrompt = buildSystemPrompt({ bundle, maxFindings, projectLine });
    const systemPromptBytes = utf8Bytes(systemPrompt);

    const candidates: AttributedCandidate[] = [];
    const outcomes = new Map<string, AiAttemptOutcome>();
    let summary: string | null = null;
    let lastFailure: string | null = null;
    let attempted = 0;

    this.emit({
      type: "ai:start",
      message: `Reviewing ${selected.length} files with ${reviewer.name}`,
      counts: { files: selected.length },
    });

    await mapWithConcurrency(selected, concurrency, async (target) => {
      const context = contexts.get(target.file.path);
      if (context === undefined) return;

      const changedLines = diffState.diffAware
        ? (diffState.changedLinesByPath.get(target.file.path) ?? new Set<number>())
        : new Set<number>();

      const related = buildRelatedFiles(context, contexts);
      const userPrompt = buildUserPrompt({ bundle, context, maxFindings, changedLines, related });
      // What the request carried, in sizes and counts only. A trace that held
      // prompt text would leak the code under review into a diagnostic artifact.
      const request: ReviewRequestTrace = {
        maxFindings,
        systemPromptBytes,
        userPromptBytes: utf8Bytes(userPrompt),
        fileLines: context.file.lines.length,
        contextWindows: context.windows.map((window) => ({ startLine: window.startLine, endLine: window.endLine })),
        relatedFiles: related.slice(0, RELATED_FILE_LIMIT).map((file) => file.path),
        changedLineCount: changedLines.size,
      };

      attempted += 1;
      const call = await callReviewer(reviewer, { systemPrompt, userPrompt, maxFindings });

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
      this.emit({
        type: "ai:failed",
        message: `AI review unavailable, continuing with detectors only (${lastFailure}${detail})`,
      });
    }

    this.emit({
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
}

/** The parser's own record of one answer. Absent when the call itself threw. */
type ParserTrace = NonNullable<ReviewFileTrace["parser"]>;

/** One file's model attempt, as it is recorded for the report. */
interface AiAttemptOutcome {
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
 * A candidate plus the reviewed file it entered the pipeline under.
 *
 * Attribution is not the candidate's own `file` claim. A model that answers
 * about a different file is exactly the case `file-not-in-scope` exists for, and
 * a trace that filed such a candidate under the claimed path would report a file
 * that produced nothing while the file actually sent to the model looked clean.
 */
interface AttributedCandidate {
  candidate: CandidateFinding;
  requestedFile: string;
  origin: "detector" | "ai";
}

interface AiStageResult {
  candidates: AttributedCandidate[];
  summary: string | null;
  /** Keyed by reviewed-file path. A file absent here was never sent. */
  outcomes: ReadonlyMap<string, AiAttemptOutcome>;
  /** Files the reviewer was actually called for. */
  attempted: number;
  /** Reviewed files the model budget selected, sent or not. */
  selectedForModel: readonly string[];
}

/** True when `candidate` is `ancestor` itself or lives beneath it. */
function isInside(ancestor: string, candidate: string): boolean {
  const normalise = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const parent = normalise(ancestor);
  const child = normalise(candidate);
  return child === parent || child.startsWith(`${parent}/`);
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

function buildStats(input: {
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
function summariseAiReview(result: AiStageResult, filesReviewed: number): AiReviewSummary {
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

interface TraceInput {
  targets: readonly ReviewTarget[];
  journeys: readonly ReviewCandidateTrace[];
  rejections: readonly RejectedCandidate[];
  findings: readonly ReviewFinding[];
  aiStage: AiStageResult;
}

function buildTrace(input: TraceInput): ReviewFileTrace[] {
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
function acceptedJourney(
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
function rejectedJourney(entry: AttributedCandidate, rejection: RejectedCandidate): ReviewCandidateTrace {
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
function markJourney(
  journeys: readonly ReviewCandidateTrace[],
  id: string,
  outcome: "dedupe" | "policy-rejected",
): void {
  const journey = journeys.find((entry) => entry.findingId === id && entry.finalOutcome === "retained");
  if (journey !== undefined) journey.finalOutcome = outcome;
}

/**
 * What a summary says when the review is not complete.
 *
 * A model's own summary is not enough here: a model that never read a file cannot
 * describe the review, and the deterministic sentence must not read like a clean
 * bill of health either. Both are augmented with the state, so a run with zero
 * findings behind a broken stage cannot read as clean code.
 */
const INCOMPLETE_NOTICE: Record<Exclude<ReviewState, "complete">, string> = {
  partial: "The review covered less than the full scope; see the recorded limitations.",
  degraded:
    "This review is incomplete: a stage did not produce a result, so a missing finding is not evidence of clean code.",
  failed: "The review did not complete, so this result is not a statement about the code.",
};

function buildSummary(
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
