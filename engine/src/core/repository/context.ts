/**
 * Review context assembly.
 *
 * A reviewer with only a file's text guesses. A reviewer with the file's text,
 * its numbered lines, and the symbols it imports and exports can reason about
 * the contract the code is supposed to honour, which is what turns "this looks
 * odd" into "this breaks its callers".
 *
 * Numbered windows are what make line anchors possible in the first place: the
 * model can only cite a line number that was shown to it.
 */

import { detectLanguage } from "../languages/detect.ts";
import type { LanguageInfo } from "../languages/detect.ts";
import type { SourceFile } from "./source.ts";

export interface ContextWindow {
  startLine: number;
  endLine: number;
  /** Line-numbered text, `NNNN| content`, 1-based and inclusive. */
  text: string;
}

export interface FileContext {
  file: SourceFile;
  language: LanguageInfo;
  imports: string[];
  exports: string[];
  /** Top-level declaration names, when they can be found cheaply. */
  symbols: string[];
  windows: ContextWindow[];
}

export interface ContextOptions {
  /** Lines per window. Bounded so a single huge file cannot exhaust the budget. */
  windowLines: number;
}

export const DEFAULT_CONTEXT_OPTIONS: ContextOptions = { windowLines: 200 };

const JS_IMPORT_PATTERNS: readonly RegExp[] = [
  /^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm,
  /^\s*import\s*["']([^"']+)["']/gm,
  /^\s*import\s*\(\s*["']([^"']+)["']\s*\)/gm,
  /require\s*\(\s*["']([^"']+)["']\s*\)/gm,
];

const PYTHON_IMPORT_PATTERNS: readonly RegExp[] = [
  /^\s*import\s+([A-Za-z_][\w.]*)/gm,
  /^\s*from\s+([A-Za-z_][\w.]*)\s+import\s/gm,
];

const JS_EXPORT_PATTERNS: readonly RegExp[] = [
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*export\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*export\s*\{([^}]*)\}/gm,
];

function collect(content: string, patterns: readonly RegExp[]): string[] {
  const found = new Set<string>();
  for (const pattern of patterns) {
    // `matchAll` needs the global flag; the patterns are all declared with it.
    for (const match of content.matchAll(pattern)) {
      const captured = match[1];
      if (captured === undefined) continue;
      for (const piece of captured.split(",")) {
        const name = piece.trim().split(/\s+as\s+/)[0]?.trim();
        if (name !== undefined && name !== "") found.add(name);
      }
    }
  }
  return [...found].sort();
}

export function extractImports(content: string, language: LanguageInfo): string[] {
  if (language.family === "js") return collect(content, JS_IMPORT_PATTERNS);
  if (language.family === "python") return collect(content, PYTHON_IMPORT_PATTERNS);
  if (language.family === "rust") return collect(content, [/^\s*use\s+([^;]+);/gm]);
  if (language.family === "go") return collect(content, [/^\s*import\s+"([^"]+)"/gm]);
  return [];
}

export function extractExports(content: string, language: LanguageInfo): string[] {
  if (language.family === "js") return collect(content, JS_EXPORT_PATTERNS);
  if (language.family === "python") {
    return collect(content, [/^\s*def\s+([A-Za-z_]\w*)/gm, /^\s*class\s+([A-Za-z_]\w*)/gm]);
  }
  return [];
}

function extractSymbols(content: string, language: LanguageInfo): string[] {
  if (language.family === "js") {
    return collect(content, [
      /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
      /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
      /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm,
    ]);
  }
  if (language.family === "python") {
    return collect(content, [
      /^\s*def\s+([A-Za-z_]\w*)/gm,
      /^\s*class\s+([A-Za-z_]\w*)/gm,
    ]);
  }
  if (language.family === "rust") return collect(content, [/^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)/gm]);
  if (language.family === "go") return collect(content, [/^func\s+([A-Za-z_]\w*)/gm]);
  return [];
}

function lastLineNumber(input: string): number {
  const lines = input.split("\n");
  return lines.length;
}

/**
 * Splits numbered windows. The width is padded so every line number occupies
 * the same character count, which keeps the model's attention on the code
 * instead of on shifting alignment.
 */
export function buildWindows(source: SourceFile, windowLines: number): ContextWindow[] {
  const windows: ContextWindow[] = [];
  const total = source.lines.length;
  const width = String(total).length;
  const size = Math.max(40, windowLines);

  for (let start = 0; start < total; start += size) {
    const end = Math.min(total, start + size);
    const body: string[] = [];
    for (let index = start; index < end; index += 1) {
      const lineNumber = String(index + 1).padStart(width, " ");
      body.push(`${lineNumber}| ${source.lines[index] ?? ""}`);
    }
    windows.push({ startLine: start + 1, endLine: end, text: body.join("\n") });
  }

  return windows;
}

