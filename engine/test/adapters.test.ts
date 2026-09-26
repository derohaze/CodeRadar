import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeFileSystem } from "../src/adapters/node-fs.ts";
import { createNodeGit, isSafeRef } from "../src/adapters/node-git.ts";
import { AiReviewerError, redactSecrets } from "../src/core/review/ai-reviewer.ts";
import { createHttpAiReviewer } from "../src/clients/http-ai-reviewer.ts";
import type { HttpAiReviewerOptions } from "../src/clients/http-ai-reviewer.ts";
import { discoverRepository, isIgnoredPath, isReviewableContent } from "../src/core/repository/discover.ts";
import { detectTooling } from "../src/core/repository/tooling.ts";
import { detectProjectProfile, looksGenerated } from "../src/core/languages/detect.ts";

const fs = createNodeFileSystem();

describe("node filesystem adapter", () => {
  it("joins, resolves, and reports relative paths in POSIX form", () => {
    expect(fs.join("a", "b", "c")).toBe(path.join("a", "b", "c"));
    expect(fs.basename("/tmp/x/app.ts")).toBe("app.ts");
    expect(fs.directoryName("/tmp/x/app.ts")).toBe(path.dirname("/tmp/x/app.ts"));
  });

  it("strips a UTF-8 BOM so line one is still line one", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "coderadar-fs-"));
    try {
      const file = path.join(root, "bom.ts");
      await writeFile(file, "\uFEFFexport const a = 1;\n");
      expect(await fs.readTextFile(file)).toBe("export const a = 1;\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a missing path as absent rather than throwing", async () => {
    expect(await fs.exists("/definitely/not/here/xyz")).toBe(false);
  });
});

describe("isIgnoredPath", () => {
  it("excludes dependency and build directories", () => {
    expect(isIgnoredPath("node_modules/pkg/index.js")).toBe(true);
    expect(isIgnoredPath("dist/bundle.js")).toBe(true);
    expect(isIgnoredPath("frontend/node_modules/x/y.ts")).toBe(true);
  });

  it("excludes credential files by name before they are ever read", () => {
    expect(isIgnoredPath(".env")).toBe(true);
    expect(isIgnoredPath(".env.production")).toBe(true);
    expect(isIgnoredPath("deploy/cert.pem")).toBe(true);
    expect(isIgnoredPath("config/service-account.json")).toBe(true);
  });

  it("excludes lockfiles, binaries, and minified output", () => {
    expect(isIgnoredPath("bun.lock")).toBe(true);
    expect(isIgnoredPath("assets/logo.png")).toBe(true);
    expect(isIgnoredPath("vendor/app.min.js")).toBe(true);
  });

  it("keeps source and the CI configuration that carries behaviour", () => {
    expect(isIgnoredPath("src/app.ts")).toBe(false);
    expect(isIgnoredPath(".github/workflows/ci.yml")).toBe(false);
  });
});

