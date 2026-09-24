/**
 * Filesystem adapter for Node and Bun.
 *
 * This is the only module in the engine that touches the filesystem. Keeping it
 * to one file is what allows the core to be tested against an in-memory tree and
 * what will let the Electron main process swap in a sandboxed implementation
 * without changing the pipeline.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DirectoryEntry, FileSystemPort, PathStat } from "../core/ports.ts";
import { toPosixPath } from "../core/findings/model.ts";

/** A UTF-8 BOM at the start of a file would otherwise shift every column. */
const BOM = "\uFEFF";

export function createNodeFileSystem(): FileSystemPort {
  return {
    async readTextFile(filePath: string): Promise<string> {
      const content = await readFile(filePath, "utf8");
      return content.startsWith(BOM) ? content.slice(1) : content;
    },

    async listDirectory(directory: string): Promise<DirectoryEntry[]> {
      const entries = await readdir(directory, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        // A symlinked directory reports isDirectory() false on some platforms,
        // and the walk refuses to follow links anyway, so the flag is explicit.
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        isSymbolicLink: entry.isSymbolicLink(),
      }));
    },

    async stat(target: string): Promise<PathStat> {
      const info = await stat(target);
      return { isFile: info.isFile(), isDirectory: info.isDirectory(), size: info.size };
    },

    async exists(target: string): Promise<boolean> {
      try {
        await stat(target);
        return true;
      } catch {
        return false;
      }
    },

    join: (...segments: string[]) => path.join(...segments),
    resolve: (...segments: string[]) => path.resolve(...segments),
    relative: (from: string, to: string) => toPosixPath(path.relative(from, to)),
    basename: (target: string) => path.basename(target),
    directoryName: (target: string) => path.dirname(target),
  };
}
