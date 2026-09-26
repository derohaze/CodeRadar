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

import type { AiReviewTelemetry } from "../ports.ts";

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

/**
 * What a rejection decided on, recorded so a dropped candidate can be explained
 * from the report alone.
 *
 * Rejections used to keep only a reason, which made "the model found nothing"
 * and "the model's claim did not survive the bar" indistinguishable — the two
 * need opposite responses. Nothing here changes what is accepted: the fields are
 * the inputs to the decision and the outcome of the comparison it ran.
 */
export interface RejectionDiagnostics {
  /** The candidate's own claim, verbatim, before any interpretation. */
  evidence?: string;
  /** What was treated as a claim about the source: the quotes the extractor found. */
  quotes?: string[];
  /** The comparison the evidence gate ran, per quote: whether the file contains it. */
  quotesFound?: boolean[];
  /** The file the gate compared against, and how much of it there was. */
  compared?: { file: string; chars: number };
  /** True when nothing usable was quoted, so a file reference decided instead. */
  usedFileReference?: boolean;
  /** As the candidate stated them, before normalisation. */
  axis?: string;
  severity?: string;
  confidence?: number;
}

/**
 * Why a candidate never became a finding.
 *
 * Dropped candidates are shown to the reviewer with the reason each one was
 * dropped, so a refusal is distinguishable from a miss. The fields are the claim
 * as it arrived, unedited: nothing here is repaired into a finding shape.
 */