describe("discoverRepository", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "coderadar-discovery-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(root, "src", "app.ts"), "export const value = 1;\n");
    await writeFile(path.join(root, "src", "notes.md"), "# notes\n");
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "export const leaked = 1;\n");
    await writeFile(path.join(root, ".env"), "API_KEY=sk-test-0000000000000000\n");
    await writeFile(path.join(root, "bun.lock"), "{}\n");
    await writeFile(path.join(root, "logo.png"), "\u0000binary");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns only reviewable source, ordered deterministically", async () => {
    const result = await discoverRepository(root, fs);

    expect(result.files.map((file) => file.path)).toEqual(["src/app.ts", "src/notes.md"]);
    expect(result.truncated).toBe(false);
  });

  it("counts what it skipped rather than silently dropping it", async () => {
    const result = await discoverRepository(root, fs);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it("never surfaces a credential file, even though it exists on disk", async () => {
    const result = await discoverRepository(root, fs);
    const paths = result.files.map((file) => file.path);

    expect(paths).not.toContain(".env");
    // Proof the file is really there, so the exclusion is what removed it.
    expect(await fs.exists(path.join(root, ".env"))).toBe(true);
  });

  it("stops at the file limit and says so", async () => {
    const result = await discoverRepository(root, fs, { limits: { maxFiles: 1 } });

    expect(result.files).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});

describe("isReviewableContent", () => {
  it("rejects binary content", () => {
    expect(isReviewableContent("src/a.ts", "const a = 1;\u0000")).toBe(false);
  });

  it("rejects generated bundles", () => {
    expect(isReviewableContent("src/a.ts", `const x = "${"y".repeat(3000)}";`)).toBe(false);
    expect(looksGenerated("// Code generated by tool. DO NOT EDIT.\nconst a = 1;")).toBe(true);
  });

  it("rejects an empty file, which has nothing to anchor a finding to", () => {
    expect(isReviewableContent("src/a.ts", "\n\n   \n")).toBe(false);
  });

  it("accepts ordinary source", () => {
    expect(isReviewableContent("src/a.ts", "export const a = 1;\n")).toBe(true);
  });
});

describe("detectTooling", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "coderadar-tooling-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("detects a standalone ESLint configuration", async () => {
    await writeFile(path.join(root, ".eslintrc.json"), "{}");
    const profile = await detectTooling(fs, root);

    expect(profile.lintedFamilies).toContain("js");
    expect(profile.linterConfigs).toContain(".eslintrc.json");
  });

  it("detects ESLint declared inside package.json", async () => {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ devDependencies: { eslint: "^9.0.0" } }));
    const profile = await detectTooling(fs, root);

    expect(profile.lintedFamilies).toContain("js");
  });

  it("does not treat a bare pyproject.toml as a Python linter", async () => {
    await writeFile(path.join(root, "pyproject.toml"), "[project]\nname = \"x\"\n");
    const profile = await detectTooling(fs, root);

    expect(profile.lintedFamilies).not.toContain("python");
  });

  it("detects a tool section inside pyproject.toml", async () => {
    await writeFile(path.join(root, "pyproject.toml"), "[tool.ruff]\nline-length = 100\n");
    const profile = await detectTooling(fs, root);

    expect(profile.lintedFamilies).toContain("python");
  });

  it("reports nothing when the repository configures nothing", async () => {
    const profile = await detectTooling(fs, root);

    expect(profile.lintedFamilies).toEqual([]);
    expect(profile.linterConfigs).toEqual([]);
  });

  it("finds a linter configured at the repository root of a larger project", async () => {
    // Probing the base directory directly is what makes this work when a review
    // is scoped to a subdirectory, which the discovered file list cannot answer.
    await writeFile(path.join(root, "eslint.config.js"), "export default [];\n");
    const profile = await detectTooling(fs, root);

    expect(profile.lintedFamilies).toContain("js");
    expect(profile.linterConfigs).toContain("eslint.config.js");
  });
});

describe("detectProjectProfile", () => {
  it("names the primary kind and the package manager from manifests and lockfiles", () => {
    const profile = detectProjectProfile([
      "package.json",
      "bun.lock",
      "src/app.ts",
      "src/util.ts",
      "scripts/build.ts",
    ]);

    expect(profile.kind).toBe("node");
    expect(profile.packageManager).toBe("bun");
    expect(profile.languages[0]).toBe("typescript");
  });

  it("prefers the Node toolchain when several manifests exist", () => {
    const profile = detectProjectProfile(["pyproject.toml", "package.json"]);
    expect(profile.kind).toBe("node");
  });

  it("keeps the language mix even when no manifest names a project kind", () => {
    // The kind comes from manifests only, so a repository with no manifest is
    // `unknown` on purpose. The language mix is answered separately, which is
    // what lets the review still pick the right detectors.
    const profile = detectProjectProfile(["src/main.rs", "src/lib.rs"]);

    expect(profile.kind).toBe("unknown");
    expect(profile.manifest).toBeNull();
    expect(profile.languages[0]).toBe("rust");
  });
});

