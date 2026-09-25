/**
 * Reading a window of source around a finding.
 *
 * A finding carries a file and a line range, and the UI shows the surrounding
 * code. That path is the one place the renderer asks for file content by name,
 * so it is the one place a finding from a hijacked or malformed report could
 * read an unrelated file. Both halves of the answer are therefore enforced here:
 *
 * - The path must resolve inside the project the review ran over. A joined path
 *   is re-checked after resolution, because `..` survives string joining.
 * - The content must be reviewable source. This refuses `.env`, key material,
 *   and binaries through the same ignore policy the review itself uses, so the
 *   window can never display something the review was not allowed to read.
 *
 * The window is deliberately bounded: a UI that displayed a 50,000-line minified
 * bundle would freeze, and nothing in a generated file is a useful anchor.
 */

import { detectLanguage } from "../core/languages/detect.ts";
import { toPosixPath } from "../core/findings/model.ts";
import { isIgnoredPath, isReviewableContent } from "../core/repository/discover.ts";
import type { FileSystemPort } from "../core/ports.ts";

export class SourceWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceWindowError";
  }
}

export interface SourceWindowRequest {
  /** Repository-relative path, exactly as it appears on a finding. */
  file: string;
  /** Absolute directory that `file` is relative to. */
  pathBase: string;
  line: number;
  lineEnd: number;
  /** Lines of context on each side. Clamped to `MAX_WINDOW_LINES`. */
  context?: number;
}

export interface SourceWindow {
  file: string;
  startLine: number;
  endLine: number;
  focusStart: number;
  focusEnd: number;
  totalLines: number;
  lines: string[];
  language: string;
  /** True when the requested range did not cover the whole file. */
  truncated: boolean;
}

const DEFAULT_CONTEXT_LINES = 6;
const MAX_WINDOW_LINES = 200;

function isInside(root: string, candidate: string): boolean {
  const normalise = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const parent = normalise(root);
  const child = normalise(candidate);
  return child === parent || child.startsWith(`${parent}/`);
}

export async function readSourceWindow(fs: FileSystemPort, request: SourceWindowRequest): Promise<SourceWindow> {
  const relative = toPosixPath(request.file.trim());
  if (relative === "") throw new SourceWindowError("A file path is required.");
  if (isIgnoredPath(relative)) {
    throw new SourceWindowError("That file is not part of the reviewed sources.");
  }

  const root = fs.resolve(request.pathBase);
  const absolute = fs.resolve(root, relative);
  if (!isInside(root, absolute)) {
    throw new SourceWindowError("That path is outside the reviewed project.");
  }

  let content: string;
  try {
    content = await fs.readTextFile(absolute);
  } catch {
    throw new SourceWindowError("That file could not be read.");
  }

  if (!isReviewableContent(relative, content)) {
    throw new SourceWindowError("That file is not reviewable source text.");
  }

  const allLines = content.split(/\r\n|\r|\n/);
  const totalLines = allLines.length;
  const context = Math.min(MAX_WINDOW_LINES, Math.max(0, Math.trunc(request.context ?? DEFAULT_CONTEXT_LINES)));

  // The anchor is clamped rather than rejected: a file can change between the
  // review and the click, and showing the nearest real range beats showing an
  // error for a line that existed a minute ago.
  const focusStart = Math.min(totalLines, Math.max(1, Math.trunc(request.line)));
  const focusEnd = Math.min(totalLines, Math.max(focusStart, Math.trunc(request.lineEnd)));
  const startLine = Math.max(1, focusStart - context);
  const endLine = Math.min(totalLines, focusEnd + context);

  return {
    file: relative,
    startLine,
    endLine,
    focusStart,
    focusEnd,
    totalLines,
    lines: allLines.slice(startLine - 1, endLine),
    language: detectLanguage(relative).id,
    truncated: startLine > 1 || endLine < totalLines,
  };
}
