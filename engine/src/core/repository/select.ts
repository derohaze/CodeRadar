/**
 * Scope selection and review ordering.
 *
 * Ordering is a product decision, not a nicety. When a diff exists, changed
 * files are reviewed first because they are what the author is asking about.
 * When there is no diff, source is reviewed before tests, docs, and config,
 * because that is where defects that ship live.
 */

import type { DiscoveredFile } from "./discover.ts";

export interface ReviewTarget {
  file: DiscoveredFile;
  /** True when this file differs from the base branch. */
  changed: boolean;
  /**
   * New-file lines in scope. Empty means the whole file is in scope.
   * A non-empty set must be honoured by the validator.
   */
  changedLines: Set<number>;
}

export interface SelectOptions {
  /** Repository-relative changed paths, POSIX. Empty when git was unavailable. */
  changedPaths?: readonly string[] | undefined;
  /** Changed line numbers per repository-relative path. */
  changedLinesByPath?: ReadonlyMap<string, Set<number>> | undefined;
  /** When a diff exists, review only the changed files. */
  changedOnly?: boolean;
  maxFiles: number;
}

export const DEFAULT_MAX_REVIEW_FILES = 200;

/**
 * Review priority by path. Lower sorts first. Only coarse, defensible rules are
 * used here: anything more clever would encode opinions the bar does not have.
 */
function pathPriority(path: string): number {
  const lower = path.toLowerCase();

  if (/(^|\/)(tests?|__tests__|spec|specs)\//.test(lower)) return 70;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(lower)) return 70;
  if (/(^|\/)test_|_test\.(py|go|rs)$/.test(lower)) return 70;
  if (/(^|\/)migrations?\//.test(lower)) return 60;
  if (/\.(md|mdx|txt|rst)$/.test(lower)) return 90;
  if (/(^|\/)(docs?|examples?)\//.test(lower)) return 90;
  if (/(^|\/)(fixtures?|__snapshots__|testdata)\//.test(lower)) return 95;
  if (/\.(json|ya?ml|toml|ini|cfg|lock|env)$/.test(lower)) return 50;
  if (/(^|\/)(scripts?|tools?|bin)\//.test(lower)) return 40;
  return 10;
}

/**
 * Entry points and files likely to hold the interesting logic. A file named
 * `index`, `main`, `server`, `app`, `router`, or a `service`/`handler` module
 * is where a defect has the widest reach, so it is read first.
 */
function isEntryLike(path: string): boolean {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  return /^(index|main|app|server|router|routes?|handler|handlers|service|services|controller|middleware)\./.test(
    name,
  );
}

export function selectReviewTargets(
  files: readonly DiscoveredFile[],
  options: SelectOptions,
): ReviewTarget[] {
  const changed = new Set((options.changedPaths ?? []).map((path) => path.replace(/\\/g, "/")));
  const changedLinesByPath = options.changedLinesByPath ?? new Map<string, Set<number>>();
  const diffAware = changed.size > 0;

  const candidates = files.filter((file) => {
    if (!file.language.reviewable) return false;
    if (options.changedOnly === true && diffAware && !changed.has(file.path)) return false;
    return true;
  });

  const targets: ReviewTarget[] = candidates.map((file) => ({
    file,
    changed: changed.has(file.path),
    changedLines: changedLinesByPath.get(file.path) ?? new Set<number>(),
  }));

  targets.sort((a, b) => {
    // 1. Changed files first: a review of a diff is about the diff.
    if (a.changed !== b.changed) return a.changed ? -1 : 1;

    // 2. Then entry-like files, which carry the most reach.
    const aEntry = isEntryLike(a.file.path) ? 0 : 1;
    const bEntry = isEntryLike(b.file.path) ? 0 : 1;
    if (aEntry !== bEntry) return aEntry - bEntry;

    // 3. Then coarse path priority.
    const aPriority = pathPriority(a.file.path);
    const bPriority = pathPriority(b.file.path);
    if (aPriority !== bPriority) return aPriority - bPriority;

    // 4. Then path, so the order is stable between runs.
    return a.file.path.localeCompare(b.file.path);
  });

  return targets.slice(0, Math.max(1, options.maxFiles));
}
