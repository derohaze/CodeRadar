/**
 * How much of a file a set of sent windows covered.
 *
 * Overlapping windows are merged before they are measured: counted twice, a file
 * that was only partly sent would read as fully sent, which is the one mistake
 * this measurement exists to prevent.
 *
 * The score and the per-defect explanation both measure coverage here, so one run
 * cannot be told two different stories about what the model was shown.
 */

/** An inclusive, 1-based line range. */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * A window as a caller may describe it: the two numbers, either of which an
 * untrusted document may have left out. A missing bound is not line zero, so the
 * reader drops it rather than guessing.
 */
export interface LineWindow {
  startLine?: number | undefined;
  endLine?: number | undefined;
}

/** The merged ranges that were covered, and the number of lines that is. */
export interface CoveredLines {
  ranges: LineRange[];
  coveredLines: number;
}

export function coverageOf(windows: readonly LineWindow[], fileLines: number): CoveredLines {
  const ranges: LineRange[] = [];
  for (const window of windows) {
    const start = window.startLine;
    const end = window.endLine;
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const from = Math.max(1, Math.floor(start));
    const to = Math.min(fileLines, Math.floor(end));
    if (to < from) continue;
    ranges.push({ start: from, end: to });
  }

  ranges.sort((left, right) => left.start - right.start);
  const merged: LineRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  return {
    ranges: merged,
    coveredLines: merged.reduce((total, range) => total + (range.end - range.start + 1), 0),
  };
}

/** True when the whole inclusive range was inside what was sent. */
export function coversRange(ranges: readonly LineRange[], start: number, end: number): boolean {
  return ranges.some((range) => range.start <= start && range.end >= end);
}
