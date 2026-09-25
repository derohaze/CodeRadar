/**
 * The local review API.
 *
 * The renderer already speaks this contract over HTTP, so the migration keeps
 * that contract and replaces what is behind it: the legacy Python service is
 * gone, and this Node server in the Electron main process serves the same routes
 * from the TypeScript review engine. No screen changes, no Python, no Rust.
 *
 * # Why this needs a security envelope
 *
 * This is the only part of the app that listens on a socket, and it hands out
 * two things an attacker wants: the contents of the user's source tree, and the
 * ability to send that source to a third-party model provider. Loopback is not a
 * boundary — any web page the user visits can reach `127.0.0.1`. Four controls,
 * each closing a specific hole:
 *
 * 1. **Bind to `127.0.0.1` only.** Never a routable interface, so the API is not
 *    reachable from the network the machine is on.
 * 2. **A per-launch token** on every route that reads or changes anything. The
 *    main process generates it, hands it to the renderer, and never writes it to
 *    disk. A page in the user's browser cannot read it, which is what stops a
 *    drive-by request. Without this, a sandboxed iframe — which sends
 *    `Origin: null` — could read reviews, because production loads the renderer
 *    from `file://` and so genuinely has a null origin itself.
 * 3. **An origin allowlist, and never `Access-Control-Allow-Origin: *`.** The
 *    browser then refuses to hand a response to any other page, and a JSON POST
 *    from another origin never even reaches a handler because `application/json`
 *    makes it a preflighted request.
 * 4. **A `Host` check.** A DNS-rebinding attack reaches loopback under an
 *    attacker's hostname; requiring `127.0.0.1`/`localhost` refuses it.
 *
 * `GET /health/live` is deliberately exempt: the renderer probes it before it
 * can know anything, and it returns no data. Everything else requires the token.
 */

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { ReviewEvent, ReviewEventSink } from "../core/ports.ts";
import type { ReviewReport } from "../core/findings/model.ts";
import { SourceWindowError } from "./source-window.ts";
import type { ReviewService } from "./service.ts";
import type { DesktopPreferences, ProviderSettings, SettingsPatch } from "./settings.ts";
import type { ProviderOverrides } from "./service.ts";
import {
  buildWireScanDetail,
  buildWireSession,
  type WirePreset,
  type WireScanDetail,
  type WireScanMode,
  type WireSessionStatus,
} from "./api-contract.ts";

const API_PREFIX = "/api/v1";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PROGRESS_LOGS = 200;
/** Session history is per run: nothing outlives the app, by design. */
const MAX_SESSIONS = 100;

export interface ReviewApiServerOptions {
  service: ReviewService;
  /** Secret the renderer must present. Generated per launch by the caller. */
  token: string;
  host?: string;
  port?: number;
  /** Extra browser origins to accept, for a dev server on another port. */
  allowedOrigins?: readonly string[];
}

export interface ReviewApiServer {
  readonly port: number;
  readonly origin: string;
  /** The secret callers must present. Returned so the main process can pass it on. */
  readonly token: string;
  close(): Promise<void>;
}

interface SessionRecord {
  id: string;
  sourcePath: string;
  targetType: "file" | "folder";
  preset: WirePreset;
  scanMode: WireScanMode;
  status: WireSessionStatus;
  progress: number;
  phaseProgress: number;
  currentPhase: string;
  progressMessage: string;
  progressLogs: string[];
  createdAt: string;
  completedAt: string | null;
  elapsedSeconds: number;
  report: ReviewReport | null;
  aiSkipped: boolean;
  errorMessage: string | null;
  subscribers: Set<(detail: WireScanDetail) => void>;
}

/**
 * The stage a review event belongs to, named the way the progress screen names
 * its phases so the activity indicator matches the work actually in flight.
 */
const PHASE_BY_EVENT: Record<ReviewEvent["type"], { phase: string; progress: number }> = {
  "git:start": { phase: "Repository mapping", progress: 4 },
  "git:done": { phase: "Repository mapping", progress: 8 },
  "discovery:start": { phase: "Discovery", progress: 12 },
  "discovery:done": { phase: "Discovery", progress: 22 },
  "index:done": { phase: "Repository mapping", progress: 30 },
  "context:done": { phase: "Repository mapping", progress: 36 },
  "detectors:done": { phase: "Reviewing paths", progress: 52 },
  "ai:start": { phase: "Reviewing paths", progress: 58 },
  // A retry is not progress: it keeps the current position so the bar cannot
  // move backwards while the provider is being given another chance.
  "ai:retry": { phase: "Reviewing paths", progress: -1 },
  "ai:done": { phase: "Reviewing paths", progress: 82 },
  "ai:failed": { phase: "Reviewing paths", progress: -1 },
  "validation:done": { phase: "Validation", progress: 92 },
  done: { phase: "Completed", progress: 100 },
};

