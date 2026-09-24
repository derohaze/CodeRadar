/**
 * Fixture: intentionally buggy. This file is review input for the engine's own
 * tests, never executed. Both defects below are unambiguous on purpose, so a
 * test failure means the detector broke, not that the judgement was close.
 */

export function sumScores(scores: number[]): number {
  let total = 0;
  for (let index = 0; index <= scores.length; index += 1) {
    total += scores[index];
  }
  return total;
}

const totals: number[] = [10, 9, 100];

export function sortedTotals(): number[] {
  return totals.sort();
}
