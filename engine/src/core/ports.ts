/**
 * Ports the core depends on.
 *
 * The core never imports `node:fs`, `node:path`, or a git binary. Everything it
 * needs from the outside world arrives through one of these interfaces, which is
 * what makes the pipeline testable without touching a real repository and what
 * will let the Electron main process and the HTTP adapter share it unchanged.
 */

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
}

export interface PathStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
}

export interface FileSystemPort {
  readTextFile(path: string): Promise<string>;
  listDirectory(path: string): Promise<DirectoryEntry[]>;
  stat(path: string): Promise<PathStat>;
  exists(path: string): Promise<boolean>;

  // Path arithmetic lives behind the port so the core contains no platform
  // assumptions about separators.
  join(...segments: string[]): string;
  resolve(...segments: string[]): string;
  /** Path of `to` relative to `from`, always POSIX separators. */
  relative(from: string, to: string): string;
  basename(path: string): string;
  /** Parent directory of a path. */
  directoryName(path: string): string;
}

export interface GitRepositoryInfo {
  /** Absolute path of the repository root, as reported by git. */
  root: string;
  /** Current branch, or null when detached. */
  branch: string | null;
}

export interface GitPort {
  detectRepository(path: string): Promise<GitRepositoryInfo | null>;
  /** Best guess at the branch this one should be reviewed against. */
  resolveBaseBranch(root: string, preferred?: string): Promise<string | null>;
  /** Unified diff of `base` against the working tree. */
  diff(root: string, base: string): Promise<string>;
  /** Files that differ from `base`, repository-relative and POSIX. */
  changedFiles(root: string, base: string): Promise<string[]>;
}

/**
 * A raw model response. It is deliberately `unknown`: this port is the trust
 * boundary for model output, and nothing downstream may assume its shape.
 */
export interface AiReviewRequest {
  systemPrompt: string;
  userPrompt: string;
  /** Upper bound on candidates the model may return. */
  maxFindings: number;
}

export interface AiReviewerPort {
  readonly name: string;
  review(request: AiReviewRequest): Promise<unknown>;
}

/** Progress reporting for the UI. Never carries source content. */
export type ReviewEventType =
  | "discovery:start"
  | "discovery:done"
  | "index:done"
  | "git:start"
  | "git:done"
  | "context:done"
  | "detectors:done"
  | "ai:start"
  | "ai:done"
  | "ai:retry"
  | "ai:failed"
  | "validation:done"
  | "done";

export interface ReviewEvent {
  type: ReviewEventType;
  message: string;
  /** 0-1 when the stage can be quantified. */
  progress?: number;
  /** Counts safe to display. */
  counts?: Record<string, number>;
}

export type ReviewEventSink = (event: ReviewEvent) => void;
