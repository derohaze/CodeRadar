/**
 * The evidence gate.
 *
 * A finding's authority comes from the code, and this is the module that decides
 * whether a claim about the code is checkable at all: quoted material must appear
 * in the reviewed file, compared in one canonical form, or the claim is
 * unverifiable.
 *
 * It is deliberately separated from `validate.ts`. That module decides what a
 * finding *is* — shape, length, axis, anchor, confidence — and this one answers a
 * single question about the source: is the quoted evidence really there. The
 * product's credibility rests on this one, so it is kept small enough to read in
 * one sitting.
 *
 * The comparison is one implementation, used by the gate and reported back in a
 * rejection's diagnostics, because a rejection that described a different
 * comparison than the one that decided it would be worse than no diagnostics.
 */

import { MIN_TEXT_LENGTH } from "./policy.ts";
import { collapseWhitespace } from "../repository/source.ts";

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