describe("node git adapter", () => {
  it("accepts ordinary refs", () => {
    expect(isSafeRef("main")).toBe(true);
    expect(isSafeRef("origin/main")).toBe(true);
    expect(isSafeRef("feature/session-expiry")).toBe(true);
  });

  it("refuses refs that git would read as options", () => {
    // A leading dash turns a branch name into a way to pass arbitrary flags.
    expect(isSafeRef("--upload-pack=touch /tmp/pwned")).toBe(false);
    expect(isSafeRef("-c")).toBe(false);
    expect(isSafeRef("main; rm -rf /")).toBe(false);
    expect(isSafeRef("main..evil")).toBe(false);
    expect(isSafeRef("main.lock")).toBe(false);
    expect(isSafeRef("")).toBe(false);
  });

  it("detects the repository it is running inside", async () => {
    const git = createNodeGit();
    const repository = await git.detectRepository(process.cwd());

    expect(repository).not.toBeNull();
    expect(repository?.root.length ?? 0).toBeGreaterThan(0);
  });

  it("detects the repository for a file path, not only for a directory", async () => {
    // Reviewing one file is the common case, and a file is not a working
    // directory. Without this the repository goes undetected and a single-file
    // review silently loses its diff awareness.
    const git = createNodeGit();
    const fromDirectory = await git.detectRepository(process.cwd());
    if (fromDirectory === null) return; // No git checkout here; nothing to compare.

    const filePath = fileURLToPath(new URL("./fixtures/clean/src/session.ts", import.meta.url));
    const fromFile = await git.detectRepository(filePath);

    expect(fromFile).not.toBeNull();
    expect(fromFile?.root).toBe(fromDirectory.root);
  });

  it("refuses to diff against an unsafe ref instead of passing it to git", async () => {
    const git = createNodeGit();
    const repository = await git.detectRepository(process.cwd());
    if (repository === null) return;

    expect(await git.diff(repository.root, "--upload-pack=x")).toBe("");
    expect(await git.changedFiles(repository.root, "--upload-pack=x")).toEqual([]);
  });

  it("returns an empty diff rather than throwing when the base branch is unknown", async () => {
    const git = createNodeGit();
    const repository = await git.detectRepository(process.cwd());
    if (repository === null) return;

    expect(await git.diff(repository.root, "no-such-branch-xyz")).toBe("");
  });

  it("reports no repository for a directory outside any repository", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "coderadar-nogit-"));
    try {
      const git = createNodeGit({ timeoutMs: 10_000 });
      expect(await git.detectRepository(root)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("provider security", () => {
  it("refuses a non-HTTP endpoint", () => {
    expect(() =>
      createHttpAiReviewer({ endpoint: "file:///etc/passwd", apiKey: "k", model: "m" }),
    ).toThrow(AiReviewerError);
  });

  it("refuses an endpoint that embeds credentials", () => {
    expect(() =>
      createHttpAiReviewer({
        endpoint: "https://user:password@api.example.com/v1/chat/completions",
        apiKey: "k",
        model: "m",
      }),
    ).toThrow(AiReviewerError);
  });

  it("names the host but never the key", () => {
    const reviewer = createHttpAiReviewer({
      endpoint: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-super-secret-value",
      model: "m",
    });

    expect(reviewer.name).toBe("http:api.example.com");
    expect(reviewer.name).not.toContain("sk-super-secret-value");
  });

  it("redacts the key out of a provider error body", async () => {
    const original = globalThis.fetch;
    const key = "sk-super-secret-value";

    globalThis.fetch = (async () =>
      new Response(`{"error":{"message":"invalid api key ${key}"}}`, { status: 401 })) as unknown as typeof fetch;

    try {
      const reviewer = createHttpAiReviewer({
        endpoint: "https://api.example.com/v1/chat/completions",
        apiKey: key,
        model: "m",
      });

      await expect(reviewer.review({ systemPrompt: "s", userPrompt: "u", maxFindings: 1 })).rejects.toThrow(
        /\[redacted\]/,
      );

      try {
        await reviewer.review({ systemPrompt: "s", userPrompt: "u", maxFindings: 1 });
        throw new Error("expected the reviewer to reject");
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        expect(message).not.toContain(key);
        expect(message).toContain("401");
      }
    } finally {
      globalThis.fetch = original;
    }
  });

  it("redacts only long values, so short words are not mangled", () => {
    expect(redactSecrets("key=abcdef123456 done", ["abcdef123456"])).toBe("key=[redacted] done");
    expect(redactSecrets("a is a", ["a"])).toBe("a is a");
  });
});

describe("provider call telemetry", () => {
  const ENDPOINT = "https://api.example.com/v1/chat/completions";
  const KEY = "sk-super-secret-value";
  const REQUEST = { systemPrompt: "SYSTEM-PROMPT-MARKER", userPrompt: "USER-PROMPT-MARKER", maxFindings: 3 };

  /** An OpenAI-compatible envelope, with every field the telemetry reads. */
  const ENVELOPE = {
    id: "chatcmpl-123",
    model: "served-model-9",
    choices: [{ message: { content: '{"verdict":"approve","findings":[]}' }, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 },
  };

  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  function stubFetch(handler: () => Response): void {
    globalThis.fetch = (async () => handler()) as unknown as typeof fetch;
  }

  function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  }

  function reviewerWith(overrides: Partial<HttpAiReviewerOptions> = {}) {
    return createHttpAiReviewer({ endpoint: ENDPOINT, apiKey: KEY, model: "configured-model", ...overrides });
  }

  it("records what a successful call was, and nothing it was shown", async () => {
    stubFetch(() => jsonResponse(ENVELOPE, 200, { "x-request-id": "req-42" }));

    const execution = await reviewerWith().reviewWithTelemetry(REQUEST);

    expect(execution.status).toBe("response");
    if (execution.status !== "response") throw new Error("expected a response");

    const telemetry = execution.telemetry;
    expect(telemetry.provider).toBe("api.example.com");
    // What was asked for. What answered is a separate fact, kept per attempt.
    expect(telemetry.model).toBe("configured-model");
    expect(telemetry.attempts).toHaveLength(1);

    const attempt = telemetry.attempts[0];
    expect(attempt?.attempt).toBe(1);
    expect(attempt?.outcome).toBe("response");
    expect(attempt?.status).toBe(200);
    expect(attempt?.contentType).toContain("application/json");
    expect(attempt?.requestId).toBe("req-42");
    expect(attempt?.responseBytes).toBeGreaterThan(0);
    expect(attempt?.responseId).toBe("chatcmpl-123");
    expect(attempt?.responseModel).toBe("served-model-9");
    expect(attempt?.finishReason).toBe("stop");
    expect(attempt?.usage).toEqual({ promptTokens: 120, completionTokens: 8, totalTokens: 128 });
    expect(attempt?.latencyMs).toBeGreaterThanOrEqual(0);

    // The record has to be safe to keep next to a report: no key, no prompt, and
    // no response text. Counts and identifiers only.
    const serialised = JSON.stringify(telemetry);
    expect(serialised).not.toContain(KEY);
    expect(serialised).not.toContain("SYSTEM-PROMPT-MARKER");
    expect(serialised).not.toContain("USER-PROMPT-MARKER");
    expect(serialised).not.toContain("approve");
    expect(serialised).not.toContain("message");
  });

  it("keeps every attempt of a retried call, including the ones that failed", async () => {
    let call = 0;
    stubFetch(() => {
      call += 1;
      return call === 1 ? jsonResponse({ error: { message: "rate limited" } }, 429, { "retry-after": "0" }) : jsonResponse(ENVELOPE);
    });

    const retries: Array<{ attempt: number; status: number | null; delayMs: number }> = [];
    const reviewer = reviewerWith({
      maxAttempts: 3,
      retryDelayMs: 0,
      onRetry: (info) => retries.push(info),
    });

    const execution = await reviewer.reviewWithTelemetry(REQUEST);

    expect(execution.status).toBe("response");
    expect(retries).toEqual([{ attempt: 1, status: 429, delayMs: 0 }]);
    expect(execution.telemetry.attempts.map((attempt) => attempt.outcome)).toEqual(["http-error", "response"]);
    expect(execution.telemetry.attempts[0]?.status).toBe(429);
    // A failed attempt still has a size: "empty body" and "long error" differ.
    expect(execution.telemetry.attempts[0]?.responseBytes).toBeGreaterThan(0);
    expect(execution.telemetry.attempts[1]?.responseId).toBe("chatcmpl-123");
  });

  it("keeps the telemetry of a call that never produced a response", async () => {
    stubFetch(() =>
      new Response('{"error":{"message":"gateway is down"},"echo":"source-marker"}', {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const execution = await reviewerWith({ maxAttempts: 2, retryDelayMs: 0 }).reviewWithTelemetry(REQUEST);

    expect(execution.status).toBe("failure");
    if (execution.status !== "failure") throw new Error("expected a failure");

    expect(execution.telemetry.attempts.map((attempt) => [attempt.outcome, attempt.status])).toEqual([
      ["http-error", 503],
      ["http-error", 503],
    ]);
    // The diagnostic path carries no provider prose at all, so a body that echoes
    // the source cannot travel with the report.
    expect(execution.error.name).toBe("AttemptFailure");
    const failure = JSON.stringify(execution.error);
    expect(failure).not.toContain("gateway is down");
    expect(failure).not.toContain("source-marker");

    // The ordinary path is unchanged: a caller that did not ask for telemetry
    // still gets the provider's status and its redacted body in the message.
    await expect(reviewerWith({ maxAttempts: 2, retryDelayMs: 0 }).review(REQUEST)).rejects.toThrow(
      "provider returned 503",
    );
  });

  it("separates an unreadable body from a failed call", async () => {
    stubFetch(() => new Response("not json at all", { status: 200, headers: { "content-type": "text/plain" } }));

    const execution = await reviewerWith({ maxAttempts: 1 }).reviewWithTelemetry(REQUEST);

    expect(execution.status).toBe("failure");
    if (execution.status !== "failure") throw new Error("expected a failure");

    // A 200 with an unreadable body is not an HTTP failure: the provider answered.
    expect(execution.telemetry.attempts[0]?.outcome).toBe("invalid-json");
    expect(execution.telemetry.attempts[0]?.status).toBe(200);
    expect(execution.telemetry.attempts[0]?.responseBytes).toBe("not json at all".length);
    expect(execution.error.name).toBe("AiReviewerError");
  });

  it("separates a transport failure from an HTTP failure", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;

    const execution = await reviewerWith({ maxAttempts: 1 }).reviewWithTelemetry(REQUEST);

    expect(execution.status).toBe("failure");
    if (execution.status !== "failure") throw new Error("expected a failure");

    expect(execution.telemetry.attempts[0]?.outcome).toBe("transport-error");
    expect(execution.telemetry.attempts[0]?.status).toBeNull();
    expect(execution.telemetry.attempts[0]?.responseBytes).toBeNull();
    expect(execution.error.name).toBe("AttemptFailure");
  });

  it("reports a cancellation without inventing an attempt that never happened", async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return jsonResponse(ENVELOPE);
    });

    const execution = await reviewerWith({ signal: AbortSignal.abort() }).reviewWithTelemetry(REQUEST);

    expect(execution.status).toBe("failure");
    if (execution.status !== "failure") throw new Error("expected a failure");
    expect(calls).toBe(0);
    // Nothing was sent, so there is nothing to record: an empty attempt list and a
    // cancelled attempt are different facts about the same run.
    expect(execution.telemetry.attempts).toEqual([]);
    expect(execution.error.name).toBe("AiReviewerError");
  });

  it("stops retrying when the run is cancelled during the wait", async () => {
    const controller = new AbortController();
    stubFetch(() => jsonResponse({ error: { message: "rate limited" } }, 429, { "retry-after": "30" }));

    const execution = await reviewerWith({
      maxAttempts: 3,
      signal: controller.signal,
      onRetry: () => controller.abort(),
    }).reviewWithTelemetry(REQUEST);

    expect(execution.status).toBe("failure");
    if (execution.status !== "failure") throw new Error("expected a failure");
    // One attempt was made, and the record says so; the second never started.
    expect(execution.telemetry.attempts.map((attempt) => attempt.outcome)).toEqual(["http-error"]);
    expect(execution.error.name).toBe("AiReviewerError");
  });

  it("reports envelope metadata that is absent or the wrong type as absent", async () => {
    stubFetch(() => jsonResponse({ id: 42, model: null, choices: [{ message: { content: "{}" } }], usage: "tokens" }));

    const execution = await reviewerWith().reviewWithTelemetry(REQUEST);

    expect(execution.status).toBe("response");
    if (execution.status !== "response") throw new Error("expected a response");
    const attempt = execution.telemetry.attempts[0];
    expect(attempt?.responseId).toBeNull();
    expect(attempt?.responseModel).toBeNull();
    expect(attempt?.finishReason).toBeNull();
    expect(attempt?.usage).toBeNull();
    expect(attempt?.outcome).toBe("response");
  });
});
