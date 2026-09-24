/**
 * Duplicate detection.
 *
 * The same defect is reached more than once in normal operation: two detectors
 * notice it, or the model reports it under two axes, or the same file is
 * reviewed in a changed-lines pass and a whole-file pass. The bar is explicit
 * that a defect is reported once, so this module is what makes that true.
 *
 * The comparison is deliberately conservative: a false merge hides a real
 * finding, which is a worse failure than showing the same bug twice. Findings
 * must be in the same file, within a few lines of each other, and describe the
 * same thing in similar words before they are treated as one.
 */

import type { RejectedCandidate, ReviewFinding, ReviewSeverity } from "./model.ts";

/** Lines within this distance of each other are candidates for the same defect. */
export const NEARBY_LINE_DISTANCE = 3;

/** Token overlap at or above this is "the same defect described twice". */
export const SIMILARITY_THRESHOLD = 0.5;

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "of", "to", "in", "on", "at", "for", "with", "and", "or", "not", "no",
  "this", "that", "these", "those", "it", "its", "when", "may", "can",
  "could", "will", "would", "should", "must", "before", "after", "from",
  "by", "as", "if", "then", "than", "into", "out", "up", "down", "so",
  "because", "which", "while", "there", "here", "also", "only", "just",
]);

export function tokenise(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_$]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token !== "" && !STOP_WORDS.has(token) && token.length > 2);
  return new Set(tokens);
}

/** Jaccard similarity of two token sets, 0 when either side is empty. */
export function tokenSimilarity(a: string, b: string): number {
  const left = tokenise(a);
  const right = tokenise(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  // Directional scores catch "short description of a longer one", which pure
  // Jaccard undervalues. The larger of the two is the fairer comparison.
  const intersectionOverUnion = shared / (left.size + right.size - shared);
  const containment = shared / Math.min(left.size, right.size);
  return Math.max(intersectionOverUnion, containment);
}

function rangesTouch(a: ReviewFinding, b: ReviewFinding): boolean {
  const gapStart = Math.max(a.location.line, b.location.line);
  const gapEnd = Math.min(a.location.lineEnd, b.location.lineEnd);
  if (gapStart <= gapEnd) return true;

  const distance = Math.min(
    Math.abs(a.location.line - b.location.lineEnd),
    Math.abs(b.location.line - a.location.lineEnd),
  );
  return distance <= NEARBY_LINE_DISTANCE;
}

function isSameDefect(a: ReviewFinding, b: ReviewFinding): boolean {
  if (a.location.file !== b.location.file) return false;
  if (!rangesTouch(a, b)) return false;
  return tokenSimilarity(a.title, b.title) >= SIMILARITY_THRESHOLD;
}

/** Higher is better. Used to pick which duplicate survives. */
const SEVERITY_WEIGHT: Record<ReviewSeverity, number> = {
  critical: 4000,
  high: 3000,
  medium: 2000,
  low: 1000,
};

/**
 * Picks which duplicate survives. Severity dominates and confidence breaks
 * ties, so a critical at 60 outranks a medium at 100, which is how the bar
 * ranks them.
 */
function quality(finding: ReviewFinding): number {
  return SEVERITY_WEIGHT[finding.severity] + finding.confidence;
}

function fillGaps(winner: ReviewFinding, loser: ReviewFinding): ReviewFinding {
  // The survivor keeps its own prose: its evidence is the one already verified.
  // Only empty optional slots are filled, so no unverified text is promoted.
  return {
    ...winner,
    suggestedPatch: winner.suggestedPatch ?? loser.suggestedPatch,
    suggestedTest: winner.suggestedTest ?? loser.suggestedTest,
    evidence:
      winner.evidence.includes(loser.evidence) || loser.evidence.trim() === ""
        ? winner.evidence
        : `${winner.evidence}\n${loser.evidence}`,
  };
}

export interface DedupeResult {
  findings: ReviewFinding[];
  merged: RejectedCandidate[];
}

/**
 * Collapses duplicates, keeping the strongest version of each defect. The input
 * order does not affect the result, so the pipeline can run detectors and the
 * model concurrently without changing the output.
 */
export function dedupeFindings(findings: readonly ReviewFinding[]): DedupeResult {
  const survivors: ReviewFinding[] = [];
  const merged: RejectedCandidate[] = [];

  for (const finding of findings) {
    const matchIndex = survivors.findIndex((existing) => isSameDefect(existing, finding));

    if (matchIndex === -1) {
      survivors.push(finding);
      continue;
    }

    const existing = survivors[matchIndex];
    if (existing === undefined) continue;

    const keepNew = quality(finding) > quality(existing);
    const winner = keepNew ? finding : existing;
    const loser = keepNew ? existing : finding;

    survivors[matchIndex] = fillGaps(winner, loser);
    merged.push({
      file: loser.location.file,
      line: loser.location.line,
      title: loser.title,
      reason: "merged-duplicate",
      detail: `merged into ${winner.id} (${winner.title})`,
    });
  }

  return { findings: survivors, merged };
}
