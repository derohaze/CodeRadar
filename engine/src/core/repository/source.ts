/**
 * The reviewed source, held in memory in a shape the validator can check
 * against.
 *
 * The validator's central job is proving that a finding's evidence exists. That
 * is only possible if the exact reviewed text is addressable by path and line,
 * so this index is built once during context assembly and passed through the
 * rest of the pipeline unchanged.
 */

import { toPosixPath } from "../findings/model.ts";

export interface SourceFile {
  /** Repository-relative path, POSIX separators. */
  path: string;
  /** Full text as read from disk. */
  content: string;
  /** 1-based line array, so `lines[n - 1]` is line `n`. */
  lines: string[];
}

export interface SourceIndex {
  paths(): readonly string[];
  get(path: string): SourceFile | undefined;
  has(path: string): boolean;
  size(): number;
}

export function createSourceFile(path: string, content: string): SourceFile {
  return {
    path: toPosixPath(path),
    content,
    lines: content.split(/\r\n|\r|\n/),
  };
}

export function createSourceIndex(files: readonly SourceFile[]): SourceIndex {
  const byPath = new Map<string, SourceFile>();
  for (const file of files) {
    byPath.set(file.path, file);
  }

  const paths = [...byPath.keys()].sort((a, b) => a.localeCompare(b));

  return {
    paths: () => paths,
    get: (path) => byPath.get(toPosixPath(path)),
    has: (path) => byPath.has(toPosixPath(path)),
    size: () => byPath.size,
  };
}

/** Collapses whitespace so indentation differences never defeat a comparison. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
