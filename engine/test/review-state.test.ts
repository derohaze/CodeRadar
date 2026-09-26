import { describe, expect, it } from "bun:test";
import path from "node:path";
import { createNodeFileSystem } from "../src/adapters/node-fs.ts";
import type { ReviewLimitation, ReviewState } from "../src/core/findings/model.ts";
import type { AiReviewerPort, ReviewEvent } from "../src/core/ports.ts";
import { createStaticAiReviewer } from "../src/core/review/ai-reviewer.ts";
import { createHttpAiReviewer } from "../src/clients/http-ai-reviewer.ts";
import { ReviewEngine } from "../src/core/review/engine.ts";
import { collectLimitations, resolveReviewState } from "../src/core/review/limitations.ts";

const PROMPTS_DIR = path.join(import.meta.dir, "..", "prompts");
const FIXTURES = path.join(import.meta.dir, "fixtures");
const CLEAN = path.join(FIXTURES, "clean");
const BUGGY = path.join(FIXTURES, "buggy");

function engineFor(
  options: {
    aiReviewer?: AiReviewerPort;
    maxAiFiles?: number;
    maxFindings?: number;
    collectTrace?: boolean;
    events?: ReviewEvent[];
  } = {},
): ReviewEngine {
  return new ReviewEngine({
    fs: createNodeFileSystem(),
    promptsDir: PROMPTS_DIR,
    ...(options.aiReviewer !== undefined ? { aiReviewer: options.aiReviewer } : {}),
    ...(options.maxAiFiles !== undefined ? { maxAiFiles: options.maxAiFiles } : {}),
    ...(options.maxFindings !== undefined ? { maxFindings: options.maxFindings } : {}),
    ...(options.collectTrace !== undefined ? { collectTrace: options.collectTrace } : {}),
    ...(options.events !== undefined ? { onEvent: (event: ReviewEvent) => options.events?.push(event) } : {}),
  });
}

/** Files the clean fixture holds: the number of model calls a run makes of it. */
const CLEAN_FILES = 3;

function codes(limitations: readonly ReviewLimitation[]): string[] {
  return limitations.map((limitation) => limitation.code);
}

/** A response with no `findings` key at all is not a review, whatever it says. */
const NOT_A_REVIEW = { verdict: "approve", summary: "Looks fine to me." };

/** A response that says, in the documented shape, that there is nothing to report. */
const EMPTY_REVIEW = { verdict: "approve", summary: "No defect found.", findings: [] };

