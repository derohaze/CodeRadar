/**
 * File-backed replay store.
 *
 * Recordings are local, not versioned. A recording contains the raw model
 * response, and a model response quotes the code it was shown — so the directory
 * is created outside version control, with owner-only permissions, and is
 * deliberately not part of the repository. The root `.gitignore` names
 * `.coderadar/` so it cannot be committed by accident.
 *
 * Nothing here ever sees an API key: the key function hashes prompts, and the
 * store writes only the response.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReplayArtifact, ReplayKeyFn, ReplayKeyInput, ReplayStore } from "../core/replay/replay.ts";

/** Owner-only, because a recording holds source code taken from the workspace. */
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export const REPLAY_DIRECTORY_ENV = "CODE_RADAR_REPLAY_DIR";

/**
 * Where recordings live, unless the caller says otherwise.
 *
 * `CODE_RADAR_REPLAY_DIR` wins so a benchmark can keep several matrices apart
 * without editing anything, and the default sits under the engine directory
 * beside the rest of its local state.
 */
export function resolveReplayDirectory(root: string): string {
  const override = process.env[REPLAY_DIRECTORY_ENV];
  return override !== undefined && override.trim() !== "" ? path.resolve(override) : path.join(root, ".coderadar", "replay");
}

/**
 * A stable key for a request.
 *
 * The hash covers the reviewer, the model, the output cap and both prompts, each
 * length-prefixed so two different prompt pairs cannot collide by concatenation.
 * Prompts are hashed rather than stored in the name, so the directory listing does
 * not leak the code under review.
 */
export function createNodeReplayKey(input: ReplayKeyInput): string {
  const hash = createHash("sha256");
  const maxOutputTokens = input.maxOutputTokens === null || input.maxOutputTokens === undefined ? "0" : String(input.maxOutputTokens);
  for (const part of [input.reviewer, input.model ?? "", maxOutputTokens, input.systemPrompt, input.userPrompt]) {
    hash.update(`${Buffer.byteLength(part, "utf8")}:`);
    hash.update(part, "utf8");
  }
  return hash.digest("hex");
}

/** Reads and writes one JSON file per key. Missing is a normal answer, not an error. */
export function createNodeReplayStore(directory: string): ReplayStore {
  const fileFor = (key: string): string => path.join(directory, `${key}.json`);

  return {
    async read(key: string): Promise<ReplayArtifact | null> {
      try {
        const text = await readFile(fileFor(key), "utf8");
        return JSON.parse(text) as ReplayArtifact;
      } catch {
        // An unreadable or corrupt recording is treated as absent: the caller
        // gets an explicit miss, never a half-parsed answer.
        return null;
      }
    },

    async write(artifact: ReplayArtifact): Promise<void> {
      await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
      await writeFile(fileFor(artifact.key), `${JSON.stringify(artifact, null, 2)}\n`, {
        encoding: "utf8",
        mode: FILE_MODE,
      });
    },
  };
}

/** A key function for this adapter, exposed so callers cannot invent a second one. */
export const nodeReplayKey: ReplayKeyFn = createNodeReplayKey;
