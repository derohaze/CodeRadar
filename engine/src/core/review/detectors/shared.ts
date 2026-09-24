/**
 * Shared detector plumbing.
 *
 * Detectors are the deterministic half of the review. They exist for the defects
 * a model reliably misses: mechanical mistakes that are obvious once you see
 * them and invisible to everything else. They are deliberately high precision.
 *
 * A detector must respect one rule above all others: it may only report a defect
 * whose trigger and wrong result it can both name. A pattern that matches a
 * construct which is sometimes wrong and sometimes deliberate is not a detector,
 * it is noise. One such pattern was written, measured against a real codebase,
 * found to be wrong every time, and deleted rather than tuned; see
 * `docs/review-engine-migration-plan.md`.
 */

import type { LanguageFamily } from "../../languages/detect.ts";
import type { CandidateFinding } from "../../findings/validate.ts";
import type { ReviewAxis } from "../../findings/model.ts";
import type { SourceFile } from "../../repository/source.ts";

export interface DetectorInput {
  file: SourceFile;
  language: { id: string; family: LanguageFamily };
}

export interface Detector {
  /** Stable id. Appears on the finding as `detector`. */
  id: string;
  axis: ReviewAxis;
  families: readonly LanguageFamily[];
  run(input: DetectorInput): CandidateFinding[];
}

/**
 * Returns the 1-based line at `index` (0-based) or an empty string. Detectors
 * run over untrusted text where an index can be off by one, and a thrown error
 * inside a detector would abort a whole review.
 */
export function lineAt(file: SourceFile, index: number): string {
  return file.lines[index] ?? "";
}

/**
 * Removes a `//` line comment.
 *
 * Comment stripping is per-language on purpose. Stripping `#` from JavaScript
 * would truncate a line at a CSS colour such as "#fff" and change what the
 * detector sees, which is a silent false negative.
 */
export function stripComment(line: string): string {
  const slashIndex = line.indexOf("//");
  return slashIndex === -1 ? line : line.slice(0, slashIndex);
}

/** Removes a `#` line comment, for Python and shell. */
export function stripHashComment(line: string): string {
  const hashIndex = line.indexOf("#");
  return hashIndex === -1 ? line : line.slice(0, hashIndex);
}

/** Trimmed source line, used as the verified quote inside `evidence`. */
export function quote(line: string): string {
  return line.trim();
}

export interface EvidenceParts {
  file: string;
  line: number;
  source: string;
  trigger: string;
  wrongResult: string;
}

/**
 * Builds evidence in the one shape the validator can verify: the file and line,
 * an exact quote of the line, then the trigger and the wrong result.
 *
 * The quote is the load-bearing part. `validateCandidate` re-checks it against
 * the file, so a detector cannot claim evidence it did not read.
 */
export function buildEvidence(parts: EvidenceParts): string {
  return `${parts.file}:${parts.line} | \`${quote(parts.source)}\` | trigger: ${parts.trigger} | wrong result: ${parts.wrongResult}`;
}

/**
 * Builds an applicable one-line unified diff.
 *
 * A patch is only offered when the whole fix is a single line, because anything
 * larger cannot be produced correctly without the surrounding file and would be
 * a plausible-looking diff that does not apply. A wrong patch is worse than no
 * patch, so detectors pass `null` when they cannot be sure.
 */
export function singleLinePatch(
  filePath: string,
  lineNumber: number,
  oldLine: string,
  newLine: string,
): string | null {
  if (oldLine === newLine || oldLine.trim() === "") return null;
  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${lineNumber},1 +${lineNumber},1 @@`,
    `-${oldLine}`,
    `+${newLine}`,
  ].join("\n");
}

/** Candidate factory that stamps the fields every detector shares. */
export function candidate(
  input: DetectorInput,
  fields: Omit<CandidateFinding, "file">,
): CandidateFinding {
  return { ...fields, file: input.file.path };
}
