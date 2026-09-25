/**
 * The local review API, exercised over HTTP against the buggy fixture.
 *
 * This is the test that proves the desktop review flow works with no Python and
 * no Rust: a request goes in over the same contract the renderer uses, the real
 * review engine runs over a real directory, and findings come back out in the
 * shape the screens read.
 *
 * The security envelope is tested here too, because it is the part of this
 * server whose absence is invisible until it is being exploited.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startReviewApiServer, type ReviewApiServer } from "../src/node/api-server.ts";
import { createReviewService } from "../src/node/service.ts";
import { createSettingsStore } from "../src/node/settings.ts";
import type { WireFinding, WireScanDetail, WireSession } from "../src/node/api-contract.ts";

const PROMPTS_DIR = path.join(import.meta.dir, "..", "prompts");
const BUGGY_FIXTURE = path.join(import.meta.dir, "fixtures", "buggy");
const TOKEN = "test-token-0123456789";

let server: ReviewApiServer;
let temporaryDirectory: string;

function url(pathname: string): string {
  return `${server.origin}/api/v1${pathname}`;
}

/** A request carrying the launch token, the way the renderer sends it. */
function authorized(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url(pathname), {
    ...init,
    headers: { "content-type": "application/json", "x-coderadar-token": TOKEN, ...(init.headers ?? {}) },
  });
}

/** Polls until the review reaches a terminal state, with a real deadline. */
async function awaitCompletion(id: string): Promise<WireScanDetail> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const detail = (await (await authorized(`/scans/${id}`)).json()) as WireScanDetail;
    if (detail.session.status === "completed" || detail.session.status === "failed") return detail;
    await Bun.sleep(50);
  }

  throw new Error("the review did not finish within the deadline");
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "coderadar-api-"));

  // No cipher is injected, which is the headless case: it must degrade to the
  // deterministic checks rather than fail, and must refuse to store a key.
  const settingsStore = createSettingsStore({ filePath: path.join(temporaryDirectory, "settings.json") });
  const service = createReviewService({ settingsStore, promptsDir: PROMPTS_DIR });

  server = await startReviewApiServer({ service, token: TOKEN, port: 0 });
});

