import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNodeFileSystem } from "../src/adapters/node-fs.ts";
import {
  REPLAY_DIRECTORY_ENV,
  createNodeReplayKey,
  createNodeReplayStore,
  resolveReplayDirectory,
} from "../src/adapters/node-replay.ts";
import type { ReviewReport } from "../src/core/findings/model.ts";
import type { AiReviewerPort } from "../src/core/ports.ts";
import { createHttpAiReviewer, createStaticAiReviewer } from "../src/core/review/ai-reviewer.ts";
import { ReviewEngine } from "../src/core/review/engine.ts";
import {
  ReplayMissError,
  createMemoryReplayStore,
  createRecordingReviewer,
  createReplayReviewer,
} from "../src/core/replay/replay.ts";

const PROMPTS_DIR = path.join(import.meta.dir, "..", "prompts");
const CLEAN = path.join(import.meta.dir, "fixtures", "clean");

/** The identity a recording is keyed under, shared by the record and replay runs. */
const REVIEWER = "http:example.test";
const MODEL = "test-model";

/**
 * A grounded answer about the clean fixture, taken from the validator's own
 * regression corpus: `src/session.ts` really does contain that comparison on
 * line 14, so the model finding survives validation.
 */
const GROUNDED = {
  verdict: "needs-attention",
  summary: "The expiry comparison is inverted",
  findings: [
    {
      severity: "high",
      axis: "correctness",
      title: "Expiry comparison treats a live session as expired",
      file: "src/session.ts",
      line: 14,
      line_end: 14,
      problem: "The comparison returns true for a session that has not expired yet.",
      why: "The timestamp is compared in the wrong direction, so the guard fires early.",
      impact: "Every session is rejected immediately after it is created.",
      evidence: "src/session.ts:14 | `  return session.expiresAt <= now;` | a live session is reported as expired",
      confidence: 82,
      fix: "Compare with >= instead.",
    },
  ],
};

function engineWith(reviewer: AiReviewerPort): ReviewEngine {
  return new ReviewEngine({ fs: createNodeFileSystem(), promptsDir: PROMPTS_DIR, aiReviewer: reviewer });
}

async function reviewWith(reviewer: AiReviewerPort): Promise<ReviewReport> {
  return engineWith(reviewer).review({ target: CLEAN });
}

