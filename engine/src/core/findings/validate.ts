/**
 * Finding validation.
 *
 * This is the module that makes the product's central promise true: a finding
 * is only shown when it has a trigger, a wrong result, and evidence that exists
 * in the reviewed source. Nothing downstream may re-add a rejected candidate.
 *
 * The checks run cheapest and most decisive first. The one that matters most is
 * evidence anchoring: it is the only defence against a model that invents a
 * plausible defect on a plausible line.
 */

import {
  REVIEW_SCHEMA,
  clampingConfidence,
  normaliseLocation,
  toPosixPath,
} from "./model.ts";
import type {
  FindingOrigin,
  RejectedCandidate,
  RejectionReason,
  ReviewAxis,
  ReviewFinding,
  ReviewSeverity,
} from "./model.ts";
import {
  CONFIDENCE_FLOOR,
  MIN_TEXT_LENGTH,
  isExcludedConcern,
  normaliseAxis,
  normaliseSeverity,
  resolveSeverity,
} from "./policy.ts";
import { collapseWhitespace } from "../repository/source.ts";
import type { SourceIndex } from "../repository/source.ts";

/** The bar caps an anchor at ten lines. More than that is a range, not an anchor. */
export const MAX_ANCHOR_LINES = 10;

/**
 * `critical` means a reachable security or data-loss defect. A documentation or
 * performance claim cannot be critical, and saying otherwise is the severity
 * inflation the bar forbids.
 */
const CRITICAL_ELIGIBLE_AXES = new Set<ReviewAxis>([
  "security",
  "correctness",
  "concurrency",
  "resource",
  "api-contract",
  "error-handling",
]);

/** Raw candidate as produced by a detector or parsed from a model response. */
export interface CandidateFinding {
  file: string;
  line: number;
  lineEnd?: number;
  severity: string;
  axis: string;
  title: string;
  problem: string;
  why: string;
  impact: string;
  evidence: string;
  confidence: number;
  fix: string;
  suggestedPatch?: string | null;
  suggestedTest?: string | null;
  detector?: string;
}

export type ValidationOutcome =
  | { ok: true; finding: ReviewFinding }
  | { ok: false; rejected: RejectedCandidate };

function reject(
  candidate: { file: string; line: number; title: string },
  reason: RejectionReason,
  detail: string,
): ValidationOutcome {
  return {
    ok: false,
    rejected: {
      file: toPosixPath(candidate.file || "unknown"),
      line: Number.isFinite(candidate.line) ? candidate.line : 0,
      title: candidate.title || "(untitled)",
      reason,
      detail,
    },
  };
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Pulls the snippets a candidate is claiming as evidence. Models quote with
 * backticks or double quotes; detectors use backticks. Only quoted material is
 * treated as a claim about the source, because prose evidence cannot be checked.
 */
export function extractEvidenceQuotes(evidence: string): string[] {
  const quotes: string[] = [];
  const patterns = [/`([^`]+)`/g, /"([^"\n]+)"/g];

  for (const pattern of patterns) {
    for (const match of evidence.matchAll(pattern)) {
      const quote = match[1];
      if (quote === undefined) continue;
      const trimmed = quote.trim();
      if (trimmed.length >= MIN_TEXT_LENGTH.evidence) quotes.push(trimmed);
    }
  }

  return quotes;
}

/**
 * True when the candidate points at something that is actually in the file.
 *
 * Quoted code must appear in the reviewed file, compared whitespace-insensitively
 * so indentation and trailing space never decide the outcome. When a candidate
 * offers no quoted code at all, it must at least reference the file it claims to
 * be talking about, otherwise there is nothing to verify and the claim is
 * unverifiable rather than merely terse.
 */
export function isEvidenceAnchored(evidence: string, file: { content: string; path: string }): boolean {
  const quotes = extractEvidenceQuotes(evidence);

  if (quotes.length > 0) {
    const haystack = collapseWhitespace(file.content);
    return quotes.some((quote) => haystack.includes(collapseWhitespace(quote)));
  }

  const normalised = collapseWhitespace(evidence);
  if (normalised === "") return false;
  const fileName = file.path.split("/").pop() ?? file.path;
  return normalised.includes(file.path) || (fileName !== "" && normalised.includes(fileName));
}

/**
 * Stable, deterministic finding id. Deterministic matters: the UI diffs runs,
 * and an id that changes between identical runs makes every finding look new.
 */
export function findingId(file: string, line: number, title: string): string {
  const seed = `${toPosixPath(file)}:${line}:${collapseWhitespace(title).toLowerCase()}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `f-${hash.toString(16).padStart(8, "0")}`;
}

export interface ValidateOptions {
  origin: FindingOrigin;
  /**
   * When true, the anchored range must intersect lines that the diff touched.
   * Used for diff-aware reviews so unchanged code does not flood the results.
   */
  changedLines?: ReadonlySet<number> | undefined;
}