/**
 * The renderer's per-run preset, mapped onto the engine's finding budget.
 *
 * The preset is the user's choice of how wide a net this run casts, and the
 * Settings screen describes it in exactly those terms: "safe" prioritises
 * high-confidence findings, "aggressive" pushes deeper for more risky edges.
 * `null` means "use the saved setting", so the balanced preset leaves the
 * configured cap alone rather than replacing it with a number of its own.
 */
const PRESET_FINDING_BUDGET: Record<WirePreset, number | null> = {
  safe: 8,
  balanced: null,
  aggressive: 30,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asTargetType(value: unknown): "file" | "folder" {
  return value === "file" ? "file" : "folder";
}

function asPreset(value: unknown): WirePreset {
  return value === "safe" || value === "aggressive" ? value : "balanced";
}

function asScanMode(value: unknown): WireScanMode {
  return value === "fast" ? "fast" : "deep";
}

/**
 * The provider the Settings screen is showing, from its `snake_case` body.
 *
 * Every field is optional on purpose: an empty body means "what is stored".
 */
function toProviderOverrides(body: unknown): ProviderOverrides {
  if (!isRecord(body)) return {};
  const overrides: ProviderOverrides = {};
  if (typeof body["provider"] === "string") overrides.provider = body["provider"];
  if (typeof body["api_key"] === "string") overrides.apiKey = body["api_key"];
  if (typeof body["base_url"] === "string") overrides.baseUrl = body["base_url"];
  if (typeof body["model"] === "string") overrides.model = body["model"];
  return overrides;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The review could not be completed.";
}

/** Reads a bounded JSON body. An unbounded one is a memory-exhaustion primitive. */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("The request body is too large.");
    chunks.push(buffer);
  }

  if (size === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("The request body is not valid JSON.");
  }
}

