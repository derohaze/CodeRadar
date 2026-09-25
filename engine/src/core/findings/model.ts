/**
 * Canonical review finding model.
 *
 * This is a NEW versioned contract (`coderadar.review.findings.v1`). It is kept
 * deliberately separate from the legacy scan `Finding` type the frontend still
 * consumes, so the shipping app keeps working while the review flow is built
 * alongside it. See docs/review-engine-migration-plan.md, section "Phases".
 *
 * Every field exists because the product requires it: a finding must state the
 * defect, prove it with evidence, say why it matters, and offer a fix. A finding
 * that cannot fill `evidence` is not a finding, and the validator drops it.
 */

export const REVIEW_SCHEMA = "coderadar.review.findings.v1" as const;
export type ReviewSchema = typeof REVIEW_SCHEMA;

export const REVIEW_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

/**
 * The axes are the review bar's axes. They are part of the contract because the
 * UI groups findings by them and because the validator uses them to decide
 * whether a claim is even expressible as a defect.
 */
export const REVIEW_AXES = [
  "correctness",
  "security",
  "error-handling",
  "concurrency",
  "api-contract",
  "performance",
  "resource",
  "standards",
  "tests",
  "docs",
] as const;
export type ReviewAxis = (typeof REVIEW_AXES)[number];

/** Where a candidate came from. Detectors are deterministic; AI is not. */
export type FindingOrigin = "detector" | "ai";

export interface FindingLocation {
  /** Repository-relative path, always POSIX separators. */
  file: string;
  /** 1-based first line. */
  line: number;
  /** 1-based last line, inclusive. Never less than `line`. */
  lineEnd: number;
}

export interface ReviewFinding {
  id: string;
  schema: ReviewSchema;
  severity: ReviewSeverity;
  axis: ReviewAxis;
  /** One sentence naming the defect. */
  title: string;
  location: FindingLocation;
  /** What is wrong. */
  problem: string;
  /** Why this is actually a problem, not a preference. */
  why: string;
  /** The consequence if it ships. */
  impact: string;
  /** Quoted code with the file:line it came from. */
  evidence: string;
  /** 0-100. See policy.ts for how this is enforced against severity. */
  confidence: number;
  /** The concrete change to make. */
  fix: string;
  /** A patch the author can apply, when one is short enough to be useful. */
  suggestedPatch: string | null;
  /** A test that would have caught this, when one is meaningful. */
  suggestedTest: string | null;
  origin: FindingOrigin;
  /** Detector id, present only when `origin` is "detector". */
  detector?: string;
}

/** Why a candidate never became a finding. Kept for observability, not for UI. */
export interface RejectedCandidate {
  file: string;
  line: number;
  title: string;
  /** Stable machine-readable reason. */
  reason: RejectionReason;
  /** Human-readable detail, safe to log. */
  detail: string;
}

export type RejectionReason =
  | "missing-field"
  | "too-short"
  | "excluded-concern"
  | "low-confidence"
  | "severity-not-supported"
  | "line-out-of-range"
  | "file-not-in-scope"
  /** The file was reviewed, but the anchor is not on a line the change touched. */
  | "anchor-outside-changed-lines"
  | "evidence-not-in-source"
  | "invalid-location"
  /** The candidate was the same defect as one already kept. */
  | "merged-duplicate"
  /** The candidate cleared the bar but fell outside the report's cap. */
  | "over-finding-cap";

export interface ReviewStats {
  filesDiscovered: number;
  filesReviewed: number;
  candidatesProduced: number;
  candidatesRejected: number;
  duplicatesMerged: number;
  findingsKept: number;
  /** Rejection counts by reason, so tuning is measurement-driven. */
  rejectionsByReason: Record<string, number>;
}

export interface ReviewScope {
  /** Absolute path the review was rooted at, exactly what the caller asked for. */
  root: string;
  /**
   * Absolute path that every `location.file` is relative to.
   *
   * This differs from `root` whenever a subdirectory of a repository is
   * reviewed: the walk never leaves `root`, but paths are named against the
   * repository so they match the paths a diff and the editor use. A consumer
   * that needs to open a file must join it against `pathBase`, not `root`.
   */
  pathBase: string;
  kind: "file" | "directory" | "repository";
  /** Empty when no git history was available. */
  branch: string | null;
  baseBranch: string | null;
  /** True when changed-file ordering was applied. */
  diffAware: boolean;
}

/** A file worth a reviewer's first attention. Never a finding on its own. */
export interface RepositoryHotspot {
  file: string;
  score: number;
  reasons: string[];
}

/**
 * Repository intelligence gathered while reviewing: what the tree is made of
 * and where its risky entry points are. Recorded on the report so the UI can
 * show what was understood, and used to order which files the model sees first.
 */
export interface RepositoryIndex {
  filesIndexed: number;
  /** Language id to file count. */
  languages: Record<string, number>;
  /** Repository-relative paths of dependency manifests. */
  manifests: string[];
  routeFiles: number;
  authFiles: number;
  sourceMarkers: number;
  sinkMarkers: number;
  /** Highest-scoring first, then by path. */
  hotspots: RepositoryHotspot[];
  truncatedFiles: number;
  bytesIndexed: number;
  /** True when no file content was available, so markers could not be counted. */
  contentUnavailable: boolean;
}

export interface ReviewReport {
  schema: ReviewSchema;
  verdict: "approve" | "needs-attention";
  /** One paragraph on what the reviewed code does and whether it is safe to ship. */
  summary: string;
  scope: ReviewScope;
  findings: ReviewFinding[];
  rejected: RejectedCandidate[];
  stats: ReviewStats;
  repositoryIndex: RepositoryIndex;
}

export function severityRank(severity: ReviewSeverity): number {
  return REVIEW_SEVERITIES.indexOf(severity);
}

/** Negative when `a` is more severe than `b`, so it sorts ascending. */
export function compareSeverity(a: ReviewSeverity, b: ReviewSeverity): number {
  return severityRank(a) - severityRank(b);
}

export function clampingConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Normalises a location so `lineEnd >= line` and both are positive integers. */
export function normaliseLocation(location: FindingLocation): FindingLocation | null {
  const { file } = location;
  if (typeof file !== "string" || file.trim() === "") return null;

  const line = Math.trunc(location.line);
  const rawEnd = Number.isFinite(location.lineEnd) ? Math.trunc(location.lineEnd) : line;
  if (!Number.isFinite(line) || line < 1) return null;

  const lineEnd = rawEnd < line ? line : rawEnd;
  return { file: toPosixPath(file), line, lineEnd };
}

export function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}