export function validateCandidate(
  candidate: CandidateFinding,
  index: SourceIndex,
  options: ValidateOptions,
): ValidationOutcome {
  const title = asText(candidate.title);
  const problem = asText(candidate.problem);
  const why = asText(candidate.why);
  const impact = asText(candidate.impact);
  const evidence = asText(candidate.evidence);
  const fix = asText(candidate.fix);

  const summary = { file: asText(candidate.file), line: candidate.line, title };

  // 1. Shape. A candidate missing a required field cannot be repaired into a
  //    finding, because inventing the missing text is exactly what we forbid.
  const missing: string[] = [];
  if (title === "") missing.push("title");
  if (problem === "") missing.push("problem");
  if (why === "") missing.push("why");
  if (impact === "") missing.push("impact");
  if (evidence === "") missing.push("evidence");
  if (fix === "") missing.push("fix");
  if (summary.file === "") missing.push("file");
  if (missing.length > 0) {
    return reject(summary, "missing-field", `missing: ${missing.join(", ")}`);
  }

  // 2. Length. One-word filler is not a claim.
  if (
    title.length < MIN_TEXT_LENGTH.title ||
    problem.length < MIN_TEXT_LENGTH.problem ||
    why.length < MIN_TEXT_LENGTH.why ||
    impact.length < MIN_TEXT_LENGTH.impact ||
    fix.length < MIN_TEXT_LENGTH.fix
  ) {
    return reject(summary, "too-short", "a required field is too short to state a defect");
  }

  // 3. Preference, not defect. The bar forbids these outright.
  if (isExcludedConcern(title, problem)) {
    return reject(summary, "excluded-concern", "describes a preference or something tooling already catches");
  }

  // 4. The axis has to be one of the review axes. An axis the bar excludes
  //    (`style`, `naming`) is a preference, so it fails here rather than later.
  const severity = normaliseSeverity(candidate.severity);
  if (severity === null) {
    return reject(summary, "missing-field", `unrecognised severity: ${String(candidate.severity)}`);
  }

  const axis = normaliseAxis(candidate.axis);
  if (axis === null) {
    return reject(summary, "excluded-concern", `axis is not reviewable or not recognised: ${String(candidate.axis)}`);
  }

  // 5. The file must be one we actually reviewed. A finding against a file we
  //    did not read cannot be verified and is usually a hallucinated path.
  const file = index.get(summary.file);
  if (file === undefined) {
    return reject(summary, "file-not-in-scope", "file was not part of the reviewed scope");
  }

  // 6. The anchor must be real and tight.
  const location = normaliseLocation({
    file: summary.file,
    line: candidate.line,
    lineEnd: candidate.lineEnd ?? candidate.line,
  });
  if (location === null) {
    return reject(summary, "invalid-location", `line ${String(candidate.line)} is not a usable anchor`);
  }
  if (location.line > file.lines.length) {
    return reject(
      summary,
      "line-out-of-range",
      `line ${location.line} is past the end of the file (${file.lines.length} lines)`,
    );
  }
  const lineEnd = Math.min(location.lineEnd, file.lines.length);
  if (lineEnd - location.line + 1 > MAX_ANCHOR_LINES) {
    return reject(summary, "line-out-of-range", `anchor spans ${lineEnd - location.line + 1} lines`);
  }

  // BUG GUARD: diff-scoped reviews must only report on lines the change touched.
  if (options.changedLines !== undefined && options.changedLines.size > 0) {
    let overlaps = false;
    for (let line = location.line; line <= lineEnd; line += 1) {
      if (options.changedLines.has(line)) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) {
      // A distinct reason from `file-not-in-scope`: the file was reviewed, only
      // the anchor is outside the change. Reporting them as the same thing makes
      // the rejection counts useless for tuning.
      return reject(summary, "anchor-outside-changed-lines", "anchor is outside the changed lines for this review");
    }
  }

  // 7. Confidence floor, then severity the confidence can actually support.
  const confidence = clampingConfidence(candidate.confidence);
  if (confidence < CONFIDENCE_FLOOR) {
    return reject(summary, "low-confidence", `confidence ${confidence} is below the floor of ${CONFIDENCE_FLOOR}`);
  }

  if (severity === "critical" && !CRITICAL_ELIGIBLE_AXES.has(axis)) {
    return reject(summary, "severity-not-supported", `a ${axis} issue cannot be critical`);
  }

  const resolvedSeverity: ReviewSeverity = resolveSeverity(severity, confidence);

  // 8. Evidence anchoring. The last check and the most important one.
  if (!isEvidenceAnchored(evidence, file)) {
    return reject(summary, "evidence-not-in-source", "the quoted evidence does not appear in the reviewed file");
  }

  const finding: ReviewFinding = {
    id: findingId(location.file, location.line, title),
    schema: REVIEW_SCHEMA,
    severity: resolvedSeverity,
    axis,
    title,
    location: { file: location.file, line: location.line, lineEnd },
    problem,
    why,
    impact,
    evidence,
    confidence,
    fix,
    suggestedPatch: asText(candidate.suggestedPatch) || null,
    suggestedTest: asText(candidate.suggestedTest) || null,
    origin: options.origin,
    ...(candidate.detector !== undefined ? { detector: candidate.detector } : {}),
  };

  return { ok: true, finding };
}
