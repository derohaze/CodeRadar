/** Fixture: intentionally buggy. Review input for the engine's own tests. */

export function isMissingScore(score: number): boolean {
  return score === NaN;
}