describe("a recorded run replays to the same review", () => {
  it("produces identical candidates, findings, stats and evaluation from the recording", async () => {
    const store = createMemoryReplayStore();
    const recording = createRecordingReviewer({
      store,
      keyOf: createNodeReplayKey,
      reviewerName: REVIEWER,
      model: MODEL,
      inner: createStaticAiReviewer(GROUNDED, REVIEWER),
    });

    const liveReport = await reviewWith(recording);
    const replayedReport = await reviewWith(
      createReplayReviewer({ store, keyOf: createNodeReplayKey, reviewerName: REVIEWER, model: MODEL }),
    );

    // The same answer through the same parser, validator, policy and dedupe must
    // land on the same report, or the recording is not evidence of anything.
    expect(liveReport.findings.length).toBe(1);
    expect(replayedReport).toEqual(liveReport);
  });

  it("does not reuse a recording for a different request", async () => {
    const store = createMemoryReplayStore();
    const first = createRecordingReviewer({
      store,
      keyOf: createNodeReplayKey,
      reviewerName: REVIEWER,
      model: MODEL,
      inner: createStaticAiReviewer(GROUNDED, REVIEWER),
    });
    await reviewWith(first);

    // Same prompts, different model: a recording belongs to the model that made
    // it, so this must miss rather than answer with another model's output. The
    // engine turns the miss into a limitation, so the miss is visible as a
    // degraded review with no model finding rather than as a thrown error.
    const otherModel = createReplayReviewer({
      store,
      keyOf: createNodeReplayKey,
      reviewerName: REVIEWER,
      model: "another-model",
    });

    const report = await reviewWith(otherModel);

    expect(report.state).toBe("degraded");
    expect(report.findings.filter((entry) => entry.origin === "ai")).toEqual([]);
    expect(report.stats.aiReview?.unavailable).toBe(report.stats.aiReview?.attempted);
  });

  it("does not reuse a recording made with a different output cap", async () => {
    const store = createMemoryReplayStore();
    const recording = createRecordingReviewer({
      store,
      keyOf: createNodeReplayKey,
      reviewerName: REVIEWER,
      model: MODEL,
      maxOutputTokens: 4_096,
      inner: createStaticAiReviewer(GROUNDED, REVIEWER),
    });
    await reviewWith(recording);

    // The live case: a model cut off at a small output cap produced an unreadable
    // answer, and that answer must not replay as the answer to a request that asked
    // for more room — the recording is valid for the request that produced it.
    const wider = createReplayReviewer({
      store,
      keyOf: createNodeReplayKey,
      reviewerName: REVIEWER,
      model: MODEL,
      maxOutputTokens: 16_384,
    });
    const report = await reviewWith(wider);

    expect(report.findings.filter((entry) => entry.origin === "ai")).toEqual([]);
    expect(report.stats.aiReview?.unavailable).toBe(report.stats.aiReview?.attempted);
  });

  it("fails loudly when asked for a recording that does not exist", async () => {
    const replay = createReplayReviewer({
      store: createMemoryReplayStore(),
      keyOf: createNodeReplayKey,
      reviewerName: REVIEWER,
      model: MODEL,
    });

    await expect(replay.review({ systemPrompt: "system", userPrompt: "user", maxFindings: 15 })).rejects.toThrow(
      /no recorded model response/,
    );
  });

  it("turns a missing recording into a limitation, never into a clean review", async () => {
    // The failure this guards against: a benchmark that silently replays nothing
    // and reports zero findings, which reads exactly like clean code.
    const report = await reviewWith(
      createReplayReviewer({ store: createMemoryReplayStore(), keyOf: createNodeReplayKey, reviewerName: REVIEWER, model: MODEL }),
    );

    expect(report.state).toBe("degraded");
    expect(report.limitations.map((limitation) => limitation.code)).toContain("ai-provider-unavailable");
    expect(report.stats.aiReview?.unavailable).toBe(report.stats.aiReview?.attempted);
  });

  it("records nothing when the call failed", async () => {
    const store = createMemoryReplayStore();
    const failing: AiReviewerPort = {
      name: REVIEWER,
      review: async () => {
        throw new Error("provider returned 503");
      },
    };

    const recording = createRecordingReviewer({ store, keyOf: createNodeReplayKey, reviewerName: REVIEWER, model: MODEL, inner: failing });
    await reviewWith(recording);

    // Nothing to replay, because a failure is not an answer.
    const replay = createReplayReviewer({ store, keyOf: createNodeReplayKey, reviewerName: REVIEWER, model: MODEL });
    await expect(replay.review({ systemPrompt: "system", userPrompt: "user", maxFindings: 15 })).rejects.toBeInstanceOf(
      ReplayMissError,
    );
  });

  it("refuses to record under a name that could never be replayed", () => {
    expect(() =>
      createRecordingReviewer({
        store: createMemoryReplayStore(),
        keyOf: createNodeReplayKey,
        reviewerName: "a-different-name",
        model: MODEL,
        inner: createStaticAiReviewer(GROUNDED, REVIEWER),
      }),
    ).toThrow(/does not match the inner reviewer/);
  });
});

