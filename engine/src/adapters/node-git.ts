/**
 * Git adapter.
 *
 * Git is invoked with an argument array and never through a shell. That matters
 * because a ref name can come from configuration or, later, from a user: a
 * command string would make `; rm -rf` reachable, an argument array cannot.
 *
 * The index lock is disabled and the pager is off, because this adapter only
 * reads. A review must not be able to modify the repository it is reviewing.
 */

import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import type { GitPort } from "../core/ports.ts";
import { toPosixPath } from "../core/findings/model.ts";

export interface NodeGitOptions {
  /** Per-command timeout. A hung git must not hang a review. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/**
 * Ref names git accepts, restricted to a conservative subset.
 *
 * A ref beginning with `-` would be read as an option by git, which turns a
 * branch name into a way to pass arbitrary flags. The pattern rejects that, and
 * also rejects `..` and a trailing `.lock`, which git itself forbids.
 */
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function isSafeRef(ref: string): boolean {
  if (ref === "" || ref.length > 255) return false;
  if (!SAFE_REF.test(ref)) return false;
  if (ref.includes("..")) return false;
  if (ref.endsWith("/") || ref.endsWith(".")) return false;
  if (ref.endsWith(".lock")) return false;
  return true;
}

interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Turns whatever the caller selected into a directory git can run in.
 *
 * Reviewing one file is the most common case, and a file is not a working
 * directory: git fails outright and the repository goes undetected, which would
 * silently cost a single-file review its diff awareness and its repository
 * relative paths. Asking git to run in the file's directory is the whole fix.
 */
function gitCwd(target: string): string {
  try {
    const info = statSync(target);
    if (info.isFile()) return path.dirname(target);
  } catch {
    // A path that cannot be stat'ed is left alone; git will report the failure.
  }
  return target;
}

function runGit(args: readonly string[], cwd: string, timeoutMs: number): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      [...args],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          GIT_PAGER: "cat",
          GIT_OPTIONAL_LOCKS: "0",
          // Keeps paths reported by git stable and UTF-8 rather than escaped.
          LC_ALL: "C.UTF-8",
        },
      },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof (error as { code?: unknown }).code === "number"
              ? (error as { code: number }).code
              : 1;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code: code === 0 ? 0 : 1 });
      },
    );
  });
}

/** Branches to try, in order, when the caller did not name one. */
const BASE_BRANCH_CANDIDATES = [
  "origin/main",
  "origin/master",
  "main",
  "master",
  "develop",
  "origin/develop",
];

export function createNodeGit(options: NodeGitOptions = {}): GitPort {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function revParse(cwd: string, args: readonly string[]): Promise<string | null> {
    const result = await runGit(["rev-parse", ...args], cwd, timeoutMs);
    if (result.code !== 0) return null;
    const value = result.stdout.trim();
    return value === "" ? null : value;
  }

  return {
    async detectRepository(target: string) {
      const cwd = gitCwd(target);

      // `--is-inside-work-tree` answers false for a bare repository, which is
      // not something that can be reviewed as a working tree.
      const inside = await runGit(["rev-parse", "--is-inside-work-tree"], cwd, timeoutMs);
      if (inside.code !== 0 || inside.stdout.trim() !== "true") return null;

      const root = await revParse(cwd, ["--show-toplevel"]);
      if (root === null) return null;

      // A detached HEAD reports the literal string "HEAD", which is not a
      // branch name and must not be presented as one.
      const branchName = await revParse(cwd, ["--abbrev-ref", "HEAD"]);
      const branch = branchName === null || branchName === "HEAD" ? null : branchName;

      return { root: toPosixPath(root), branch };
    },

    async resolveBaseBranch(root: string, preferred?: string) {
      if (preferred !== undefined) {
        if (!isSafeRef(preferred)) return null;
        const verified = await runGit(["rev-parse", "--verify", "--quiet", `${preferred}^{commit}`], root, timeoutMs);
        return verified.code === 0 ? preferred : null;
      }

      for (const candidate of BASE_BRANCH_CANDIDATES) {
        const verified = await runGit(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], root, timeoutMs);
        if (verified.code === 0) return candidate;
      }

      return null;
    },

    async diff(root: string, base: string) {
      if (!isSafeRef(base)) return "";
      // `git diff <base>` compares the working tree against that commit, so
      // committed and uncommitted work are both covered.
      const result = await runGit(["diff", "--no-color", "--unified=3", "--no-ext-diff", base], root, timeoutMs + 30_000);
      return result.code === 0 ? result.stdout : "";
    },

    async changedFiles(root: string, base: string) {
      if (!isSafeRef(base)) return [];
      const result = await runGit(["diff", "--name-only", "--no-ext-diff", base], root, timeoutMs);
      if (result.code !== 0) return [];

      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((line) => toPosixPath(line));
    },
  };
}
