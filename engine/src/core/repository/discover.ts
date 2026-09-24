/**
 * Repository discovery.
 *
 * Two things here are security controls rather than conveniences:
 *
 * 1. Secret-bearing files are excluded by name before they are ever read. A
 *    review pipeline sends source to a model, so reading `.env` or a private key
 *    would exfiltrate credentials. Excluding them is deliberate and must not be
 *    relaxed for convenience.
 * 2. The walk is bounded in file count, file size, and depth. An unbounded walk
 *    of a user-chosen path is how a review turns into a hang.
 */

import { detectLanguage, looksBinary, looksGenerated } from "../languages/detect.ts";
import type { LanguageInfo } from "../languages/detect.ts";
import { toPosixPath } from "../findings/model.ts";
import type { FileSystemPort } from "../ports.ts";

export interface DiscoveredFile {
  /** Path relative to the review root, POSIX separators. */
  path: string;
  /** Absolute path on disk, used only by the filesystem adapter. */
  absolutePath: string;
  size: number;
  language: LanguageInfo;
}

export interface DiscoveryLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxDepth: number;
}

export const DEFAULT_DISCOVERY_LIMITS: DiscoveryLimits = {
  // A review of more files than this is not read by anyone, and the model
  // budget would be spent before the first finding.
  maxFiles: 2000,
  maxFileBytes: 400_000,
  maxDepth: 24,
};

/** Directories that never contain reviewable source. */
const IGNORED_DIRECTORIES = new Set([
  ".git", ".hg", ".svn",
  "node_modules", "bower_components", "jspm_packages",
  "dist", "build", "out", "output", "release", "artifacts",
  "target", "bin", "obj",
  "vendor",
  ".venv", "venv", "env", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".eggs",
  "coverage", ".nyc_output", "htmlcov",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".parcel-cache", ".cache",
  ".idea", ".vscode", ".gradle", "Pods", "DerivedData",
  "test-results", "playwright-report",
]);

/**
 * Files that may carry credentials or are not source. Reading these would send
 * secrets to a model provider, so they are dropped before any read happens.
 */
const SECRET_OR_NOISE_FILES = new Set([
  ".env", ".env.local", ".env.development", ".env.production", ".env.test",
  ".npmrc", ".netrc", ".htpasswd", ".pgpass",
  "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
  "credentials", "credentials.json", "service-account.json", "secrets.json",
  ".git-credentials",
]);

const IGNORED_BASENAMES = new Set([
  // Lockfiles are large, machine-generated, and contain no reviewable logic.
  "bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "Cargo.lock", "poetry.lock", "uv.lock", "Pipfile.lock", "composer.lock", "Gemfile.lock",
  ".DS_Store", "Thumbs.db",
]);

/** Extensions that are never source text, checked before reading. */
const IGNORED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp", ".avif",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".pdf", ".zip", ".gz", ".tar", ".7z", ".rar", ".bz2", ".xz",
  ".mp3", ".mp4", ".webm", ".mov", ".avi", ".wav", ".ogg",
  ".so", ".dylib", ".dll", ".exe", ".bin", ".o", ".a", ".class", ".jar", ".war",
  ".pyc", ".pyo", ".wasm", ".node", ".snap",
  ".pem", ".key", ".p12", ".pfx", ".keystore", ".jks",
  ".map", ".min.js", ".min.css",
]);

/** Dotfiles and dot-directories worth reviewing despite the leading dot. */
const ALLOWED_DOT_PATHS = new Set([".github", ".gitlab", ".circleci", ".husky", ".devcontainer"]);

function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".min.js")) return ".min.js";
  if (lower.endsWith(".min.css")) return ".min.css";
  const index = lower.lastIndexOf(".");
  return index <= 0 ? "" : lower.slice(index);
}

function isSecretFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (SECRET_OR_NOISE_FILES.has(lower)) return true;
  // `.env.production.local` and friends.
  return lower.startsWith(".env.") || lower.endsWith(".pem") || lower.endsWith(".key");
}