export function buildFileContext(
  source: SourceFile,
  options: ContextOptions = DEFAULT_CONTEXT_OPTIONS,
): FileContext {
  const language = detectLanguage(source.path, source.content);

  return {
    file: source,
    language,
    imports: extractImports(source.content, language),
    exports: extractExports(source.content, language),
    symbols: extractSymbols(source.content, language),
    windows: buildWindows(source, options.windowLines),
  };
}

/**
 * Module resolution, done on repository-relative POSIX paths rather than through
 * the filesystem. The file list is already known, so resolution is a set lookup
 * and never an I/O call.
 *
 * This is best-effort by design. A resolved relative import adds real context to
 * a review; a missed one costs nothing, because the file is still reviewed on
 * its own.
 */
const MODULE_EXTENSIONS = [
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  ".vue", ".svelte", ".py", ".rs", ".go",
];
const MODULE_INDEX_NAMES = [
  "index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs",
  "index.vue", "index.svelte",
  "__init__.py", "mod.rs",
];

/** Collapses `.` and `..` segments in a repository-relative POSIX path. */
export function normaliseRepoPath(path: string): string {
  const output: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      output.pop();
      continue;
    }
    output.push(segment);
  }
  return output.join("/");
}

export function dirnameOf(path: string): string {
  const normalised = path.replace(/\\/g, "/");
  const index = normalised.lastIndexOf("/");
  return index === -1 ? "" : normalised.slice(0, index);
}

function candidatePaths(base: string): string[] {
  const candidates: string[] = [];
  if (base !== "") candidates.push(base);

  for (const extension of MODULE_EXTENSIONS) {
    candidates.push(`${base}${extension}`);
  }
  for (const indexName of MODULE_INDEX_NAMES) {
    candidates.push(base === "" ? indexName : `${base}/${indexName}`);
  }

  return candidates;
}

/**
 * Resolves a module specifier to a reviewed file, or null. Package specifiers
 * are deliberately left unresolved: pulling in `node_modules` is not part of
 * reviewing this repository.
 */
export function resolveModulePath(
  fromPath: string,
  specifier: string,
  knownPaths: ReadonlySet<string>,
): string | null {
  if (specifier === "") return null;
  if (specifier.startsWith("node:") || specifier.startsWith("bun:")) return null;

  const directory = dirnameOf(fromPath);
  const isRelative = specifier.startsWith(".") || specifier.startsWith("/");

  // Path aliases such as `@/lib/x` are common enough to be worth a guess, and
  // the guess is checked against the real file list before it is used.
  if (specifier.startsWith("@/")) {
    const tail = specifier.slice(2);
    for (const base of [`src/${tail}`, tail]) {
      for (const candidate of candidatePaths(normaliseRepoPath(base))) {
        if (knownPaths.has(candidate)) return candidate;
      }
    }
    return null;
  }

  if (!isRelative) return null;

  const joined = specifier.startsWith("/")
    ? normaliseRepoPath(specifier)
    : normaliseRepoPath(`${directory}/${specifier}`);

  for (const candidate of candidatePaths(joined)) {
    if (knownPaths.has(candidate)) return candidate;
  }

  return null;
}

/** A file whose contract the reviewed file depends on. */
export interface RelatedFile {
  path: string;
  /** Imports, exports, and symbols, in the same shape as `profileLine`. */
  profile: string;
}

/**
 * Finds the reviewed files this one imports. This is what lets a reviewer judge
 * a change against the contract it has to keep, rather than guessing.
 */
export function buildRelatedFiles(
  context: FileContext,
  contexts: ReadonlyMap<string, FileContext>,
): RelatedFile[] {
  const knownPaths = new Set(contexts.keys());
  const related: RelatedFile[] = [];
  const seen = new Set<string>();

  for (const specifier of context.imports) {
    const resolved = resolveModulePath(context.file.path, specifier, knownPaths);
    if (resolved === null || seen.has(resolved) || resolved === context.file.path) continue;

    const target = contexts.get(resolved);
    if (target === undefined) continue;

    seen.add(resolved);
    related.push({ path: resolved, profile: profileLine(target) });
  }

  return related;
}

export function profileLine(context: FileContext): string {
  const parts = [`language: ${context.language.id}`, `lines: ${lastLineNumber(context.file.content)}`];
  if (context.imports.length > 0) parts.push(`imports: ${context.imports.slice(0, 12).join(", ")}`);
  if (context.exports.length > 0) parts.push(`exports: ${context.exports.slice(0, 12).join(", ")}`);
  if (context.symbols.length > 0) parts.push(`symbols: ${context.symbols.slice(0, 12).join(", ")}`);
  return parts.join(" | ");
}