describe("a model answer that could not be read is never a clean review", () => {
  it("degrades the review when the response carries no findings array", async () => {
    const report = await engineFor({ aiReviewer: createStaticAiReviewer(NOT_A_REVIEW) }).review({ target: CLEAN });

    expect(report.findings).toEqual([]);
    expect(report.state).toBe("degraded");
    expect(codes(report.limitations)).toContain("ai-response-invalid");
    // The summary must not read as a clean bill of health.
    expect(report.summary).toContain("not evidence of clean code");
    // Every call was unreadable, and none of them counted as a readable answer.
    expect(report.stats.aiReview?.attempted).toBe(CLEAN_FILES);
    expect(report.stats.aiReview?.invalid).toBe(CLEAN_FILES);
    expect(report.stats.aiReview?.valid).toBe(0);
    expect(report.stats.aiReview?.empty).toBe(0);
  });

  it("keeps the review complete when the model answered in the documented shape", async () => {
    // `findings: []` is the model reporting clean code, which is a real answer.
    const report = await engineFor({ aiReviewer: createStaticAiReviewer(EMPTY_REVIEW) }).review({ target: CLEAN });

    expect(report.state).toBe("complete");
    expect(report.limitations).toEqual([]);
    expect(report.stats.aiReview?.attempted).toBe(CLEAN_FILES);
    expect(report.stats.aiReview?.empty).toBe(CLEAN_FILES);
    expect(report.stats.aiReview?.invalid).toBe(0);
  });

  it("degrades the review when the provider call produced no response", async () => {
    const failing: AiReviewerPort = {
      name: "failing",
      review: async () => {
        throw new Error("provider returned 503");
      },
    };
    const events: ReviewEvent[] = [];

    const report = await engineFor({ aiReviewer: failing, events }).review({ target: CLEAN });

    expect(report.state).toBe("degraded");
    expect(codes(report.limitations)).toContain("ai-provider-unavailable");
    expect(report.stats.aiReview?.attempted).toBe(CLEAN_FILES);
    expect(report.stats.aiReview?.unavailable).toBe(CLEAN_FILES);
    expect(events.some((event) => event.type === "ai:failed")).toBe(true);
  });

  it("narrows the review, without degrading it, when entries inside a readable answer were unusable", async () => {
    const partlyUsable = {
      verdict: "needs-attention",
      summary: "One claim could not be anchored.",
      findings: [{ title: "no file or line" }],
    };

    const report = await engineFor({ aiReviewer: createStaticAiReviewer(partlyUsable) }).review({ target: CLEAN });

    expect(report.state).toBe("partial");
    expect(codes(report.limitations)).toContain("ai-entries-dropped");
    // One unusable entry per answer, so the count is per call, not per response.
    expect(report.stats.aiReview?.entriesDropped).toBe(CLEAN_FILES);
  });

  it("leaves the review complete when no reviewer was configured at all", async () => {
    // No model was ever asked, so there is nothing to be limited by. The state
    // must reflect what happened, not what the caller might have wanted.
    const report = await engineFor().review({ target: CLEAN });

    expect(report.state).toBe("complete");
    expect(report.stats.aiReview).toBeNull();
    expect(report.limitations).toEqual([]);
  });
});

describe("review state is a property of the run, not of the findings count", () => {
  it("reports partial when some reviewed files were never sent to the model", async () => {
    const events: ReviewEvent[] = [];
    const report = await engineFor({ aiReviewer: createStaticAiReviewer(EMPTY_REVIEW), maxAiFiles: 1, events }).review({
      target: BUGGY,
    });

    // Deterministic findings still stand: the model budget narrows the review,
    // it does not invalidate what the detectors proved.
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.state).toBe("partial");
    expect(codes(report.limitations)).toContain("ai-coverage-incomplete");
    expect(report.stats.aiReview?.notSent).toBeGreaterThan(0);
  });

  it("lets a degrading limitation outrank a narrowing one", () => {
    const limitations: ReviewLimitation[] = [
      { code: "coverage-incomplete", detail: "less than the full scope" },
      { code: "ai-response-invalid", detail: "unreadable answer" },
    ];

    expect(resolveReviewState(limitations)).toBe<ReviewState>("degraded");
  });

  it("treats a diff-scoped review as a scope, not as a limitation of trust", async () => {
    const git = {
      detectRepository: async () => ({ root: FIXTURES, branch: "main" }),
      resolveBaseBranch: async () => "main",
      diff: async () => "diff --git a/src/collections.ts b/src/collections.ts\n--- a/src/collections.ts\n+++ b/src/collections.ts\n@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;\n",
      changedFiles: async () => [],
    };

    const report = await new ReviewEngine({
      fs: createNodeFileSystem(),
      promptsDir: PROMPTS_DIR,
      git,
      changedOnly: true,
    }).review({ target: BUGGY });

    // A diff-scoped review reads less of the tree, so it is narrowing, not
    // degrading: it must never be reported as though a stage had failed.
    expect(codes(report.limitations)).toContain("diff-scoped");
    expect(codes(report.limitations)).not.toContain("ai-response-invalid");
    expect(report.state).toBe("partial");

    // The scope alone, isolated from the coverage it costs.
    expect(resolveReviewState([{ code: "diff-scoped", detail: "anchored to changed lines" }])).toBe<ReviewState>(
      "complete",
    );
  });
});

