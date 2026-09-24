/**
 * Unified diff parsing.
 *
 * Only what the review flow needs is modelled: which files changed, which new
 * lines are additions, and enough hunk context to keep a finding anchored to
 * the change rather than to unrelated code further down the file.
 *
 * The parser is tolerant by design. A diff that fails to parse must never abort
 * a review, because the fallback (review everything) is safe, while throwing is
 * not.
 */

import { toPosixPath } from "../findings/model.ts";

export type DiffLineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  /** Line content without the leading marker. */
  text: string;
  /** 1-based line in the new file, or null for a deletion. */
  newLine: number | null;
  /** 1-based line in the old file, or null for an addition. */
  oldLine: number | null;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  /** Repository-relative path of the file after the change. */
  path: string;
  oldPath: string;
  newPath: string;
  oldExists: boolean;
  newExists: boolean;
  isBinary: boolean;
  isRename: boolean;
  hunks: DiffHunk[];
}

export interface ParsedDiff {
  files: FileDiff[];
  /** True when at least one file produced usable hunks. */
  hasContent: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * The `diff --git` header, accepting git's quoted form for paths with spaces.
 *
 * A pure rename and a binary file both produce this header and no `---`/`+++`
 * lines at all, so it is the only place their paths appear. Without parsing it,
 * both cases look like a diff entry with no file and get dropped.
 */
const DIFF_GIT_HEADER = /^diff --git ("(?:[^"\\]|\\.)*"|\S+)\s+("(?:[^"\\]|\\.)*"|\S+)\s*$/;

/** Strips the `a/` or `b/` prefix and `"` quoting git adds for odd names. */
function cleanPath(raw: string): string {
  let value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1);
    value = value.replace(/\\(.)/g, "$1");
  }

  // `--- a/path\t` carries a timestamp in plain (non-git) diffs.
  const tabIndex = value.indexOf("\t");
  if (tabIndex !== -1) value = value.slice(0, tabIndex);

  value = value.replace(/^[ab]\//, "");
  return toPosixPath(value);
}

function toCount(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

/**
 * Parses a unified diff. Unrecognised lines are ignored rather than treated as
 * errors, which keeps `index`, `mode`, and `similarity index` metadata harmless.
 */
export function parseUnifiedDiff(text: string): ParsedDiff {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const finishFile = () => {
    if (current !== null) {
      files.push(current);
      current = null;
      hunk = null;
    }
  };

  const startFile = (): FileDiff => {
    const file: FileDiff = {
      path: "",
      oldPath: "",
      newPath: "",
      oldExists: true,
      newExists: true,
      isBinary: false,
      isRename: false,
      hunks: [],
    };
    current = file;
    return file;
  };

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    if (rawLine.startsWith("diff --git ")) {
      finishFile();
      const file = startFile();
      const header = DIFF_GIT_HEADER.exec(rawLine);
      if (header !== null) {
        file.oldPath = cleanPath(header[1] ?? "");
        file.newPath = cleanPath(header[2] ?? "");
        file.path = file.newPath !== "" ? file.newPath : file.oldPath;
      }
      continue;
    }

    if (rawLine.startsWith("--- ")) {
      const file = current ?? startFile();
      const rawPath = rawLine.slice(4).trim();
      file.oldExists = rawPath !== "/dev/null";
      file.oldPath = file.oldExists ? cleanPath(rawPath) : "";
      continue;
    }

    if (rawLine.startsWith("+++ ")) {
      const file = current ?? startFile();
      const rawPath = rawLine.slice(4).trim();
      file.newExists = rawPath !== "/dev/null";
      file.newPath = file.newExists ? cleanPath(rawPath) : "";
      // A deletion keeps its old path so the file is still addressable.
      file.path = file.newExists ? file.newPath : file.oldPath;
      continue;
    }

    if (rawLine.startsWith("rename from ")) {
      const file = current ?? startFile();
      file.isRename = true;
      file.oldPath = cleanPath(rawLine.slice("rename from ".length));
      continue;
    }

    if (rawLine.startsWith("rename to ")) {
      const file = current ?? startFile();
      file.isRename = true;
      file.newPath = cleanPath(rawLine.slice("rename to ".length));
      file.path = file.newPath;
      continue;
    }

    if (rawLine.startsWith("Binary files ") || rawLine.startsWith("GIT binary patch")) {
      (current ?? startFile()).isBinary = true;
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(rawLine);
    if (hunkMatch) {
      const file = current ?? startFile();
      oldLine = Number.parseInt(hunkMatch[1] ?? "0", 10);
      newLine = Number.parseInt(hunkMatch[3] ?? "0", 10);
      hunk = {
        oldStart: oldLine,
        oldCount: toCount(hunkMatch[2]),
        newStart: newLine,
        newCount: toCount(hunkMatch[4]),
        lines: [],
      };
      file.hunks.push(hunk);
      continue;
    }

    if (hunk === null || current === null) continue;

    if (rawLine.startsWith("\\")) {
      // `\ No newline at end of file` annotates the previous line.
      continue;
    }

    const marker = rawLine.charAt(0);
    const body = rawLine.length > 0 ? rawLine.slice(1) : "";

    if (marker === "+") {
      hunk.lines.push({ kind: "add", text: body, newLine, oldLine: null });
      newLine += 1;
      continue;
    }
    if (marker === "-") {
      hunk.lines.push({ kind: "del", text: body, newLine: null, oldLine });
      oldLine += 1;
      continue;
    }
    if (marker === " " || rawLine === "") {
      hunk.lines.push({ kind: "context", text: body, newLine, oldLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  finishFile();

  return {
    files: files.filter((file) => file.path !== "" || file.hunks.length > 0),
    hasContent: files.some((file) => file.hunks.length > 0),
  };
}

/** New-file line numbers introduced by this diff. These are what a reviewer anchors to. */
export function addedLineNumbers(file: FileDiff): Set<number> {
  const lines = new Set<number>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add" && line.newLine !== null) lines.add(line.newLine);
    }
  }
  return lines;
}

/**
 * New-file lines a reviewer should consider: the additions plus the context
 * immediately around them. Reviewing a bare added line in isolation is how a
 * change that breaks its neighbours gets approved, so the hunk context is
 * included on purpose.
 */
export function changedLineNumbers(file: FileDiff, contextRadius = 3): Set<number> {
  const expanded = new Set<number>();

  for (const hunk of file.hunks) {
    const added: number[] = [];
    for (const line of hunk.lines) {
      if (line.kind === "add" && line.newLine !== null) added.push(line.newLine);
    }
    if (added.length === 0) continue;

    // The expansion is clamped to the hunk. Without the clamp, a change near
    // the top of a file would put unrelated lines far below it in scope, and a
    // diff review would report defects in code the change never touched.
    const hunkEnd = hunk.newStart + hunk.newCount - 1;
    const from = Math.max(hunk.newStart, Math.min(...added) - contextRadius);
    const to = Math.min(hunkEnd, Math.max(...added) + contextRadius);

    for (let line = from; line <= to; line += 1) expanded.add(line);
  }

  return expanded;
}

/** Flattens a parsed diff to the repository-relative paths it touched. */
export function diffPaths(diff: ParsedDiff): string[] {
  return diff.files.map((file) => file.path).filter((path) => path !== "");
}