afterAll(async () => {
  await server.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("the local review API security envelope", () => {
  it("answers the startup probe without a token", async () => {
    const response = await fetch(url("/health/live"));

    expect(response.status).toBe(200);
  });

  it("refuses every data route without the launch token", async () => {
    expect((await fetch(url("/sessions"))).status).toBe(401);
    expect((await fetch(url("/settings/runtime"))).status).toBe(401);
    expect((await fetch(url("/settings/providers"))).status).toBe(401);
    expect((await fetch(url("/scans/does-not-exist"))).status).toBe(401);
  });

  it("refuses a request that presents the wrong token", async () => {
    const response = await fetch(url("/sessions"), { headers: { "x-coderadar-token": "not-the-token" } });

    expect(response.status).toBe(401);
  });

  it("refuses a request from an origin that is not the app", async () => {
    const response = await fetch(url("/sessions"), {
      headers: { "x-coderadar-token": TOKEN, origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
  });

  it("accepts the packaged app's null origin", async () => {
    const response = await fetch(url("/sessions"), { headers: { "x-coderadar-token": TOKEN, origin: "null" } });

    expect(response.status).toBe(200);
  });

  it("never grants a wildcard origin", async () => {
    const response = await fetch(url("/sessions"), {
      headers: { "x-coderadar-token": TOKEN, origin: "http://localhost:8080" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:8080");
  });

  it("refuses a request whose Host is not loopback", async () => {
    // Rebinding reaches loopback under an attacker's hostname, so the Host
    // header is checked rather than assumed.
    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        { host: "127.0.0.1", port: server.port, path: "/api/v1/sessions", method: "GET", headers: { host: "evil.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on("error", reject);
      request.end();
    });

    expect(status).toBe(403);
  });
});

describe("the local review API review flow", () => {
  it("runs a review and returns findings in the renderer's contract", async () => {
    const started = await authorized("/scans", {
      method: "POST",
      body: JSON.stringify({ source_path: BUGGY_FIXTURE, target_type: "folder", preset: "balanced", scan_mode: "deep" }),
    });

    expect(started.status).toBe(200);
    const detail = (await started.json()) as WireScanDetail;
    expect(detail.session.status).toBe("scanning");

    const finished = await awaitCompletion(detail.session.id);
    expect(finished.session.status).toBe("completed");
    expect(finished.error_message).toBeNull();
    expect(finished.verdict).toBe("issues_found");

    // Every planted defect in the fixture has to survive the trip over HTTP.
    expect(finished.findings.length).toBe(10);

    for (const finding of finished.findings) {
      expect(finding.file.endsWith(".ts") || finding.file.endsWith(".py")).toBe(true);
      expect(finding.line).toBeGreaterThan(0);
      expect(finding.line_end).toBeGreaterThanOrEqual(finding.line);
      expect(finding.title.length).toBeGreaterThan(0);
      expect(finding.summary.length).toBeGreaterThan(0);
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.impact.length).toBeGreaterThan(0);
      expect(["critical", "high", "medium", "low"]).toContain(finding.severity);
      // The detail panel reads the "recommended" entry, so one must exist.
      expect(finding.fix_suggestions.some((suggestion) => suggestion.profile === "recommended")).toBe(true);
    }

    const counted = finished.issues.critical + finished.issues.high + finished.issues.medium + finished.issues.low;
    expect(counted).toBe(finished.findings.length);
  });

  it("carries the review's own coverage and repository facts", async () => {
    const sessions = (await (await authorized("/sessions")).json()) as WireSession[];
    const finished = sessions.find((session) => session.findings_count === 10);
    expect(finished).toBeDefined();
    if (finished === undefined) return;

    expect(finished.coverage_percent).toBeGreaterThan(0);
    expect(finished.coverage_percent).toBeLessThanOrEqual(100);
    expect(finished.reviewed_files_count).toBeGreaterThan(0);
    expect(finished.repository_inventory).not.toBeNull();
    expect(finished.graph_summary).not.toBeNull();
    expect(finished.analysis_brief).not.toBeNull();
    // The fixture tree is read, so the manifest names present show up here.
    expect(finished.target_type).toBe("folder");
  });

  it("does not invent a safety score the engine never computed", async () => {
    const sessions = (await (await authorized("/sessions")).json()) as WireSession[];

    for (const session of sessions) {
      expect(session.security_score).toBeNull();
    }
  });

  it("explains that the model did not run rather than reporting a silent gap", async () => {
    const sessions = (await (await authorized("/sessions")).json()) as WireSession[];
    const finished = sessions.find((session) => session.findings_count === 10);
    const limitations = finished?.analysis_brief?.analysis_limitations ?? [];

    expect(limitations.some((entry) => entry.includes("did not review this run"))).toBe(true);
  });

  it("hands a late subscriber the finished state instead of an empty stream", async () => {
    const sessions = (await (await authorized("/sessions")).json()) as WireSession[];
    const finished = sessions.find((session) => session.findings_count === 10);
    if (finished === undefined) throw new Error("expected a completed session");

    const response = await authorized(`/scans/${finished.id}/events`);
    const text = await response.text();

    expect(text).toContain("event: scan_completed");
    expect(text).toContain('"status":"completed"');
  });

  it("refuses a finding explanation for a session that no longer exists", async () => {
    const response = await authorized("/remediation/explain", {
      method: "POST",
      body: JSON.stringify({ session_id: "gone", finding_id: "gone" }),
    });

    expect(response.status).toBe(404);
  });

  it("explains a real finding from its own evidence", async () => {
    const sessions = (await (await authorized("/sessions")).json()) as WireSession[];
    const finished = sessions.find((session) => session.findings_count === 10);
    if (finished === undefined) throw new Error("expected a completed session");

    const detail = (await (await authorized(`/scans/${finished.id}`)).json()) as WireScanDetail;
    const finding: WireFinding | undefined = detail.findings[0];
    if (finding === undefined) throw new Error("expected a finding");

    const explained = await authorized("/remediation/explain", {
      method: "POST",
      body: JSON.stringify({ session_id: finished.id, finding_id: finding.id }),
    });

    expect(explained.status).toBe(200);
    const body = (await explained.json()) as Record<string, unknown>;
    expect(body["finding_id"]).toBe(finding.id);
    expect(String(body["summary"])).toBe(finding.summary);
    expect(String(body["entry_point"]).startsWith(finding.file)).toBe(true);
  });

  it("deletes a session and then reports it as gone", async () => {
    const sessions = (await (await authorized("/sessions")).json()) as WireSession[];
    const target = sessions[0];
    if (target === undefined) throw new Error("expected a session");

    expect((await authorized(`/sessions/${target.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await authorized(`/scans/${target.id}`)).status).toBe(404);
  });
});

describe("the local review API settings routes", () => {
  it("exposes the provider catalogue in the renderer's shape", async () => {
    const providers = (await (await authorized("/settings/providers")).json()) as Array<Record<string, unknown>>;

    expect(providers.length).toBeGreaterThan(0);
    expect(providers.map((provider) => provider["id"])).toContain("nvidia");
    for (const provider of providers) {
      expect(typeof provider["name"]).toBe("string");
      expect(provider).toHaveProperty("default_base_url");
      expect(provider).toHaveProperty("docs_url");
    }
  });

  it("reports that no key is stored without a secure key store", async () => {
    const settings = (await (await authorized("/settings/runtime")).json()) as Record<string, unknown>;

    expect(settings["ai_has_key"]).toBe(false);
    expect(settings["ai_api_key_masked"]).toBeNull();
    expect(typeof settings["ai_model"]).toBe("string");
  });

  it("refuses to persist an API key on a machine with no key store", async () => {
    const response = await authorized("/settings/runtime", {
      method: "PATCH",
      body: JSON.stringify({ ai_api_key: "sk-secret-value" }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { detail?: unknown };
    expect(String(body.detail)).toContain("no secure key store");
  });

  it("accepts a settings patch that does not carry a key", async () => {
    const response = await authorized("/settings/runtime", {
      method: "PATCH",
      body: JSON.stringify({ theme: "dark" }),
    });

    expect(response.status).toBe(200);
  });

  it("rejects a base URL that would leak the key in clear", async () => {
    const response = await authorized("/settings/runtime", {
      method: "PATCH",
      body: JSON.stringify({ ai_base_url: "http://evil.example/v1" }),
    });

    expect(response.status).toBe(400);
  });

  it("tests the provider named in the request, not the stored one", async () => {
    const response = await authorized("/settings/providers/test", {
      method: "POST",
      body: JSON.stringify({ provider: "anthropic" }),
    });
    const result = (await response.json()) as { ok: boolean; message: string };

    expect(response.status).toBe(200);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Anthropic");
  });

  it("tests the key the request carries before anything is saved", async () => {
    // The Settings screen asks for a key, tests it, and only then saves it, so a
    // test that could only see stored settings would answer "no key is saved"
    // while the user is looking at the key they just typed.
    const response = await authorized("/settings/providers/test", {
      method: "POST",
      body: JSON.stringify({
        provider: "nvidia",
        api_key: "typed-but-unsaved",
        base_url: "http://127.0.0.1:1/v1",
        model: "some-model",
      }),
    });
    const result = (await response.json()) as { ok: boolean; message: string };

    expect(response.status).toBe(200);
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("No API key");
    expect(result.message).toBe("The provider could not be reached.");
  });
});
