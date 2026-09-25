/**
 * Public API of the CodeRadar review engine.
 *
 * Everything a consumer needs is re-exported here, and the core is imported
 * through this file so the internal module layout stays free to change. The
 * HTTP adapter, the Electron main process, and the CLI all depend on exactly
 * this surface.
 */

// Model and contract
export {
  REVIEW_SCHEMA,
  REVIEW_SEVERITIES,
  REVIEW_AXES,
  severityRank,
  compareSeverity,
  clampingConfidence,
  normaliseLocation,
  toPosixPath,
} from "./core/findings/model.ts";
export type {
  ReviewFinding,
  ReviewReport,
  ReviewSeverity,
  ReviewAxis,
  ReviewScope,
  ReviewStats,
  FindingLocation,
  FindingOrigin,
  RejectedCandidate,
  RejectionReason,
  RepositoryIndex,
  RepositoryHotspot,
} from "./core/findings/model.ts";

// Repository index, ported from the retired Rust indexer
export {
  indexRepository,
  fileSignals,
  hotspotFor,
  describeRepositoryIndex,
} from "./core/indexing/index-repository.ts";
export type { IndexInput } from "./core/indexing/index-repository.ts";
export { HOTSPOT_LIMIT, MANIFEST_FILES, MAX_INDEXED_FILE_BYTES } from "./core/indexing/catalog.ts";

// Policy
export {
  CONFIDENCE_FLOOR,
  MAX_FINDINGS,
  SEVERITY_CONFIDENCE_REQUIREMENT,
  MIN_TEXT_LENGTH,
  isExcludedConcern,
  normaliseAxis,
  normaliseSeverity,
  resolveSeverity,
  compareFindings,
} from "./core/findings/policy.ts";

// Validation
export {
  MAX_ANCHOR_LINES,
  extractEvidenceQuotes,
  isEvidenceAnchored,
  findingId,
  validateCandidate,
} from "./core/findings/validate.ts";
export type { CandidateFinding, ValidationOutcome, ValidateOptions } from "./core/findings/validate.ts";

// Deduplication
export { dedupeFindings, tokenSimilarity, tokenise } from "./core/findings/dedupe.ts";

// Pipeline
export { ReviewEngine } from "./core/review/engine.ts";
export type { ReviewEngineOptions, ReviewRequest } from "./core/review/engine.ts";

// Ports
export type {
  AiReviewerPort,
  AiReviewRequest,
  DirectoryEntry,
  FileSystemPort,
  GitPort,
  GitRepositoryInfo,
  PathStat,
  ReviewEvent,
  ReviewEventSink,
  ReviewEventType,
} from "./core/ports.ts";

// Model access and prompt handling
export {
  createHttpAiReviewer,
  createStaticAiReviewer,
  parseReviewResponse,
  redactSecrets,
  extractJsonObject,
  AiReviewerError,
} from "./core/review/ai-reviewer.ts";
export type { HttpAiReviewerOptions, ParsedReviewResponse } from "./core/review/ai-reviewer.ts";
export { loadPromptBundle, REQUIRED_PROMPT_FILES } from "./core/review/prompts.ts";
export { buildSystemPrompt, buildUserPrompt, formatLineRanges } from "./core/review/prompt.ts";
export type { ReviewerPromptInput, SystemPromptInput } from "./core/review/prompt.ts";

// Repository understanding
export { detectLanguage, detectProjectProfile, languageFamilyOf, looksBinary, looksGenerated } from "./core/languages/detect.ts";
export type { LanguageInfo, LanguageFamily, ProjectProfile, ProjectKind } from "./core/languages/detect.ts";
export { discoverRepository, isIgnoredPath, isReviewableContent, DEFAULT_DISCOVERY_LIMITS } from "./core/repository/discover.ts";
export type { DiscoveredFile, DiscoveryLimits, DiscoveryResult } from "./core/repository/discover.ts";
export { selectReviewTargets } from "./core/repository/select.ts";
export type { ReviewTarget } from "./core/repository/select.ts";
export { buildFileContext, buildRelatedFiles, resolveModulePath } from "./core/repository/context.ts";
export type { FileContext, RelatedFile } from "./core/repository/context.ts";
export { createSourceFile, createSourceIndex } from "./core/repository/source.ts";
export type { SourceFile, SourceIndex } from "./core/repository/source.ts";
export { detectTooling } from "./core/repository/tooling.ts";
export type { ToolingProfile } from "./core/repository/tooling.ts";

// Diff
export { parseUnifiedDiff, addedLineNumbers, changedLineNumbers, diffPaths } from "./core/diff/unified.ts";
export type { FileDiff, DiffHunk, DiffLine, ParsedDiff } from "./core/diff/unified.ts";

// Detectors
export { ALL_DETECTORS, runDetectors, detectorsFor } from "./core/review/detectors/index.ts";
export type { Detector, DetectorInput } from "./core/review/detectors/index.ts";

// Adapters
export { createNodeFileSystem } from "./adapters/node-fs.ts";
export { createNodeGit, isSafeRef } from "./adapters/node-git.ts";
export type { NodeGitOptions } from "./adapters/node-git.ts";

// Utility
export { mapWithConcurrency } from "./core/concurrency.ts";
