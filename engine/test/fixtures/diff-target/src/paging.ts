/** Fixture: one altered line inside the diff, one defect outside it. */

export function sumScores(scores: number[]): number {
  let total = 0;
  for (let index = 0; index <= scores.length; index += 1) {
    total += scores[index];
  }
  return total;
}

export function sortedScores(scores: number[]): number[] {
  const totals: number[] = [...scores];
  return totals.sort();
}
