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
  RejectionDiagnostics,
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

function rejectOutcome(
  candidate: { file: string; line: number; lineEnd?: number | undefined; title: string },
  reason: RejectionReason,
  detail: string,
  diagnostics?: RejectionDiagnostics,
): ValidationOutcome {
  const line = Number.isFinite(candidate.line) ? candidate.line : 0;
  // The anchor the candidate asked for is recorded as claimed, so a rejection can
  // be read against the lines a reviewer would look at. A candidate that never
  // gave an end line spans its start line.
  const lineEnd =
    candidate.lineEnd !== undefined && Number.isFinite(candidate.lineEnd) ? Math.max(candidate.lineEnd, line) : line;
  return {
    ok: false,
    rejected: {
      file: toPosixPath(candidate.file || "unknown"),
      line,
      lineEnd,
      title: candidate.title || "(untitled)",
      reason,
      detail,
      ...(diagnostics === undefined ? {} : { diagnostics }),
    },
  };
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A span that reads as code rather than as prose.
 *
 * Single quotes are worth reading because a live run wrapped a true excerpt in
 * them, but they are also an apostrophe: "the order's total isn't checked" has a
 * pair, and treating that as a quotation would swap a file reference for a prose
 * comparison and reject a candidate that was previously anchored. Code carries
 * punctuation prose does not.
 */
const CODE_SIGNAL = /[;=(){}\[\]]/;

interface QuotePattern {
  pattern: RegExp;
  /** True when the delimiter is shared with ordinary prose. */
  requiresCodeSignal: boolean;
}

/**
 * The delimiters a candidate may wrap claimed code in.
 *
 * Backticks and double quotes are unambiguous. Single quotes are read only when
 * the span between them carries code punctuation, so a sentence using apostrophes
 * is not mistaken for an excerpt.
 */
const QUOTE_PATTERNS: readonly QuotePattern[] = [
  { pattern: /`([^`]+)`/g, requiresCodeSignal: false },
  { pattern: /"([^"\n]+)"/g, requiresCodeSignal: false },
  { pattern: /'([^'\n]+)'/g, requiresCodeSignal: true },
];

/**
 * The characters a model meant when it wrote them escaped.
 *
 * A model that quotes three lines inside one pair of quotes often writes `\n`
 * rather than a real line break. That is the line break, escaped, so it is read
 * as one. This is applied to the quote and never to the file: a file containing
 * the literal text `\n` inside a string literal must keep it.
 */
export function unescapeModelEscapes(text: string): string {
  return text.replace(/\\([nrt"'])/g, (_match, escaped: string) => {
    if (escaped === "n") return "\n";
    if (escaped === "r") return "\r";
    if (escaped === "t") return "\t";
    return escaped;
  });
}

/**
 * Pulls the snippets a candidate is claiming as evidence. Models quote with
 * backticks, double quotes, or single quotes; detectors use backticks. Only quoted
 * material is treated as a claim about the source, because prose evidence cannot
 * be checked.
 */
export function extractEvidenceQuotes(evidence: string): string[] {
  const quotes: string[] = [];

  for (const { pattern, requiresCodeSignal } of QUOTE_PATTERNS) {
    for (const match of evidence.matchAll(pattern)) {
      const quote = match[1];
      if (quote === undefined) continue;
      const trimmed = quote.trim();
      if (trimmed.length < MIN_TEXT_LENGTH.evidence) continue;
      if (requiresCodeSignal && !CODE_SIGNAL.test(trimmed)) continue;
      quotes.push(trimmed);
    }
  }

  return quotes;
}

/**
 * Every quote and dash variant a model may use for the same source character.
 *
 * A model reproduces `""` as `''`, or `-` as `—`, without changing what the line
 * says, and a claim that differs only in that way is still the same claim. This
 * is not fuzzy matching: one character maps to one character, so every other
 * character of a quoted line still has to appear in the file exactly as written.
 */
const QUOTE_VARIANTS = /[\u0022\u0027\u2018\u2019\u201C\u201D]/g;
const DASH_VARIANTS = /[\u2010\u2013\u2014\u2212]/g;

/**
 * The canonical form evidence is compared in: indentation never decides the
 * outcome, and neither does the typography a model happens to emit.
 */
export function normaliseEvidenceText(text: string): string {
  return collapseWhitespace(text).replace(QUOTE_VARIANTS, '"').replace(DASH_VARIANTS, "-");
}

/**
 * The terminators a model may end an excerpt with.
 *
 * A model that quotes one line out of a multi-line expression regularly closes
 * the excerpt with `;` even though the source line ends in `,` (or the reverse).
 * That final character is the model punctuating its quotation, not a claim about
 * the code — the same claim either way. The swap is confined to that one
 * position: a `;` or `,` anywhere else in the quote still has to appear in the
 * file exactly as written, so a change inside the quoted code cannot hide behind
 * it. This is not fuzzy matching. No length guard is needed either: the extractor
 * drops quotes shorter than `MIN_TEXT_LENGTH.evidence`, so a lone terminator can
 * never be swapped into a match.
 */
const STATEMENT_TERMINATORS: readonly string[] = [";", ","];

/**
 * The canonical form of a quote, plus the same quote with the counterpart
 * terminator at its end. A quote that does not end in a terminator has exactly
 * one form, which is the quote itself.
 */
function evidenceQuoteForms(normalisedQuote: string): readonly string[] {
  const last = normalisedQuote.slice(-1);
  if (!STATEMENT_TERMINATORS.includes(last)) return [normalisedQuote];

  const counterpart = STATEMENT_TERMINATORS.find((terminator) => terminator !== last);
  if (counterpart === undefined) return [normalisedQuote];

  return [normalisedQuote, normalisedQuote.slice(0, -1) + counterpart];
}

/** What the evidence gate compared, with the outcome of each comparison. */
export interface EvidenceComparison {
  /** The quotes treated as claims about the source. Empty when nothing usable was quoted. */
  quotes: string[];
  /** Per quote, in the same order: does the reviewed file contain it. */
  quotesFound: boolean[];
  /** The gate's verdict. */
  anchored: boolean;
  /** True when no quote was usable, so the file reference is what was checked. */
  usedFileReference: boolean;
  /** The file the comparison ran against, and how much of it there was. */
  comparedFile: string;
  comparedChars: number;
}

/**
 * The evidence comparison itself.
 *
 * This is the single implementation both the gate and the rejection
 * diagnostics use: a rejection that reported a different comparison than the one
 * that decided it would be worse than no diagnostics at all.
 */
export function compareEvidence(evidence: string, file: { content: string; path: string }): EvidenceComparison {
  const quotes = extractEvidenceQuotes(evidence);
  const haystack = normaliseEvidenceText(file.content);
  const quotesFound = quotes.map((quote) =>
    evidenceQuoteForms(normaliseEvidenceText(unescapeModelEscapes(quote))).some((form) =>
      haystack.includes(form),
    ),
  );
  const compared = { comparedFile: file.path, comparedChars: file.content.length };

  if (quotes.length > 0) {
    return { quotes, quotesFound, anchored: quotesFound.some(Boolean), usedFileReference: false, ...compared };
  }

  const normalised = normaliseEvidenceText(evidence);
  const fileName = file.path.split("/").pop() ?? file.path;
  const anchored =
    normalised !== "" && (normalised.includes(file.path) || (fileName !== "" && normalised.includes(fileName)));

  return { quotes, quotesFound, anchored, usedFileReference: true, ...compared };
}

/**
 * True when the candidate points at something that is actually in the file.
 *
 * Quoted code must appear in the reviewed file, compared in the canonical form
 * `normaliseEvidenceText` defines: indentation and trailing space never decide the
 * outcome, and neither does a quote, a dash, or the statement terminator at the
 * end of an excerpt that the model typed differently from the file. When a
 * candidate offers no quoted code at all, it must at least reference
 * the file it claims to be talking about, otherwise there is nothing to verify and
 * the claim is unverifiable rather than merely terse.
 */
export function isEvidenceAnchored(evidence: string, file: { content: string; path: string }): boolean {
  return compareEvidence(evidence, file).anchored;
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

  const summary = {
    file: asText(candidate.file),
    line: candidate.line,
    lineEnd: candidate.lineEnd ?? candidate.line,
    title,
  };

  // The candidate's own claim travels with every rejection, so a dropped finding
  // can be explained from the report without replaying the review. It is only
  // recorded: no field here is read by any check.
  const baseDiagnostics: RejectionDiagnostics = {
    ...(evidence === "" ? {} : { evidence }),
    axis: asText(candidate.axis),
    severity: asText(candidate.severity),
    confidence: candidate.confidence,
  };
  const reject = (
    target: { file: string; line: number; lineEnd?: number | undefined; title: string },
    reason: RejectionReason,
    detail: string,
    extra?: RejectionDiagnostics,
  ): ValidationOutcome => rejectOutcome(target, reason, detail, { ...baseDiagnostics, ...extra });

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
  const comparison = compareEvidence(evidence, file);
  if (!comparison.anchored) {
    return reject(summary, "evidence-not-in-source", "the quoted evidence does not appear in the reviewed file", {
      quotes: comparison.quotes,
      quotesFound: comparison.quotesFound,
      compared: { file: comparison.comparedFile, chars: comparison.comparedChars },
      usedFileReference: comparison.usedFileReference,
    });
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
