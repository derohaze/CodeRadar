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
  RejectedCandidate,
  ReviewCandidateTrace,
  ReviewFinding,
  ReviewReport,
  ReviewScope,
} from "../findings/model.ts";
import { compareFindings } from "../findings/policy.ts";
import { dedupeFindings } from "../findings/dedupe.ts";
import { findingId, validateCandidate } from "../findings/validate.ts";
import { describeRepositoryIndex, indexRepository } from "../indexing/index-repository.ts";
import { detectLanguage } from "../languages/detect.ts";
import type { AiReviewerPort, FileSystemPort, GitPort, ReviewEvent, ReviewEventSink } from "../ports.ts";
import { buildFileContext } from "../repository/context.ts";
import type { FileContext } from "../repository/context.ts";
import { discoverRepository, isReviewableContent } from "../repository/discover.ts";
import type { DiscoveredFile, DiscoveryLimits } from "../repository/discover.ts";
import { selectReviewTargets } from "../repository/select.ts";
import type { ReviewTarget } from "../repository/select.ts";
import { createSourceFile, createSourceIndex } from "../repository/source.ts";
import type { SourceFile } from "../repository/source.ts";
import type { AttributedCandidate } from "./candidates.ts";
import { runDetectors } from "./detectors/index.ts";
import { collectLimitations, resolveReviewState } from "./limitations.ts";
import { acceptedJourney, buildTrace, markJourney, rejectedJourney } from "./report/trace.ts";
import { buildStats, summariseAiReview } from "./report/stats.ts";
import { buildSummary } from "./report/summary.ts";
import { runAiStage } from "./stages/ai-stage.ts";

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_AI_FILES = 40;
const DEFAULT_MAX_FINDINGS = 15;
const DEFAULT_CONCURRENCY = 8;

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

    const aiResult = await runAiStage({
      reviewer: this.options.aiReviewer,
      fs: this.options.fs,
      promptsDir: this.options.promptsDir,
      targets,
      contexts,
      repositoryIndex,
      projectPaths: index.paths(),
      pathBase,
      changedLinesByPath: diffState.changedLinesByPath,
      diffAware: diffState.diffAware,
      maxAiFiles,
      maxFindings,
      concurrency,
      emit: (event) => this.emit(event),
    });

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

}

/** True when `candidate` is `ancestor` itself or lives beneath it. */
function isInside(ancestor: string, candidate: string): boolean {
  const normalise = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const parent = normalise(ancestor);
  const child = normalise(candidate);
  return child === parent || child.startsWith(`${parent}/`);
}


