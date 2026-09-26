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
import { startReviewApiServer, type ReviewApiServer } from "../src/node/api/server.ts";
import { createReviewService, ReviewCancelledError, type ReviewService } from "../src/node/service.ts";
import { createSettingsStore } from "../src/node/settings.ts";
import type { GitPort } from "../src/core/ports.ts";
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
async function awaitCompletion(id: string, origin: string = server.origin): Promise<WireScanDetail> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/v1/scans/${id}`, { headers: { "x-coderadar-token": TOKEN } });
    const detail = (await response.json()) as WireScanDetail;
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
    expect((await fetch(url("/scans/does-not-exist/report"))).status).toBe(401);
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

  it("applies the preset's finding budget to the review", async () => {
    const run = async (preset: "safe" | "balanced" | "aggressive") => {
      const started = await authorized("/scans", {
        method: "POST",
        body: JSON.stringify({ source_path: BUGGY_FIXTURE, target_type: "folder", preset, scan_mode: "deep" }),
      });
      expect(started.status).toBe(200);
      const detail = (await started.json()) as WireScanDetail;
      return awaitCompletion(detail.session.id);
    };

    // The fixture holds ten defect findings. The preset is the user's choice of
    // how wide a net the run casts, so it has to change the result, not just the
    // label on the screen.
    const safe = await run("safe");
    const aggressive = await run("aggressive");

    expect(safe.findings.length).toBe(8);
    expect(aggressive.findings.length).toBe(10);
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

  it("serves the finished review as a page a person can open and share", async () => {
    const sessions = (await (await authorized("/sessions")).json()) as WireSession[];
    const finished = sessions.find((session) => session.findings_count === 10);
    if (finished === undefined) throw new Error("expected a completed session");

    const response = await authorized(`/scans/${finished.id}/report`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    // The page is the same report, and it is a document rather than a script:
    // nothing the reviewed code put in a title or a quote can run here.
    expect(html).toContain("CodeRadar review report");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("<script");
  });

  it("refuses a report for a session that does not exist", async () => {
    expect((await authorized("/scans/gone/report")).status).toBe(404);
  });

  it("accepts the report's token in the query string, which is how a page presents it", async () => {
    // A window opened on a page cannot send a header, so the address the renderer
    // builds carries the token in the query. This pins that address against the
    // server it has to reach.
    const sessions = (await (await authorized("/sessions")).json()) as WireSession[];
    const finished = sessions.find((session) => session.findings_count === 10);
    if (finished === undefined) throw new Error("expected a completed session");

    const response = await fetch(`${url(`/scans/${finished.id}/report`)}?token=${TOKEN}`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("CodeRadar review report");
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

describe("the local review API review lifecycle", () => {
  function start(preset = "balanced", scanMode = "deep"): Promise<Response> {
    return authorized("/scans", {
      method: "POST",
      body: JSON.stringify({ source_path: BUGGY_FIXTURE, target_type: "folder", preset, scan_mode: scanMode }),
    });
  }

  it("refuses a second review while one is in flight", async () => {
    const first = await start();
    expect(first.status).toBe(200);
    const detail = (await first.json()) as WireScanDetail;

    const second = await start();
    expect(second.status).toBe(409);

    // Let the first finish so the next test starts from a released lock.
    await awaitCompletion(detail.session.id);
  });

  it("accepts a second review as soon as the first one has completed", async () => {
    const first = await start();
    expect(first.status).toBe(200);
    const firstDetail = (await first.json()) as WireScanDetail;
    const firstFinished = await awaitCompletion(firstDetail.session.id);
    expect(firstFinished.session.status).toBe("completed");

    // The results screen is on screen at this point for a real user, and running
    // another review from it is the ordinary next action. A lock that outlives the
    // review would refuse exactly that.
    const second = await start();
    expect(second.status).toBe(200);
    const secondDetail = (await second.json()) as WireScanDetail;
    expect(secondDetail.session.id).not.toBe(firstDetail.session.id);

    const secondFinished = await awaitCompletion(secondDetail.session.id);
    expect(secondFinished.session.status).toBe("completed");
    expect(secondFinished.error_message).toBeNull();
    expect(secondFinished.findings.length).toBe(firstFinished.findings.length);
  });

  it("releases the lock before the finished state reaches the results screen", async () => {
    const first = await start();
    expect(first.status).toBe(200);
    const firstDetail = (await first.json()) as WireScanDetail;

    // The progress screen is driven by this stream, and the results screen only
    // opens after the terminal frame arrives. So the end of this stream is the
    // exact moment a user can reach for Review again, and the lock has to be long
    // gone by then — not merely gone by the time some later poll notices.
    const stream = await authorized(`/scans/${firstDetail.session.id}/events`);
    const frames = await stream.text();
    expect(frames).toContain("event: scan_completed");

    const second = await start();
    expect(second.status).toBe(200);
    const secondDetail = (await second.json()) as WireScanDetail;
    expect(secondDetail.session.id).not.toBe(firstDetail.session.id);
    expect((await awaitCompletion(secondDetail.session.id)).session.status).toBe("completed");
  });

  it("does not strand the running lock when a review fails before it starts", async () => {
    // Settings is read before the engine exists, which makes a failing read the
    // one error that happens while the review is already claimed. If the lock
    // outlived it, the failure the user sees once would become every review being
    // refused with 409 for the lifetime of the engine, with nothing running.
    const root = await mkdtemp(path.join(os.tmpdir(), "coderadar-lifecycle-"));
    const settingsStore = createSettingsStore({ filePath: path.join(root, "settings.json") });
    let readFails = true;
    const service = createReviewService({
      promptsDir: PROMPTS_DIR,
      settingsStore: {
        ...settingsStore,
        read: async () => {
          if (readFails) throw new Error("the settings file could not be read");
          return settingsStore.read();
        },
      },
    });
    const local = await startReviewApiServer({ service, token: TOKEN, port: 0 });
    const post = (): Promise<Response> =>
      fetch(`${local.origin}/api/v1/scans`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-coderadar-token": TOKEN },
        body: JSON.stringify({ source_path: BUGGY_FIXTURE, target_type: "folder", preset: "balanced", scan_mode: "deep" }),
      });

    try {
      const failed = await post();
      expect(failed.status).toBe(200);
      const failedDetail = (await failed.json()) as WireScanDetail;

      // The failure is reported as a failed session, so the screen can say why.
      const settled = await awaitCompletion(failedDetail.session.id, local.origin);
      expect(settled.session.status).toBe("failed");
      expect(settled.error_message).toContain("could not be read");

      readFails = false;
      const retried = await post();
      expect(retried.status).toBe(200);
      const retriedDetail = (await retried.json()) as WireScanDetail;
      const retriedFinished = await awaitCompletion(retriedDetail.session.id, local.origin);
      expect(retriedFinished.session.status).toBe("completed");
      expect(retriedFinished.findings.length).toBe(10);
    } finally {
      await local.close();
      await rm(root, { recursive: true, force: true });
    }
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

describe("the local review API scope controls", () => {
  const DIFF_FIXTURE = path.join(import.meta.dir, "fixtures", "diff-target");

  /** The loop bound was altered on new line 5; the sort defect is unchanged. */
  const DIFF_TEXT = [
    "diff --git a/src/paging.ts b/src/paging.ts",
    "--- a/src/paging.ts",
    "+++ b/src/paging.ts",
    "@@ -3,5 +3,5 @@",
    " export function sumScores(scores: number[]): number {",
    "   let total = 0;",
    "-  for (let index = 0; index < scores.length; index += 1) {",
    "+  for (let index = 0; index <= scores.length; index += 1) {",
    "     total += scores[index];",
    "   }",
    "",
  ].join("\n");

  let scopeServer: ReviewApiServer;
  let scopeRoot: string;

  beforeAll(async () => {
    scopeRoot = await mkdtemp(path.join(os.tmpdir(), "coderadar-scope-"));
    // A stub repository keeps this test about the mode the caller asked for,
    // rather than about whatever the checkout this suite runs in happens to
    // contain. The fixture holds one defect on the changed line and one elsewhere.
    const git: GitPort = {
      detectRepository: async () => ({ root: DIFF_FIXTURE, branch: "feature/paging" }),
      resolveBaseBranch: async () => "main",
      diff: async () => DIFF_TEXT,
      changedFiles: async () => ["src/paging.ts"],
    };
    const service = createReviewService({
      settingsStore: createSettingsStore({ filePath: path.join(scopeRoot, "settings.json") }),
      promptsDir: PROMPTS_DIR,
      git,
    });

    scopeServer = await startReviewApiServer({ service, token: TOKEN, port: 0 });
  });

  afterAll(async () => {
    await scopeServer.close();
    await rm(scopeRoot, { recursive: true, force: true });
  });

  async function runWith(scanMode: "fast" | "deep"): Promise<WireScanDetail> {
    const started = await fetch(`${scopeServer.origin}/api/v1/scans`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-coderadar-token": TOKEN },
      body: JSON.stringify({ source_path: DIFF_FIXTURE, target_type: "folder", preset: "balanced", scan_mode: scanMode }),
    });
    expect(started.status).toBe(200);

    const detail = (await started.json()) as WireScanDetail;
    return awaitCompletion(detail.session.id, scopeServer.origin);
  }

  it("scopes a fast review to the diff and a deep review to the whole target", async () => {
    const deep = await runWith("deep");
    const fast = await runWith("fast");

    // Deep is not a diff review, so both defects in the fixture are reported and
    // nothing is anchored to a changed line.
    expect(deep.findings.length).toBe(2);
    expect(deep.findings.every((finding) => finding.file.endsWith("paging.ts"))).toBe(true);
    const deepLimitations = deep.session.analysis_brief?.analysis_limitations ?? [];
    expect(deepLimitations.some((line: string) => line.includes("anchored to lines changed"))).toBe(false);

    // Fast reviews what changed: the defect on the changed line survives, the
    // unchanged one does not, and the review says so instead of looking complete.
    expect(fast.findings.length).toBe(1);
    expect(fast.findings[0]?.line).toBe(5);
    expect(fast.session.candidate_findings_count).toBeGreaterThanOrEqual(1);
    const fastLimitations = fast.session.analysis_brief?.analysis_limitations ?? [];
    expect(fastLimitations.some((line: string) => line.includes("anchored to lines changed against main"))).toBe(true);
  });

  it("carries the candidates the review bar dropped, with the reason behind each one", async () => {
    const fast = await runWith("fast");

    // A fast review drops the defect on the unchanged line at validation, so the
    // response has to say which candidate went and why. Without this a reviewer
    // sees a count and cannot tell a missed defect from a refused claim.
    const dropped = fast.rejected_candidates;
    expect(dropped.length).toBeGreaterThanOrEqual(1);
    // The count on the session and the list are the same set, or the screen would
    // show a number that no row explains.
    expect(fast.session.candidate_findings_count).toBe(dropped.length);

    const outsideChange = dropped.find((candidate) => candidate.reason === "anchor-outside-changed-lines");
    expect(outsideChange).toBeDefined();
    expect(outsideChange?.file.endsWith("paging.ts")).toBe(true);
    expect(outsideChange?.title.length).toBeGreaterThan(0);
    expect(outsideChange?.detail.length).toBeGreaterThan(0);
    expect(outsideChange?.line_end).toBeGreaterThanOrEqual(outsideChange?.line ?? 0);

    // The breakdown is the engine's own tally, not a second computation.
    expect(fast.rejections_by_reason["anchor-outside-changed-lines"]).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Deleting a session has to release the engine.
 *
 * A review holds the engine's single review slot until it finishes, and both the
 * progress screen's "Stop review" and the sidebar's delete remove the session. If
 * removing it did not also stop its review, the slot stayed taken for the rest of
 * the process: every later start was refused with 409 while the app told the user
 * the review had stopped. The service here is a stub on purpose — a real review of
 * a fixture finishes in milliseconds, which is exactly why this survived.
 */
describe("deleting a session stops the review it started", () => {
  const unused = (): never => {
    throw new Error("the stub service does not implement this method");
  };

  /** A service whose review never answers on its own, so only cancellation ends it. */
  function stubService(): { service: ReviewService; cancels: () => number } {
    let controller: AbortController | null = null;
    let running = false;
    let cancels = 0;

    const service: ReviewService = {
      providers: unused,
      settings: unused,
      updateSettings: unused,
      listModels: unused,
      testProvider: unused,
      readSource: unused,
      isRunning: () => running,
      cancelReview: async () => {
        cancels += 1;
        controller?.abort();
      },
      startReview: async () => {
        controller = new AbortController();
        running = true;
        try {
          await new Promise<never>((_resolve, reject) => {
            controller?.signal.addEventListener("abort", () => reject(new ReviewCancelledError()), { once: true });
          });
          throw new ReviewCancelledError();
        } finally {
          running = false;
          controller = null;
        }
      },
    };

    return { service, cancels: () => cancels };
  }

  function startAt(origin: string): Promise<Response> {
    return fetch(`${origin}/api/v1/scans`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-coderadar-token": TOKEN },
      body: JSON.stringify({ source_path: BUGGY_FIXTURE, target_type: "folder", preset: "balanced", scan_mode: "deep" }),
    });
  }

  function deleteAt(origin: string, id: string): Promise<Response> {
    return fetch(`${origin}/api/v1/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "x-coderadar-token": TOKEN },
    });
  }

  it("frees the slot for the next review, and signals nothing for an unknown session", async () => {
    const { service, cancels } = stubService();
    const stubServer = await startReviewApiServer({ service, token: TOKEN, port: 0 });
    const origin = stubServer.origin;

    try {
      const started = await startAt(origin);
      expect(started.status).toBe(200);
      const live = (await started.json()) as WireScanDetail;

      // One review at a time is what the user runs into, and it is the state this
      // test has to get out of.
      expect((await startAt(origin)).status).toBe(409);

      expect((await deleteAt(origin, live.session.id)).status).toBe(204);
      expect(cancels()).toBe(1);

      // The cancelled run settles in a microtask; the slot is free after it.
      await Bun.sleep(50);
      expect((await startAt(origin)).status).toBe(200);

      // Deleting an id that names no session must not abort the review that is
      // running: the cancel above is the only one so far.
      expect((await deleteAt(origin, "no-such-session")).status).toBe(204);
      expect(cancels()).toBe(1);
    } finally {
      await stubServer.close();
    }
  });
});