describe("the trace says what happened to each file", () => {
  it("records selection, the model outcome, and the rejections per file", async () => {
    const report = await engineFor({
      aiReviewer: createStaticAiReviewer(NOT_A_REVIEW),
      collectTrace: true,
      // A cap is the simplest way to produce a rejection, so the trace has one
      // to record rather than an empty map that proves nothing.
      maxFindings: 3,
    }).review({ target: BUGGY });

    const trace = report.trace ?? [];
    expect(trace.length).toBe(report.stats.filesReviewed);

    const sent = trace.filter((entry) => entry.sentToModel);
    expect(sent.length).toBe(report.stats.aiReview?.attempted ?? -1);
    // An unreadable answer is visible per file, which is what makes a 0-finding
    // run diagnosable instead of merely disappointing.
    expect(sent.every((entry) => entry.modelOutcome === "invalid")).toBe(true);

    const withRejections = trace.filter((entry) => Object.keys(entry.rejections).length > 0);
    expect(withRejections.length).toBeGreaterThan(0);
    const recorded = withRejections.reduce(
      (total, entry) => total + Object.values(entry.rejections).reduce((sum, count) => sum + count, 0),
      0,
    );
    expect(recorded).toBe(report.rejected.length);

    // Selection and sending are separate facts: a file the AI budget dropped
    // must not read as one the model was asked about and answered.
    expect(sent.every((entry) => entry.selectedForModel)).toBe(true);
    expect(trace.some((entry) => entry.selectedForModel)).toBe(true);

    // Every candidate is accounted for exactly once. A candidate that vanished
    // between production and the report is the failure this trace exists to make
    // impossible.
    const journeys = trace.flatMap((entry) => entry.candidateDetails);
    const files = new Set(trace.map((entry) => entry.file));
    const byOutcome = (outcome: string): number =>
      journeys.filter((entry) => entry.finalOutcome === outcome).length;
    const capDropped = report.rejected.filter((rejection) => rejection.reason === "over-finding-cap").length;

    expect(journeys.length).toBe(report.stats.candidatesProduced);
    expect(journeys.every((entry) => files.has(entry.requestedFile))).toBe(true);
    expect(byOutcome("retained")).toBe(report.stats.findingsKept);
    expect(byOutcome("dedupe")).toBe(report.stats.duplicatesMerged);
    expect(byOutcome("policy-rejected")).toBe(capDropped);
    expect(byOutcome("rejected")).toBe(report.rejected.length - report.stats.duplicatesMerged - capDropped);
    expect(
      journeys.filter((entry) => entry.validator === "rejected").every((entry) => entry.rejectionReason !== undefined),
    ).toBe(true);
    expect(
      journeys.filter((entry) => entry.validator === "accepted").every((entry) => entry.findingId !== undefined),
    ).toBe(true);

    // An unreadable answer is diagnosable from the trace alone: the parser says
    // what shape the response had, and the request says what it carried.
    expect(sent.every((entry) => entry.parser?.shape === "no-findings-array")).toBe(true);
    expect(sent.every((entry) => (entry.request?.userPromptBytes ?? 0) > 0)).toBe(true);
    expect(sent.every((entry) => entry.request?.maxFindings === 3)).toBe(true);
    expect(sent.every((entry) => (entry.request?.contextWindows.length ?? 0) > 0)).toBe(true);
  });

  it("keeps a rejected claim's anchor and quotes under the file that was asked about", async () => {
    const unsupported = {
      verdict: "needs-attention",
      summary: "One claim could not be anchored.",
      findings: [
        {
          file: "src/session.ts",
          line: 12,
          severity: "high",
          axis: "correctness",
          title: "An expired session is treated as live",
          problem: "The comparison returns the wrong result for an expired session.",
          why: "A session that should have been rejected keeps working.",
          impact: "A revoked session stays usable.",
          evidence: "`return session.expiresAt > now;` is inverted",
          confidence: 90,
          fix: "Compare against now with the operator the fixture uses.",
        },
      ],
    };

    const report = await engineFor({
      aiReviewer: createStaticAiReviewer(unsupported),
      collectTrace: true,
    }).review({ target: CLEAN });

    const journeys = (report.trace ?? []).flatMap((entry) => entry.candidateDetails);
    const aiJourneys = journeys.filter((entry) => entry.origin === "ai");

    // Every call returned the same candidate, but each one is filed under the
    // file the model was asked about, so a foreign answer cannot inflate a file
    // that was never sent. The claim itself keeps the anchor it asked for.
    expect(aiJourneys.length).toBe(CLEAN_FILES);
    expect(new Set(aiJourneys.map((entry) => entry.requestedFile)).size).toBe(CLEAN_FILES);
    expect(aiJourneys.every((entry) => entry.file === "src/session.ts" && entry.line === 12)).toBe(true);
    expect(aiJourneys.every((entry) => entry.validator === "rejected")).toBe(true);
    expect(aiJourneys.every((entry) => entry.rejectionReason === "evidence-not-in-source")).toBe(true);
    expect(aiJourneys.every((entry) => entry.evidence.anchored === false)).toBe(true);
    expect(aiJourneys.every((entry) => entry.evidence.quotesFound.includes(false))).toBe(true);
    expect(aiJourneys.every((entry) => entry.fieldsPresent.title && entry.fieldsPresent.evidence)).toBe(true);
  });

  it("records the exception class, and no parser, when the call itself failed", async () => {
    const failing: AiReviewerPort = {
      name: "failing",
      review: async () => {
        throw new Error("provider returned 503");
      },
    };

    const report = await engineFor({ aiReviewer: failing, collectTrace: true }).review({ target: CLEAN });
    const sent = (report.trace ?? []).filter((entry) => entry.sentToModel);

    expect(sent.length).toBe(CLEAN_FILES);
    expect(sent.every((entry) => entry.modelOutcome === "unavailable")).toBe(true);
    expect(sent.every((entry) => entry.modelErrorName === "Error")).toBe(true);
    // A failed call never reached the parser, so the trace must not claim a
    // shape for an answer that never arrived.
    expect(sent.every((entry) => entry.parser === undefined)).toBe(true);
  });

  it("omits the trace unless the caller asked for one", async () => {
    const report = await engineFor().review({ target: CLEAN });

    expect(report.trace).toBeUndefined();
  });
});

