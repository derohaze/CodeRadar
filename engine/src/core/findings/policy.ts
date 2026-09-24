/**
 * The review bar, expressed as executable rules.
 *
 * `engine/prompts/shared_code_review_bar.md` is the canonical, human-readable
 * policy and is sent to the model verbatim. This module is the machine
 * enforcement of the same policy: it decides which candidates survive, so the
 * bar cannot be softened by a model that simply produces more findings.
 *
 * The governing rule from the product spec: ten real findings beat a hundred
 * weak ones. Everything here exists to drop weak ones.
 */

import type { ReviewAxis, ReviewSeverity } from "./model.ts";
import { REVIEW_AXES, REVIEW_SEVERITIES, clampingConfidence } from "./model.ts";

/**
 * Below this, the claim is not knowledge, it is a guess. The bar document says
 * "below 55: do not emit it", so this is the floor for any finding at all.
 */
export const CONFIDENCE_FLOOR = 55;

/**
 * Severity has to be earned by confidence. A `critical` claim changes how a
 * release is planned, so it needs a traced trigger. When confidence is too low
 * for the claimed severity we downgrade instead of dropping, which preserves
 * the signal without inflating it. See `resolveSeverity`.
 */
export const SEVERITY_CONFIDENCE_REQUIREMENT: Record<ReviewSeverity, number> = {
  critical: 85,
  high: 70,
  medium: 55,
  low: 45,
};

/**
 * The bar says "under 15 findings". This is a hard cap applied after sorting by
 * severity and confidence, so the cap never hides the most important finding.
 */
export const MAX_FINDINGS = 15;

/** Minimum useful text lengths. Guards against one-word AI filler. */
export const MIN_TEXT_LENGTH = {
  title: 12,
  problem: 20,
  why: 20,
  impact: 12,
  evidence: 4,
  fix: 12,
} as const;

/**
 * Titles and claims that describe preference rather than defect. The bar names
 * these explicitly: "Never report: naming, style, formatting, consider
 * extracting, you could add a comment, speculative hardening".
 *
 * Matching is on a normalised (lowercased) title or problem, so the patterns
 * are written to catch the prefix a model reaches for, not a whole sentence.
 */
const EXCLUDED_CONCERN_PATTERNS: readonly RegExp[] = [
  /\bconsider (extracting|renaming|adding|splitting|refactoring|using)\b/,
  /\bcould (add|be|use) (a )?(comment|test|type|helper)\b/,
  /\bshould (be )?(renamed|split|extracted)\b/,
  /\bnaming\b/,
  /\bstyle\b/,
  /\bformatting\b/,
  /\bindentation\b/,
  /\bprettier\b/,
  /\beslint\b/,
  /\blint(er)?\b/,
  /\bmissing (jsdoc|docstring|comment)s?\b/,
  /\b(todo|fixme)\b/,
  /\bmagic number\b/,
  /\bcode smell\b/,
  /\bduplicat(e|ion) (code|logic) could\b/,
  /\bhard to (read|understand)\b/,
  /\btoo long\b/,
  /\bspeculative\b/,
];

const SEVERITY_ALIASES: Record<string, ReviewSeverity> = {
  critical: "critical",
  blocker: "critical",
  severe: "critical",
  high: "high",
  error: "high",
  major: "high",
  medium: "medium",
  moderate: "medium",
  warning: "medium",
  warn: "medium",
  low: "low",
  minor: "low",
  info: "low",
  informational: "low",
  note: "low",
};

const AXIS_ALIASES: Record<string, ReviewAxis> = {
  correctness: "correctness",
  bug: "correctness",
  logic: "correctness",
  security: "security",
  trust: "security",
  "error-handling": "error-handling",
  error_handling: "error-handling",
  "error handling": "error-handling",
  errors: "error-handling",
  concurrency: "concurrency",
  race: "concurrency",
  ordering: "concurrency",
  "api-contract": "api-contract",
  api_contract: "api-contract",
  "api contract": "api-contract",
  contract: "api-contract",
  performance: "performance",
  perf: "performance",
  resource: "resource",
  resources: "resource",
  leak: "resource",
  standards: "standards",
  tests: "tests",
  test: "tests",
  docs: "docs",
  docs_accuracy: "docs",
};

/**
 * Axes a model may legitimately name but that the review bar treats as out of
 * scope. Returning `null` for these makes style feedback a rejection reason
 * rather than a finding, which is the whole point of the bar.
 */
const EXCLUDED_AXES = new Set(["style", "formatting", "naming", "preference", "nitpick", "nit"]);

export function normaliseSeverity(raw: unknown): ReviewSeverity | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  return SEVERITY_ALIASES[key] ?? null;
}

export function normaliseAxis(raw: unknown): ReviewAxis | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (EXCLUDED_AXES.has(key)) return null;
  return AXIS_ALIASES[key] ?? null;
}

export function isAxis(value: string): value is ReviewAxis {
  return (REVIEW_AXES as readonly string[]).includes(value);
}

export function isSeverity(value: string): value is ReviewSeverity {
  return (REVIEW_SEVERITIES as readonly string[]).includes(value);
}

/**
 * True when the text describes a preference rather than a defect. The bar
 * forbids these outright, whichever axis they were filed under.
 */
export function isExcludedConcern(...texts: readonly string[]): boolean {
  const haystack = texts.join(" ").toLowerCase();
  if (haystack.trim() === "") return false;
  return EXCLUDED_CONCERN_PATTERNS.some((pattern) => pattern.test(haystack));
}

/**
 * Lowers the claimed severity until the claim meets its confidence
 * requirement, or returns `"low"` when even that is unearned. Callers must
 * already have applied `CONFIDENCE_FLOOR`.
 */
export function resolveSeverity(claimed: ReviewSeverity, confidence: number): ReviewSeverity {
  const bounded = clampingConfidence(confidence);
  const descending = [...REVIEW_SEVERITIES];

  for (const severity of descending) {
    if (bounded >= SEVERITY_CONFIDENCE_REQUIREMENT[severity]) {
      // `descending` runs critical -> low, so the first match at or below the
      // claimed severity is the strongest severity the confidence can support.
      if (severityRankOf(severity) >= severityRankOf(claimed)) return severity;
      return claimed;
    }
  }
  return "low";
}

function severityRankOf(severity: ReviewSeverity): number {
  return REVIEW_SEVERITIES.indexOf(severity);
}

/**
 * Sorts so the most severe, most confident finding is first. Confidence breaks
 * severity ties, and title breaks confidence ties so output is deterministic.
 */
export function compareFindings(
  a: { severity: ReviewSeverity; confidence: number; location: { file: string; line: number }; title: string },
  b: { severity: ReviewSeverity; confidence: number; location: { file: string; line: number }; title: string },
): number {
  const byRank = severityRankOf(a.severity) - severityRankOf(b.severity);
  if (byRank !== 0) return byRank;

  const byConfidence = b.confidence - a.confidence;
  if (byConfidence !== 0) return byConfidence;

  const byFile = a.location.file.localeCompare(b.location.file);
  if (byFile !== 0) return byFile;

  const byLine = a.location.line - b.location.line;
  if (byLine !== 0) return byLine;

  return a.title.localeCompare(b.title);
}
