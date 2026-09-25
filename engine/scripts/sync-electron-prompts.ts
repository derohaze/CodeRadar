/**
 * Copies the prompt assets into the packaged Electron folder.
 *
 * `engine/prompts/` is the single source of truth for the review policy, and the
 * app loads its prompts from `frontend/electron/prompts/` because that is the
 * directory electron-builder ships. Keeping a hand-maintained second copy meant
 * the packaged app could review against a policy that no test ever ran.
 *
 * Run by `bun run build:electron`, so the copy is always regenerated from the
 * engine whenever the bundle is rebuilt.
 */

import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const source = path.join(import.meta.dir, "..", "prompts");
const destination = path.join(import.meta.dir, "..", "..", "frontend", "electron", "prompts");

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });

const written = await readdir(destination);
process.stdout.write(`Copied ${written.length} prompt file(s) to frontend/electron/prompts\n`);