export async function startReviewApiServer(options: ReviewApiServerOptions): Promise<ReviewApiServer> {
  const host = options.host ?? "127.0.0.1";
  const sessions = new Map<string, SessionRecord>();
  const allowedOrigins = new Set([
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    ...(options.allowedOrigins ?? []),
  ]);

  // `null` is how a browser labels a request from a `file://` document, which is
  // how the packaged app loads. It is accepted for the same-origin check but is
  // never echoed back as an allowed origin.
  const isAllowedOrigin = (origin: string): boolean => origin === "null" || allowedOrigins.has(origin);

  function hostIsLoopback(request: IncomingMessage): boolean {
    const header = request.headers.host;
    if (typeof header !== "string") return false;
    const name = header.replace(/:\d+$/, "").toLowerCase();
    return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
  }

  function presentedToken(request: IncomingMessage, url: URL): string | null {
    const header = request.headers["x-coderadar-token"];
    if (typeof header === "string") return header;
    return url.searchParams.get("token");
  }

  function corsHeaders(request: IncomingMessage): Record<string, string> {
    const origin = request.headers.origin;
    if (typeof origin !== "string" || !isAllowedOrigin(origin)) return {};
    // Echo the exact origin. Never `*`, which would let any page read the reply.
    return {
      "access-control-allow-origin": origin,
      vary: "Origin",
    };
  }

  function sendJson(request: IncomingMessage, response: ServerResponse, status: number, body: unknown): void {
    const payload = body === undefined ? "" : JSON.stringify(body);
    response.writeHead(status, {
      ...corsHeaders(request),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(payload),
    });
    response.end(payload);
  }

  function sendError(request: IncomingMessage, response: ServerResponse, status: number, detail: string): void {
    // The renderer reads `detail` and shows it through `toAnalystCopy`, so this
    // is the one place a message reaches the user.
    sendJson(request, response, status, { detail });
  }

  function detailFor(record: SessionRecord): WireScanDetail {
    const session = buildWireSession(
      {
        id: record.id,
        report: record.report ?? ({} as ReviewReport),
        sourcePath: record.sourcePath,
        targetType: record.targetType,
        preset: record.preset,
        scanMode: record.scanMode,
        aiSkipped: record.aiSkipped,
        createdAt: record.createdAt,
        completedAt: record.completedAt,
        elapsedSeconds: record.elapsedSeconds,
        progress: record.progress,
        phaseProgress: record.phaseProgress,
        currentPhase: record.currentPhase,
        progressMessage: record.progressMessage,
        progressLogs: record.progressLogs,
        status: record.status,
        errorMessage: record.errorMessage,
      },
      record.report,
    );
    return buildWireScanDetail(session, record.report, record.errorMessage);
  }

  function publish(record: SessionRecord, terminal: boolean): void {
    const detail = detailFor(record);
    for (const subscriber of [...record.subscribers]) {
      try {
        subscriber(detail);
      } catch {
        record.subscribers.delete(subscriber);
      }
    }
    if (terminal) record.subscribers.clear();
  }

  function applyEvent(record: SessionRecord, event: ReviewEvent): void {
    const stage = PHASE_BY_EVENT[event.type];
    if (stage !== undefined) {
      // Reviews report a stage per event, and several stages report the same
      // phase. Progress only ever moves forward so the bar cannot jump back.
      if (stage.progress > record.progress) {
        record.progress = stage.progress;
        record.phaseProgress = stage.progress;
      }
      record.currentPhase = stage.phase;
    }

    if (event.message !== "") {
      record.progressMessage = event.message;
      record.progressLogs.push(event.message);
      if (record.progressLogs.length > MAX_PROGRESS_LOGS) {
        record.progressLogs.splice(0, record.progressLogs.length - MAX_PROGRESS_LOGS);
      }
    }

    publish(record, false);
  }

  async function runReview(record: SessionRecord): Promise<void> {
    const startedAt = Date.now();
    const onEvent: ReviewEventSink = (event) => applyEvent(record, event);

    const budget = PRESET_FINDING_BUDGET[record.preset];

    try {
      const result = await options.service.startReview(
        {
          target: record.sourcePath,
          // "Fast review" reviews only what changed against the base branch;
          // "Deep review" reviews the whole selected scope. Outside a git
          // repository the engine finds no diff and reviews everything, so the
          // fast setting cannot silently review nothing.
          changedOnly: record.scanMode === "fast",
          ...(budget === null ? {} : { maxFindings: budget }),
        },
        onEvent,
      );
      record.report = result.report;
      record.aiSkipped = result.aiSkipped;
      record.status = "completed";
    } catch (error) {
      record.status = "failed";
      record.errorMessage = messageOf(error);
      record.progressMessage = record.errorMessage;
    } finally {
      record.elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      record.completedAt = new Date().toISOString();

      if (record.status === "completed") {
        // The terminal event carries the finished state, so the bar and the
        // phase agree with the report that is about to be returned.
        record.progress = 100;
        record.phaseProgress = 100;
        record.currentPhase = "Completed";
        record.progressMessage =
          record.report !== null && record.report.findings.length === 0
            ? "No issues found in the reviewed scope"
            : `Review finished with ${record.report?.findings.length ?? 0} finding(s)`;
      }

      publish(record, true);
    }
  }

  function streamEvents(request: IncomingMessage, response: ServerResponse, record: SessionRecord): void {
    response.writeHead(200, {
      ...corsHeaders(request),
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    const write = (eventName: string, detail: WireScanDetail): void => {
      response.write(`event: ${eventName}\ndata: ${JSON.stringify(detail)}\n\n`);
    };

    // A subscriber that attaches after the review already finished still needs
    // the result, and one that attaches mid-review needs the current state, so
    // the first frame is always the state as it stands.
    const isTerminal = record.status === "completed" || record.status === "failed";
    write(isTerminal ? (record.status === "completed" ? "scan_completed" : "scan_failed") : "scan_progress", detailFor(record));
    if (isTerminal) {
      response.end();
      return;
    }

    const subscriber = (detail: WireScanDetail): void => {
      const terminal = record.status === "completed" || record.status === "failed";
      write(terminal ? (record.status === "completed" ? "scan_completed" : "scan_failed") : "scan_progress", detail);
      if (terminal) response.end();
    };

    record.subscribers.add(subscriber);

    // A slow or dead SSE client must not hold the review open, so an idle
    // comment frame keeps the connection observable and the disconnect drops it.
    const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 15_000);
    const cleanup = (): void => {
      clearInterval(keepAlive);
      record.subscribers.delete(subscriber);
    };
    request.on("close", cleanup);
    response.on("close", cleanup);
  }

  async function handleScanStart(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendError(request, response, 400, messageOf(error));
      return;
    }

    const record0 = isRecord(body) ? body : {};
    const sourcePath = asString(record0["source_path"]);
    if (sourcePath === null) {
      sendError(request, response, 400, "A source path is required.");
      return;
    }
    if (options.service.isRunning()) {
      sendError(request, response, 409, "A review is already running.");
      return;
    }

    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: randomUUID(),
      sourcePath,
      targetType: asTargetType(record0["target_type"]),
      preset: asPreset(record0["preset"]),
      scanMode: asScanMode(record0["scan_mode"]),
      status: "scanning",
      progress: 2,
      phaseProgress: 2,
      currentPhase: "Discovery",
      progressMessage: "Starting the review",
      progressLogs: ["Starting the review"],
      createdAt: now,
      completedAt: null,
      elapsedSeconds: 0,
      report: null,
      aiSkipped: false,
      errorMessage: null,
      subscribers: new Set(),
    };

    sessions.set(record.id, record);
    if (sessions.size > MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest !== undefined) sessions.delete(oldest);
    }

    // The review runs in the background and the caller gets the session
    // immediately, because the progress screen is driven by the event stream.
    // Awaiting here would leave the user on the picker until the review ended.
    void runReview(record);
    sendJson(request, response, 200, detailFor(record));
  }

  /**
   * Translates the renderer's `snake_case` settings body into a store patch.
   *
   * The renderer owns this wire format and is not being changed, so the
   * translation lives here. Only fields the engine can act on are forwarded: a
   * key the store does not know is dropped rather than silently persisted, which
   * is why an accepted PATCH is read back in the response.
   */
  function toSettingsPatch(body: Record<string, unknown>): SettingsPatch {
    const patch: SettingsPatch = {};

    const provider: Partial<ProviderSettings> = {};
    if (typeof body["ai_provider"] === "string") provider.id = body["ai_provider"];
    if (typeof body["ai_base_url"] === "string") provider.baseUrl = body["ai_base_url"];
    if (typeof body["ai_model"] === "string") provider.model = body["ai_model"];
    if (Object.keys(provider).length > 0) patch.provider = provider;

    if (body["ai_api_key"] !== undefined) {
      patch.apiKey = typeof body["ai_api_key"] === "string" ? body["ai_api_key"] : null;
    }

    const desktop: Partial<DesktopPreferences> = {};
    const enumFields = [
      ["default_preset", "defaultPreset"],
      ["default_scan_mode", "defaultScanMode"],
      ["motion_profile", "motionProfile"],
      ["surface_contrast", "surfaceContrast"],
      ["theme", "theme"],
    ] as const;
    for (const [wire, field] of enumFields) {
      const value = body[wire];
      if (typeof value === "string") Object.assign(desktop, { [field]: value });
    }
    const booleanFields = [
      ["auto_open_results", "autoOpenResults"],
      ["remember_sidebar_state", "rememberSidebarState"],
      ["remediation_reuse_explanation", "remediationReuseExplanation"],
    ] as const;
    for (const [wire, field] of booleanFields) {
      const value = body[wire];
      if (typeof value === "boolean") Object.assign(desktop, { [field]: value });
    }
    if (typeof body["remediation_max_attempts"] === "number") {
      desktop.remediationMaxAttempts = body["remediation_max_attempts"];
    }
    if (Object.keys(desktop).length > 0) patch.desktop = desktop;

    return patch;
  }

  function handleSettingsPatch(request: IncomingMessage, response: ServerResponse, body: unknown): void {
    void options.service
      .updateSettings(isRecord(body) ? toSettingsPatch(body) : {})
      .then((settings) => {
        // The renderer's settings screen reads these snake_case fields.
        sendJson(request, response, 200, settingsPayload(settings));
      })
      .catch((error: unknown) => sendError(request, response, 400, messageOf(error)));
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${host}`);
    const method = request.method ?? "GET";
    const path = url.pathname;

    // Preflight is answered for allowlisted origins only, which is what keeps a
    // JSON POST from another page from ever reaching a handler.
    if (method === "OPTIONS") {
      const headers = corsHeaders(request);
      if (Object.keys(headers).length === 0) {
        response.writeHead(403).end();
        return;
      }
      response.writeHead(204, {
        ...headers,
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,x-coderadar-token",
        "access-control-max-age": "600",
      });
      response.end();
      return;
    }

    if (!hostIsLoopback(request)) {
      sendError(request, response, 403, "This API only answers on the local machine.");
      return;
    }
    const origin = request.headers.origin;
    if (typeof origin === "string" && !isAllowedOrigin(origin)) {
      sendError(request, response, 403, "This origin is not allowed to use the local review API.");
      return;
    }

    if (path === `${API_PREFIX}/health/live`) {
      sendJson(request, response, 200, { status: "ok" });
      return;
    }

    if (!path.startsWith(`${API_PREFIX}/`)) {
      sendError(request, response, 404, "Unknown endpoint.");
      return;
    }
    if (presentedToken(request, url) !== options.token) {
      sendError(request, response, 401, "The local review API rejected this request.");
      return;
    }

    const suffix = path.slice(API_PREFIX.length);

    if (suffix === "/sessions" && method === "GET") {
      const list = [...sessions.values()].map((record) => detailFor(record).session);
      sendJson(request, response, 200, list);
      return;
    }
    if (suffix === "/sessions" && method === "DELETE") {
      sessions.clear();
      response.writeHead(204, corsHeaders(request)).end();
      return;
    }
    if (suffix.startsWith("/sessions/") && method === "DELETE") {
      sessions.delete(suffix.slice("/sessions/".length));
      response.writeHead(204, corsHeaders(request)).end();
      return;
    }
    if (suffix === "/sessions/repo-intelligence-summary" && method === "GET") {
      sendJson(request, response, 200, repoIntelligenceSummary());
      return;
    }
    if (suffix === "/sessions/repo-hotspots" && method === "GET") {
      sendJson(request, response, 200, { items: repoHotspots() });
      return;
    }

    if (suffix === "/scans" && method === "POST") {
      await handleScanStart(request, response);
      return;
    }
    if (suffix.startsWith("/scans/") && method === "GET") {
      const rest = suffix.slice("/scans/".length);
      const [id, sub] = rest.split("/");
      const record = id === undefined ? undefined : sessions.get(id);
      if (record === undefined) {
        sendError(request, response, 404, "That review session does not exist.");
        return;
      }
      if (sub === "events") {
        streamEvents(request, response, record);
        return;
      }
      sendJson(request, response, 200, detailFor(record));
      return;
    }

    if (suffix === "/settings/runtime" && method === "GET") {
      void options.service
        .settings()
        .then((settings) => sendJson(request, response, 200, settingsPayload(settings)))
        .catch((error: unknown) => sendError(request, response, 500, messageOf(error)));
      return;
    }
    if (suffix === "/settings/runtime" && method === "PATCH") {
      void readJsonBody(request).then((body) => handleSettingsPatch(request, response, body), (error: unknown) => {
        sendError(request, response, 400, messageOf(error));
      });
      return;
    }
    if (suffix === "/settings/providers" && method === "GET") {
      sendJson(
        request,
        response,
        200,
        options.service.providers().map((provider) => ({
          id: provider.id,
          name: provider.name,
          default_base_url: provider.defaultBaseUrl,
          docs_url: provider.docsUrl,
        })),
      );
      return;
    }
    if (suffix === "/settings/providers/test" && method === "POST") {
      void readJsonBody(request).then(
        (body) => {
          void options.service
            .testProvider(toProviderOverrides(body))
            .then((result) => sendJson(request, response, 200, { ok: result.ok, message: result.message, latency_ms: result.latencyMs }))
            .catch((error: unknown) => sendError(request, response, 400, messageOf(error)));
        },
        (error: unknown) => sendError(request, response, 400, messageOf(error)),
      );
      return;
    }
    if (suffix === "/settings/providers/models" && method === "POST") {
      void readJsonBody(request).then(
        (body) => {
          void options.service
            .listModels(toProviderOverrides(body))
            .then((models) =>
              sendJson(request, response, 200, {
                models: models.map((model) => ({ id: model.id, name: model.id, created: model.createdAt })),
              }),
            )
            .catch((error: unknown) => sendError(request, response, 400, messageOf(error)));
        },
        (error: unknown) => sendError(request, response, 400, messageOf(error)),
      );
      return;
    }

    if (suffix === "/remediation/explain" && method === "POST") {
      await handleExplain(request, response);
      return;
    }

    sendError(request, response, 404, "Unknown endpoint.");
  }

  /**
   * The engine has no exploit simulator, and this route is the one place the UI
   * asks for an attack narrative. The answer is assembled from the finding's own
   * verified evidence, so it explains the defect that was actually found instead
   * of inventing a scenario the engine never reasoned about.
   */
  async function handleExplain(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendError(request, response, 400, messageOf(error));
      return;
    }

    const payload = isRecord(body) ? body : {};
    const sessionId = asString(payload["session_id"]);
    const findingId = asString(payload["finding_id"]);
    const record = sessionId === null ? undefined : sessions.get(sessionId);
    const finding = findingId === null ? undefined : record?.report?.findings.find((entry) => entry.id === findingId);

    if (record === undefined || finding === undefined) {
      sendError(request, response, 404, "That finding is not part of a review that is still in this session.");
      return;
    }

    const { file, line, lineEnd } = finding.location;
    sendJson(request, response, 200, {
      finding_id: finding.id,
      summary: finding.problem,
      exploit_scenario: finding.why,
      request_example: "",
      payload_example: "",
      attack_steps: [finding.evidence],
      entry_point: `${file}:${lineEnd > line ? `${line}-${lineEnd}` : `${line}`}`,
      execution_path: finding.why,
      sink: finding.axis,
      impact: finding.impact,
    });
  }

  /** Aggregates across the sessions of this run, which is all that is persisted. */
  function completedSessions(): SessionRecord[] {
    return [...sessions.values()].filter((record) => record.report !== null);
  }

  function repoIntelligenceSummary(): Record<string, unknown> {
    const completed = completedSessions();
    const topRepositories: Record<string, number> = {};
    let hotspotCount = 0;

    for (const record of completed) {
      const name = record.sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? record.sourcePath;
      topRepositories[name] = (topRepositories[name] ?? 0) + (record.report?.findings.length ?? 0);
      hotspotCount += record.report?.repositoryIndex.hotspots.length ?? 0;
    }

    const busiest = Object.entries(topRepositories).sort((left, right) => right[1] - left[1])[0];
    return {
      session_count: completed.length,
      hotspot_count: hotspotCount,
      critical_hotspots: completed.reduce(
        (total, record) => total + (record.report?.findings.filter((finding) => finding.severity === "critical").length ?? 0),
        0,
      ),
      identity_zones: 0,
      exposure_zones: 0,
      data_zones: 0,
      coverage_zones: 0,
      top_hotspot_label: busiest === undefined ? "" : `${busiest[0]} (${busiest[1]})`,
      top_repositories: topRepositories,
    };
  }

  function repoHotspots(): Array<Record<string, unknown>> {
    const items: Array<Record<string, unknown>> = [];
    for (const record of completedSessions()) {
      const name = record.sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? record.sourcePath;
      for (const hotspot of record.report?.repositoryIndex.hotspots.slice(0, 5) ?? []) {
        items.push({
          session_id: record.id,
          repo: name,
          hotspot_class: hotspot.reasons[0] ?? "attention",
          priority: hotspot.score >= 8 ? "high" : hotspot.score >= 4 ? "medium" : "low",
          label: `${hotspot.file} (${hotspot.score})`,
        });
      }
    }
    return items;
  }

  function settingsPayload(settings: Awaited<ReturnType<ReviewService["settings"]>>): Record<string, unknown> {
    return {
      default_preset: settings.desktop.defaultPreset,
      default_scan_mode: settings.desktop.defaultScanMode,
      auto_open_results: settings.desktop.autoOpenResults,
      remember_sidebar_state: settings.desktop.rememberSidebarState,
      motion_profile: settings.desktop.motionProfile,
      theme: settings.desktop.theme,
      surface_contrast: settings.desktop.surfaceContrast,
      remediation_max_attempts: settings.desktop.remediationMaxAttempts,
      remediation_reuse_explanation: settings.desktop.remediationReuseExplanation,
      ai_provider: settings.provider.id,
      ai_model: settings.provider.model === "" ? null : settings.provider.model,
      ai_base_url: settings.provider.baseUrl === "" ? null : settings.provider.baseUrl,
      // A hint, never the key. The key stays in the main process.
      ai_api_key_masked: settings.provider.apiKeyHint === null ? null : `••••${settings.provider.apiKeyHint}`,
      ai_has_key: settings.provider.hasApiKey,
      updated_at: new Date().toISOString(),
    };
  }

  const server: Server = createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      if (error instanceof SourceWindowError) {
        sendError(request, response, 400, error.message);
        return;
      }
      sendError(request, response, 500, messageOf(error));
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The local review API did not report a port."));
        return;
      }
      resolve(address.port);
    });
  });

  return {
    port,
    origin: `http://${host}:${port}`,
    token: options.token,
    close: () =>
      new Promise<void>((resolve) => {
        for (const record of sessions.values()) record.subscribers.clear();
        server.close(() => resolve());
      }),
  };
}