function isIgnoredSegment(segment: string): boolean {
  if (segment === "" || segment === "." || segment === "..") return false;
  if (IGNORED_DIRECTORIES.has(segment)) return true;
  if (segment.startsWith(".") && !ALLOWED_DOT_PATHS.has(segment)) return true;
  return false;
}

/**
 * True when a repository-relative path should not be walked or read. Exported so
 * callers can explain an exclusion instead of silently dropping a file.
 */
export function isIgnoredPath(relativePath: string): boolean {
  const normalised = toPosixPath(relativePath);
  const segments = normalised.split("/").filter((segment) => segment !== "");
  const name = segments[segments.length - 1] ?? "";

  for (let index = 0; index < segments.length - 1; index += 1) {
    if (isIgnoredSegment(segments[index] ?? "")) return true;
  }

  if (segments.length > 1 && isIgnoredSegment(name)) return true;
  if (isSecretFile(name)) return true;
  if (IGNORED_BASENAMES.has(name)) return true;
  if (IGNORED_EXTENSIONS.has(extensionOf(name))) return true;

  return false;
}

export interface DiscoveryResult {
  root: string;
  files: DiscoveredFile[];
  /** Entries skipped by an ignore rule. */
  skipped: number;
  /** True when `maxFiles` cut the walk short. */
  truncated: boolean;
}

export interface DiscoveryOptions {
  limits?: Partial<DiscoveryLimits>;
  /** Called after each directory is listed; used for cancellation and progress. */
  shouldContinue?: (() => boolean) | undefined;
}

/**
 * Walks a directory tree and returns the reviewable files, deterministically
 * ordered by path. Symlinked directories are not followed, which removes the
 * loop hazard entirely rather than guarding against it.
 */
export async function discoverRepository(
  root: string,
  fs: FileSystemPort,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const limits: DiscoveryLimits = { ...DEFAULT_DISCOVERY_LIMITS, ...options.limits };
  const files: DiscoveredFile[] = [];
  let skipped = 0;
  let truncated = false;

  const queue: Array<{ absolute: string; relative: string; depth: number }> = [
    { absolute: root, relative: "", depth: 0 },
  ];

  while (queue.length > 0) {
    if (options.shouldContinue !== undefined && !options.shouldContinue()) break;
    if (files.length >= limits.maxFiles) {
      truncated = true;
      break;
    }

    const current = queue.shift();
    if (current === undefined) break;

    let entries;
    try {
      entries = await fs.listDirectory(current.absolute);
    } catch {
      // An unreadable directory is not a review failure. Skip it and continue.
      skipped += 1;
      continue;
    }

    // Sorting here is what makes discovery deterministic across platforms.
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relative = current.relative === "" ? entry.name : `${current.relative}/${entry.name}`;

      if (isIgnoredPath(relative)) {
        skipped += 1;
        continue;
      }

      if (entry.isSymbolicLink) {
        skipped += 1;
        continue;
      }

      const absolute = fs.join(current.absolute, entry.name);

      if (entry.isDirectory) {
        if (current.depth + 1 > limits.maxDepth) {
          skipped += 1;
          continue;
        }
        queue.push({ absolute, relative, depth: current.depth + 1 });
        continue;
      }

      if (!entry.isFile) {
        skipped += 1;
        continue;
      }

      if (files.length >= limits.maxFiles) {
        truncated = true;
        break;
      }

      const language = detectLanguage(entry.name);
      if (!language.reviewable) {
        skipped += 1;
        continue;
      }

      let size = 0;
      try {
        const stat = await fs.stat(absolute);
        size = stat.size;
      } catch {
        skipped += 1;
        continue;
      }

      if (size > limits.maxFileBytes) {
        skipped += 1;
        continue;
      }

      files.push({ path: toPosixPath(relative), absolutePath: absolute, size, language });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { root, files, skipped, truncated };
}

/**
 * Drops a file whose content is binary or generated. Content-dependent checks
 * cannot happen during the walk without reading every file, so they run when
 * the file is loaded for review.
 */
export function isReviewableContent(path: string, content: string): boolean {
  if (looksBinary(content)) return false;
  if (looksGenerated(content)) return false;
  // A file with no lines at all has nothing to anchor a finding to.
  return detectLanguage(path, content).reviewable && content.trim() !== "";
}