describe("the trace records what the provider call was", () => {
  const PROVIDER = "https://api.example.com/v1/chat/completions";
  const KEY = "sk-super-secret-key-value";

  const original = globalThis.fetch;

  /** An OpenAI-compatible answer, wrapped the way a provider wraps it. */
  function stubReview(content: string, status = 200): void {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-9",
          model: "served-9",
          choices: [{ message: { content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
        }),
        { status, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
  }

  function liveEngineFor(extra: { collectTrace: true; events?: ReviewEvent[]; maxAttempts?: number }) {
    return engineFor({
      aiReviewer: createHttpAiReviewer({
        endpoint: PROVIDER,
        apiKey: KEY,
        model: "configured-model",
        ...(extra.maxAttempts === undefined ? {} : { maxAttempts: extra.maxAttempts, retryDelayMs: 0 }),
      }),
      collectTrace: extra.collectTrace,
      ...(extra.events === undefined ? {} : { events: extra.events }),
    });
  }

  /** A grounded claim about the clean fixture, so a readable answer becomes a finding. */
  const GROUNDED_ANSWER = JSON.stringify({
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
  });

  it("keeps the call metadata next to a readable answer", async () => {
    try {
      stubReview(GROUNDED_ANSWER);

      const report = await liveEngineFor({ collectTrace: true }).review({ target: CLEAN });
      const sent = (report.trace ?? []).filter((entry) => entry.sentToModel);

      expect(sent).toHaveLength(CLEAN_FILES);
      expect(sent.every((entry) => entry.modelOutcome === "valid")).toBe(true);
      expect(sent.every((entry) => entry.provider === "api.example.com")).toBe(true);
      expect(sent.every((entry) => entry.model === "configured-model")).toBe(true);
      expect(sent.every((entry) => entry.parser?.shape === "review")).toBe(true);

      const attempt = sent[0]?.response?.attempts[0];
      expect(attempt?.outcome).toBe("response");
      expect(attempt?.responseId).toBe("chatcmpl-9");
      expect(attempt?.responseModel).toBe("served-9");
      expect(attempt?.usage?.totalTokens).toBe(12);
      expect(report.state).toBe("complete");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("tells an empty answer apart from an unreadable one", async () => {
    try {
      stubReview('{"verdict":"approve","summary":"clean","findings":[]}');
      const empty = await liveEngineFor({ collectTrace: true }).review({ target: CLEAN });

      expect((empty.trace ?? []).filter((entry) => entry.sentToModel).every((entry) => entry.modelOutcome === "empty")).toBe(
        true,
      );
      expect(empty.state).toBe("complete");

      stubReview('{"verdict":"approve"}');
      const unreadable = await liveEngineFor({ collectTrace: true }).review({ target: CLEAN });
      const sent = (unreadable.trace ?? []).filter((entry) => entry.sentToModel);

      expect(sent.every((entry) => entry.modelOutcome === "invalid")).toBe(true);
      // The provider call itself succeeded and the answer could not be read. That
      // difference is exactly why the parser verdict and the call record sit side
      // by side in the trace.
      expect(sent.every((entry) => entry.response?.attempts[0]?.outcome === "response")).toBe(true);
      expect(unreadable.state).toBe("degraded");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("records a failed call without repeating the provider's words", async () => {
    const events: ReviewEvent[] = [];
    try {
      globalThis.fetch = (async () =>
        new Response('{"error":{"message":"source-marker"}}', {
          status: 503,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch;

      const report = await liveEngineFor({ collectTrace: true, events, maxAttempts: 2 }).review({ target: CLEAN });
      const sent = (report.trace ?? []).filter((entry) => entry.sentToModel);

      expect(sent).toHaveLength(CLEAN_FILES);
      expect(sent.every((entry) => entry.modelOutcome === "unavailable")).toBe(true);
      expect(sent.every((entry) => entry.modelErrorName === "AttemptFailure")).toBe(true);
      expect(sent.every((entry) => entry.response?.attempts.length === 2)).toBe(true);
      expect(
        sent.every((entry) =>
          entry.response?.attempts.every((attempt) => attempt.outcome === "http-error" && attempt.status === 503),
        ),
      ).toBe(true);
      expect(report.state).toBe("degraded");
      expect(codes(report.limitations)).toContain("ai-provider-unavailable");

      // Neither the key nor the provider's body may travel with the report.
      const serialised = JSON.stringify(report);
      expect(serialised).not.toContain(KEY);
      expect(serialised).not.toContain("source-marker");

      // The failure is still explained: the attempt outcome and the status code
      // carry the meaning the provider's prose used to carry.
      const failure = events.find((event) => event.type === "ai:failed");
      expect(failure?.message).toContain("http-error 503");
      expect(failure?.message).toContain("2 attempt(s)");
      expect(failure?.message).not.toContain("source-marker");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("collectLimitations", () => {
  const base = {
    ai: null,
    filesDiscovered: 10,
    filesReviewed: 10,
    indexContentUnavailable: false,
    indexTruncatedFiles: 0,
    diffAware: false,
    baseBranch: null,
  };

  it("produces nothing when everything was read", () => {
    expect(collectLimitations(base)).toEqual([]);
  });

  it("counts the files a narrowing limitation is about", () => {
    const limitations = collectLimitations({
      ...base,
      ai: { attempted: 10, valid: 7, empty: 3, partial: 0, invalid: 0, unavailable: 0, entriesDropped: 0, notSent: 4 },
    });

    const coverage = limitations.find((limitation) => limitation.code === "ai-coverage-incomplete");
    expect(coverage?.count).toBe(4);
  });

  it("does not invent a limitation from a stage that was never asked to run", () => {
    // No reviewer configured, and nothing else wrong: no limitation may be
    // inferred from the absence of a model.
    expect(collectLimitations({ ...base, ai: null })).toEqual([]);
  });
});
