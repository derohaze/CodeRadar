/**
 * The review API as a standalone process — the backend, run on its own.
 *
 * `bun run serve` starts the engine, binds the local API, and stays up. The
 * frontend does not need to know how it was started: it only needs a base URL
 * and the token, both of which are printed here and both of which the Electron
 * main process also accepts from the environment, so one command can wire the two
 * together without either knowing about the other.
 *
 * Two deliberate choices:
 *
 * - **Settings live in the OS user-data directory**, the same one the packaged
 *   app uses, so a provider configured in a dev session is the provider the
 *   installed app sees. They are the user's settings, not the repository's.
 * - **The port defaults to 9000**, which is what the renderer falls back to when
 *   nothing tells it otherwise, so `curl` and a plain browser session both work
 *   with no configuration. Pass `0` to let the OS pick.
 *
 * The printed block is machine-readable on purpose: the dev orchestrator parses
 * `CODE_RADAR_API_URL=` and `CODE_RADAR_API_TOKEN=` instead of guessing a port.
 */

import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { startReviewApiServer } from "./api/server.ts";
import { createLocalKeyCipher } from "./local-cipher.ts";
import { createReviewService, resolvePromptsDir } from "./service.ts";
import { createSettingsStore } from "./settings.ts";

export const DEFAULT_SERVE_PORT = 9000;

/** The user-data directory, computed the way Electron computes it. */
function defaultSettingsDir(): string {
  const appName = "CodeRadar";
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), appName);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", appName);
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), appName);
}

export interface StandaloneServer {
  url: string;
  token: string;
  close(): Promise<void>;
}

export async function startStandaloneServer(env: NodeJS.ProcessEnv = process.env): Promise<StandaloneServer> {
  const settingsDir = env["CODE_RADAR_SETTINGS_DIR"] ?? defaultSettingsDir();
  const promptsDir = resolvePromptsDir(path.join(import.meta.dir, "..", ".."));

  // No OS keychain here, so the key is encrypted with a machine-local key and
  // reported as `basic` protection rather than being silently stored in clear.
  const cipher = createLocalKeyCipher({ keyPath: path.join(settingsDir, "local-key") });

  const settingsStore = createSettingsStore({ filePath: path.join(settingsDir, "settings.json"), cipher });
  const service = createReviewService({ settingsStore, promptsDir });

  const configuredPort = Number.parseInt(env["CODE_RADAR_API_PORT"] ?? "", 10);
  const port = Number.isFinite(configuredPort) && configuredPort >= 0 ? configuredPort : DEFAULT_SERVE_PORT;

  const server = await startReviewApiServer({
    service,
    token: env["CODE_RADAR_API_TOKEN"] ?? randomBytes(32).toString("hex"),
    port,
  });

  return {
    url: `${server.origin}/api/v1`,
    token: server.token,
    close: () => server.close(),
  };
}

async function main(): Promise<void> {
  const server = await startStandaloneServer();

  // Greppable, so the dev orchestrator never has to guess a port.
  process.stdout.write(
    `\nCodeRadar review engine is running.\n` +
      `\n  API      ${server.url}\n` +
      `  Settings ${path.join(process.env["CODE_RADAR_SETTINGS_DIR"] ?? defaultSettingsDir(), "settings.json")}\n` +
      `\nCODE_RADAR_API_URL=${server.url}\nCODE_RADAR_API_TOKEN=${server.token}\n\n` +
      `Every route except /health/live needs the token above, for example:\n` +
      `  curl -H "x-coderadar-token: ${server.token}" ${server.url}/settings/providers\n\n` +
      `Press Ctrl+C to stop.\n\n`,
  );

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void server.close().then(() => process.exit(0), () => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) await main();
