import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNodeFileSystem } from "../src/adapters/node-fs.ts";
import type { ReviewReport } from "../src/core/findings/model.ts";
import { ReviewEngine } from "../src/core/review/engine.ts";
import { withLimitation } from "../src/core/review/limitations.ts";
import { buildWireScanDetail, buildWireSession } from "../src/node/api-contract.ts";
import type { BuildSessionInput, WireScanDetail } from "../src/node/api-contract.ts";
import { createReviewService } from "../src/node/service.ts";
import { createSettingsStore } from "../src/node/settings.ts";

const PROMPTS_DIR = path.join(import.meta.dir, "..", "prompts");
const CLEAN = path.join(import.meta.dir, "fixtures", "clean");
const BUGGY = path.join(import.meta.dir, "fixtures", "buggy");

async function cleanReport(): Promise<ReviewReport> {
  return new ReviewEngine({ fs: createNodeFileSystem(), promptsDir: PROMPTS_DIR }).review({ target: CLEAN });
}

/** The optional fields are not the subject of these tests, so they are fixed. */
function sessionId(): string {
  return "session-1";
}

function detailFor(report: ReviewReport | null, errorMessage: string | null = null): WireScanDetail {
  const input: BuildSessionInput = {
    id: sessionId(),
    report: report ?? ({} as ReviewReport),
    sourcePath: CLEAN,
    targetType: "folder",
    preset: "balanced",
    scanMode: "deep",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: report === null ? null : "2026-01-01T00:00:05.000Z",
    elapsedSeconds: 5,
    progress: 1,
    phaseProgress: 1,
    currentPhase: "Done",
    progressMessage: "Review complete",
    progressLogs: [],
    status: report === null ? "failed" : "completed",
    errorMessage,
  };

  return buildWireScanDetail(buildWireSession(input, report), report, errorMessage);
}

describe("the wire carries the review's own state", () => {
  it("reports a complete review as complete, with no limitations", async () => {
    const report = await cleanReport();
    const detail = detailFor(report);

    expect(detail.review_state).toBe("complete");
    expect(detail.review_limitations).toEqual([]);
    expect(detail.ai_review).toBeNull();
    expect(detail.session.analysis_brief?.analysis_limitations).toEqual([]);
  });

  it("reports a review with no report as failed rather than as clean", () => {
    const detail = detailFor(null, "the review could not run");

    expect(detail.review_state).toBe("failed");
    // A running session has no state yet: null, not a placeholder.
    const running = buildWireSession(
      {
        id: sessionId(),
        report: {} as ReviewReport,
        sourcePath: CLEAN,
        targetType: "folder",
        preset: "balanced",
        scanMode: "deep",
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: null,
        elapsedSeconds: 0,
        progress: 0.2,
        phaseProgress: 0.2,
        currentPhase: "Discovery",
        progressMessage: "Starting",
        progressLogs: [],
        status: "scanning",
        errorMessage: null,
      },
      null,
    );
    expect(running.review_state).toBeNull();
  });

  it("surfaces a limitation as a limitation and never as a finding", async () => {
    const report = withLimitation(await cleanReport(), {
      code: "ai-unavailable",
      detail: "The model did not review this run.",
    });
    const detail = detailFor(report);

    expect(detail.review_state).toBe("degraded");
    expect(detail.review_limitations).toEqual([
      { code: "ai-unavailable", detail: "The model did not review this run.", count: null },
    ]);
    // The two must not mix: a limitation has no severity, no file and no fix.
    expect(detail.findings).toEqual([]);
    expect(detail.session.findings_count).toBe(0);
    expect(detail.session.analysis_brief?.analysis_limitations).toContain("The model did not review this run.");
  });
});

describe("a model that was asked for and a model left out are different reports", () => {
  async function runWith(useAi: boolean): Promise<{ state: string; codes: string[]; requested: boolean }> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "coderadar-service-"));
    try {
      // No provider is configured, which is the case the distinction is about.
      const service = createReviewService({
        settingsStore: createSettingsStore({ filePath: path.join(directory, "settings.json") }),
        promptsDir: PROMPTS_DIR,
      });

      const result = await service.startReview({ target: BUGGY, useAi });

      return {
        state: result.report.state,
        codes: result.report.limitations.map((limitation) => limitation.code),
        requested: result.aiRequested,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it("degrades the review when the model was requested and could not run", async () => {
    const result = await runWith(true);

    expect(result.requested).toBe(true);
    expect(result.state).toBe("degraded");
    expect(result.codes).toContain("ai-unavailable");
  });

  it("narrows the review, without degrading it, when the model was left out on purpose", async () => {
    // Telling a user a review is broken because they turned the model off is as
    // wrong as telling them it is clean when the model never answered.
    const result = await runWith(false);

    expect(result.requested).toBe(false);
    expect(result.state).toBe("partial");
    expect(result.codes).toContain("ai-not-requested");
    expect(result.codes).not.toContain("ai-unavailable");
  });
});
