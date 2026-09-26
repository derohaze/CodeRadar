/**
 * Reading the fixture's ground truth document.
 *
 * Ground truth is read from the fixture's own document, never from a run. A
 * defect is in the table because the code is wrong, not because a model said so.
 *
 * Rows are identified by their id, not by their position, so adding a section or
 * reordering the file cannot silently change what is being scored.
 */

import type { LineRange } from "../coverage.ts";

export interface GroundTruthDefect {
  id: string;
  /** One or more fixture paths, as the table states them. */
  files: string[];
  /**
   * The lines that show the defect, or null when the row records none.
   *
   * A null anchor means the file is the whole claim, which is the weaker thing
   * to state and is only correct for a defect that is not local to a line.
   */
  anchor: LineRange | null;
  defect: string;
  expectedSeverity: string;
}

export interface GroundTruthNegativeControl {
  id: string;
  /** One entry covers every file its row names, e.g. the interface-only pair. */
  files: string[];
  looksLike: string;
  whyCorrect: string;
}

export interface GroundTruth {
  defects: GroundTruthDefect[];
  negatives: GroundTruthNegativeControl[];
}

/** One markdown table row, or null when the line is not a table row. */
function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;

  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

  // The header separator row (`| -- | ---- |`) is not data.
  if (cells.some((cell) => /^-{2,}$/.test(cell))) return null;
  return cells;
}

/**
 * Every fixture path a cell names.
 *
 * A row may cover more than one file — the interface-only negative control names
 * two — and dropping the second path would quietly create an uncovered file.
 */
function pathsIn(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "").filter((value) => value !== "");
}

/**
 * Reads an anchor cell: `29`, `12-25`, or `-` for none.
 *
 * A malformed anchor is treated as no anchor rather than as line zero, because
 * line zero would silently match nothing and turn a typo in the table into a
 * defect that can never be detected.
 */
export function parseAnchor(cell: string): LineRange | null {
  const trimmed = cell.trim();
  if (trimmed === "" || trimmed === "-") return null;

  const single = /^(\d+)$/.exec(trimmed);
  if (single !== null) {
    const line = Number.parseInt(single[1] ?? "", 10);
    return line >= 1 ? { start: line, end: line } : null;
  }

  const range = /^(\d+)\s*[-\u2013]\s*(\d+)$/.exec(trimmed);
  if (range !== null) {
    const start = Number.parseInt(range[1] ?? "", 10);
    const end = Number.parseInt(range[2] ?? "", 10);
    if (start >= 1 && end >= start) return { start, end };
  }

  return null;
}

/**
 * Reads the defect and negative-control tables out of the fixture's document.
 *
 * Rows are identified by their id, not by their position, so adding a section or
 * reordering the file cannot silently change what is being scored.
 */
export function parseGroundTruth(markdown: string): GroundTruth {
  const defects: GroundTruthDefect[] = [];
  const negatives: GroundTruthNegativeControl[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const cells = tableCells(line);
    if (cells === null || cells.length < 4) continue;

    const [id, fileCell, ...rest] = cells;
    if (id === undefined || fileCell === undefined) continue;

    const files = pathsIn(fileCell);
    if (files.length === 0) continue;

    // The two tables have different shapes on purpose: a defect is local to an
    // anchor, while a negative control is about the whole file.
    if (/^D\d+$/.test(id)) {
      defects.push({
        id,
        files,
        anchor: parseAnchor(rest[0] ?? ""),
        defect: rest[1] ?? "",
        expectedSeverity: rest[2] ?? "",
      });
    } else if (/^C\d+$/.test(id)) {
      negatives.push({ id, files, looksLike: rest[0] ?? "", whyCorrect: rest[1] ?? "" });
    }
  }

  return { defects, negatives };
}