export interface RejectedCandidate {
  file: string;
  line: number;
  /** Last line of the anchor the candidate asked for. Never less than `line`. */
  lineEnd: number;
  title: string;
  /** Stable machine-readable reason. */
  reason: RejectionReason;
  /** Human-readable detail, safe to log. */
  detail: string;
  /** The claim and the comparison behind the rejection. */
  diagnostics?: RejectionDiagnostics;
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

/**
 * What one model attempt yielded.
 *
 * `valid` and `empty` are both readable answers: `empty` is the model saying a
 * file holds no defect, which is a real answer and is what clean code looks
 * like. `partial` is readable but incomplete. `invalid` is a response that could
 * not be read as a review at all, and `unavailable` is a call that never
 * produced one. Only the last two mean the model's judgement is missing rather
 * than negative, and they must never be presented as clean code.
 */
export type AiReviewOutcome = "valid" | "empty" | "partial" | "invalid" | "unavailable";

/** Counts of what the model stage actually produced. Null when it did not run. */
export interface AiReviewSummary {
  /** Files the model was asked about. */
  attempted: number;
  valid: number;
  empty: number;
  partial: number;
  invalid: number;
  unavailable: number;
  /** Entries the parser could not turn into a candidate, across all answers. */
  entriesDropped: number;
  /** Reviewed files the model was never asked about, because of the AI budget. */
  notSent: number;
}

/**
 * Why a review is not a complete answer.
 *
 * A limitation is not a finding: it never contributes to the verdict, is never
 * counted as a false positive, and never appears in `findings`. It exists so a
 * review that could not read a file — or could not read the model's answer — is
 * distinguishable from a review that read everything and found nothing. Those
 * two need opposite responses from the person reading the result.
 */
export type ReviewLimitationCode =
  /** The model was requested but no provider was usable. */
  | "ai-unavailable"
  /** The model was deliberately left out of this run. */
  | "ai-not-requested"
  /** The provider was called and the call did not produce a response. */
  | "ai-provider-unavailable"
  /** A model response arrived but could not be read as a review. */
  | "ai-response-invalid"
  /** A model response was readable but some entries were unusable. */
  | "ai-entries-dropped"
  /** Reviewed files the model was never asked about. */
  | "ai-coverage-incomplete"
  /** Files in the selected scope were never read. */
  | "coverage-incomplete"
  /** No file content was available, so the index could not be computed. */
  | "index-content-unavailable"
  /** Files were too large to index in full. */
  | "index-truncated-files"
  /** The review is anchored to changed lines, which narrows what is reported. */
  | "diff-scoped";

export interface ReviewLimitation {
  code: ReviewLimitationCode;
  /** One sentence a reviewer can act on. */
  detail: string;
  /** How many things the sentence is about, when the sentence has a count. */
  count?: number;
}

/**
 * How complete a review is.
 *
 * This is a property of the review, not of the findings, and it is deliberately
 * not derivable from a findings count: zero findings with `complete` means clean
 * code, and zero findings with `degraded` means a stage did not run.
 */
export type ReviewState =
  /** Every file in scope was read and every model answer was readable. */
  | "complete"
  /** Everything in scope was read, but something was narrowed or dropped. */
  | "partial"
  /** A stage did not run or could not be read, so the answer is not trustworthy. */
  | "degraded"
  /** No review result exists at all. */
  | "failed";

/**
 * One file's journey through the pipeline, for diagnosing a run.
 *
 * A trace answers "why is this defect not in the report": was the file selected,
 * was it sent to the model, what did the model answer, what was dropped and for
 * which reason. Only counts and reasons live here — no source content, and no
 * prompt or response text.
 */
export interface ReviewCandidateTrace {
  /** File the model was asked to inspect. */
  requestedFile: string;
  origin: FindingOrigin;
  /** Candidate-provided location. No model prose or evidence text is copied here. */
  file: string;
  line: number;
  lineEnd: number;
  fieldsPresent: { title: boolean; problem: boolean; why: boolean; impact: boolean; evidence: boolean; fix: boolean };
  evidence: { quoteCount: number; quotesFound: boolean[]; anchored: boolean | null };
  validator: "accepted" | "rejected";
  rejectionReason?: RejectionReason | undefined;
  finalOutcome: "retained" | "dedupe" | "policy-rejected" | "rejected";
  findingId?: string | undefined;
}

export interface ReviewRequestTrace {
  maxFindings: number;
  systemPromptBytes: number;
  userPromptBytes: number;
  fileLines: number;
  contextWindows: Array<{ startLine: number; endLine: number }>;
  relatedFiles: string[];
  changedLineCount: number;
}

export interface ReviewFileTrace {
  file: string;
  /** True when selection kept the file for review. */
  selected: boolean;
  /** True when the AI budget selected the file for model review. */
  selectedForModel: boolean;
  /** True when the file was sent to the model. */
  sentToModel: boolean;
  /** Absent when the file was never sent to the model. */
  modelOutcome?: AiReviewOutcome | undefined;
  provider?: string | null | undefined;
  model?: string | null | undefined;
  modelErrorName?: string | undefined;
  request?: ReviewRequestTrace | undefined;
  response?: AiReviewTelemetry | undefined;
  parser?:
    | {
        shape: string;
        issues: string[];
        entriesDropped: number;
        candidateCount: number;
        /** `content` / `reasoning-content` / `none`: where the answer was read from. */
        answerField: string;
      }
    | undefined;
  candidateDetails: ReviewCandidateTrace[];
  /** Candidates the file produced before validation, by origin. */
  candidates: { detector: number; ai: number };
  /** Findings from this file that survived validation, dedupe and policy. */
  findings: number;
  /** Candidates from this file that were dropped, by rejection reason. */
  rejections: Record<string, number>;
}

export interface ReviewStats {
  filesDiscovered: number;
  filesReviewed: number;
  candidatesProduced: number;
  candidatesRejected: number;
  duplicatesMerged: number;
  findingsKept: number;
  /** Rejection counts by reason, so tuning is measurement-driven. */
  rejectionsByReason: Record<string, number>;
  /** What the model stage produced. Null when no reviewer was configured. */
  aiReview: AiReviewSummary | null;
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
  /** How complete this review is. Not derivable from `findings.length`. */
  state: ReviewState;
  /** Why it is not complete. Never a finding, never a rejection. */
  limitations: ReviewLimitation[];
  stats: ReviewStats;
  repositoryIndex: RepositoryIndex;
  /** Present only when the caller asked for a trace. */
  trace?: ReviewFileTrace[] | undefined;
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
