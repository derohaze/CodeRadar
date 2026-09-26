/**
 * The review API as a standalone process — the backend, run on its own.
 *
 * `bun run serve` starts the engine, binds the local API, and stays up. The
 * frontend does not need to know how it was started: it only needs a base URL
 * and the token, both of which are printed here and both of which the Electron
 * main process also accepts from the environment, so one command can wire the two
 * together without either knowing about the other.
 *
 * Three deliberate choices:
 *
 * - **Settings live in the OS user-data directory**, the same one the packaged
 *   app uses, so a provider configured in a dev session is the provider the
 *   installed app sees. They are the user's settings, not the repository's.
 * - **The port defaults to 9000**, which is what the renderer falls back to when
 *   nothing tells it otherwise, so `curl` and a plain browser session both work
 *   with no configuration. Pass `0` to let the OS pick.
 * - **Output is plain and greppable.** A short block states where the API is,
 *   where its settings live and what it is running on; after that it is one
 *   access-log line per request. No box drawing, no decoration — a log is read
 *   by a person and by `grep`.
 *
 * The printed block is machine-readable on purpose: the dev orchestrator parses
 * `CODE_RADAR_API_URL=` and `CODE_RADAR_API_TOKEN=` instead of guessing a port.
 * Those two lines are a contract — `frontend/scripts/dev.mjs` reads them — so
 * they keep their exact shape no matter what is printed around them.
 */

import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { startReviewApiServer } from "./api/server.ts";
import type { RequestLogEntry } from "./api/server.ts";
import { ROUTE_GROUPS } from "./api/router.ts";
import { API_PREFIX } from "./api/security.ts";
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

/*
 * Colour is limited to the status code, which is the one field an operator scans
 * for. It is never forced: a piped stdout (`bun run dev:all` prefixes and
 * forwards these lines) and a `NO_COLOR` environment both get plain text, so a
 * captured log stays readable and greppable.
 */
const SGR = {
  reset: "\u001b[0m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
} as const;

function useColour(): boolean {
  return process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;
}

/** Colours an already-padded status, so the column still lines up. */
function colourStatus(padded: string, status: number): string {
  if (!useColour()) return padded;
  const code = status >= 500 ? SGR.red : status >= 400 ? SGR.yellow : SGR.green;
  return `${code}${padded}${SGR.reset}`;
}

/** `bun 1.4.2 (node 26.3.0), win32 x64, pid 205952` — what a bug report needs. */
function runtimeSummary(): string {
  const bun = (process.versions as Record<string, string | undefined>)["bun"];
  const runtime = bun === undefined ? `node ${process.versions.node}` : `bun ${bun} (node ${process.versions.node})`;
  return `${runtime}, ${process.platform} ${process.arch}, pid ${process.pid}`;
}

function printBanner(info: { url: string; token: string; settingsPath: string }): void {
  const row = (label: string, value: string): string => `  ${label.padEnd(10)} ${value}\n`;

  process.stdout.write(
    "CodeRadar review engine\n\n" +
      row("API", info.url) +
      row("Settings", info.settingsPath) +
      row("Runtime", runtimeSummary()) +
      row("Token", `${info.token.slice(0, 12)}... (full value below)`) +
      // Read from the router, so this cannot drift from the order requests are
      // actually tried in.
      row("Routes", ROUTE_GROUPS.map((group) => group.name).join(", ")) +
      "\n",
  );
}

/** One access-log line per finished request: time, method, path, status, duration. */
function printRequest(entry: RequestLogEntry): void {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const path = entry.path.length > 46 ? `${entry.path.slice(0, 45)}...` : entry.path;

  process.stdout.write(
    `  ${stamp}  ${entry.method.padEnd(7)} ${path.padEnd(46)} ` +
      `${colourStatus(String(entry.status).padStart(3), entry.status)} ${String(entry.durationMs).padStart(5)}ms\n`,
  );
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
    logRequest: printRequest,
  });

  return {
    url: `${server.origin}${API_PREFIX}`,
    token: server.token,
    close: () => server.close(),
  };
}

export async function main(): Promise<void> {
  const server = await startStandaloneServer();
  const settingsPath = path.join(process.env["CODE_RADAR_SETTINGS_DIR"] ?? defaultSettingsDir(), "settings.json");

  printBanner({ url: server.url, token: server.token, settingsPath });

  // Greppable, so the dev orchestrator never has to guess a port. Changing the
  // shape of these two lines breaks `frontend/scripts/dev.mjs`.
  process.stdout.write(
    `CODE_RADAR_API_URL=${server.url}\n` +
      `CODE_RADAR_API_TOKEN=${server.token}\n\n` +
      `Every route except ${API_PREFIX}/health/live needs the token above, for example:\n` +
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