describe("a call recorded through the telemetry path replays with no network", () => {
  it("writes one recording per call, then answers offline and says no call was made", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "coderadar-replay-live-"));
    const store = createNodeReplayStore(directory);
    const original = globalThis.fetch;
    let calls = 0;

    try {
      globalThis.fetch = (async () => {
        calls += 1;
        return new Response(
          JSON.stringify({
            id: "chatcmpl-live",
            model: "served-live",
            choices: [{ message: { content: JSON.stringify(GROUNDED) }, finish_reason: "stop" }],
            usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const recording = createRecordingReviewer({
        store,
        keyOf: createNodeReplayKey,
        reviewerName: REVIEWER,
        model: MODEL,
        inner: createHttpAiReviewer({
          endpoint: "https://example.test/v1/chat/completions",
          apiKey: "sk-not-a-real-key",
          model: MODEL,
        }),
      });

      const live = await new ReviewEngine({
        fs: createNodeFileSystem(),
        promptsDir: PROMPTS_DIR,
        aiReviewer: recording,
        collectTrace: true,
      }).review({ target: CLEAN });

      // One file was sent per reviewed file, and the recorder wrote every answer.
      expect(calls).toBeGreaterThan(0);
      expect(await readdir(directory)).toHaveLength(calls);

      const liveSent = (live.trace ?? []).filter((entry) => entry.sentToModel);
      expect(liveSent.every((entry) => entry.provider === "example.test")).toBe(true);
      expect(liveSent.every((entry) => entry.response?.attempts[0]?.responseId === "chatcmpl-live")).toBe(true);
      expect(liveSent.every((entry) => entry.response?.attempts[0]?.usage?.totalTokens === 12)).toBe(true);

      calls = 0;
      const replayed = await new ReviewEngine({
        fs: createNodeFileSystem(),
        promptsDir: PROMPTS_DIR,
        aiReviewer: createReplayReviewer({ store, keyOf: createNodeReplayKey, reviewerName: REVIEWER, model: MODEL }),
        collectTrace: true,
      }).review({ target: CLEAN });

      // No provider was contacted, and the review is the same review.
      expect(calls).toBe(0);
      expect(replayed.findings).toEqual(live.findings);
      expect(replayed.rejected).toEqual(live.rejected);
      expect(replayed.stats).toEqual(live.stats);
      expect(replayed.state).toBe(live.state);
      expect(replayed.limitations).toEqual(live.limitations);

      // The call record is the one thing that cannot be deterministic, and it says
      // so instead of pretending: no attempt was made, so none is reported. What
      // the recording does carry — the model it was made under — is kept.
      const replayedSent = (replayed.trace ?? []).filter((entry) => entry.sentToModel);
      expect(replayedSent.every((entry) => entry.model === MODEL)).toBe(true);
      expect(replayedSent.every((entry) => entry.provider === null)).toBe(true);
      expect(replayedSent.every((entry) => entry.response?.attempts.length === 0)).toBe(true);
    } finally {
      globalThis.fetch = original;
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("the on-disk store", () => {
  it("round-trips a recording without putting the prompt in the file name", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "coderadar-replay-"));
    try {
      const store = createNodeReplayStore(directory);
      const key = createNodeReplayKey({
        reviewer: REVIEWER,
        model: MODEL,
        systemPrompt: "system prompt with a secret marker",
        userPrompt: "user prompt",
      });

      // A hash, not the prompt: the directory listing must not leak the code.
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain("secret");

      await store.write({ key, reviewer: REVIEWER, model: MODEL, response: { findings: [] }, recordedAt: "2026-01-01T00:00:00.000Z" });
      const read = await store.read(key);

      expect(read?.response).toEqual({ findings: [] });
      expect(read?.model).toBe(MODEL);
      expect(await readdir(directory)).toEqual([`${key}.json`]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports a missing recording as absent rather than throwing", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "coderadar-replay-"));
    try {
      expect(await createNodeReplayStore(directory).read("0".repeat(64))).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps recordings out of the repository by default and lets the environment move them", () => {
    expect(resolveReplayDirectory("/engine")).toBe(path.join("/engine", ".coderadar", "replay"));

    process.env[REPLAY_DIRECTORY_ENV] = path.join(os.tmpdir(), "somewhere-else");
    try {
      expect(resolveReplayDirectory("/engine")).toBe(path.join(os.tmpdir(), "somewhere-else"));
    } finally {
      delete process.env[REPLAY_DIRECTORY_ENV];
    }
  });
});
