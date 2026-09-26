import { describe, expect, it } from "vitest";
import type { Session } from "@/entities/session/model/types";
import { mergeSessionOrder } from "@/entities/session/lib/session-order";

function buildSession(id: string): Session {
  return {
    id,
    title: `Analyst ${id}`,
    repo: "repo",
    time: "2026-04-13 15:00 UTC",
    unread: true,
    status: "queued",
    preview: "preview",
    scanMode: "deep",
    criticalCount: 0,
    warningCount: 0,
    findingsCount: 0,
    candidateFindingsCount: 0,
    progress: 0,
    phaseProgress: 0,
    progressMessage: "Queued",
    currentPhase: "Queued",
    elapsedSeconds: 0,
    progressLogs: [],
    progressCounters: null,
    runtimeMetrics: null,
    scanPlan: null,
    repositorySummary: null,
    analysisBrief: null,
    repositoryInventory: null,
    frameworkProfile: null,
    repositoryGraph: null,
    graphSummary: null,
    securityRegistry: null,
    segmentationSummary: null,
    pathInventory: null,
    pathSummary: null,
    reviewQueueSummary: null,
    annotations: [],
    annotationSummary: null,
    coverageSnapshot: null,
    coverageSummary: null,
    coveragePercent: 0,
    reviewedFilesCount: 0,
    eligibleFilesCount: 0,
    reviewedBlocksCount: 0,
    totalBlocksCount: 0,
    reviewedLinesCount: 0,
    totalLinesCount: 0,
    tracedPathsCount: 0,
    totalPathsCount: 0,
    skippedFilesCount: 0,
    highRiskFilesCount: 0,
    isSafe: false,
    securityScore: null,
    scoreRationale: null,
    targetType: "folder",
    sourcePath: "repo",
    preset: "balanced",
    lastVerification: null,
    createdAt: "2026-04-13T15:00:00Z",
    updatedAt: "2026-04-13T15:00:00Z",
  };
}

describe("mergeSessionOrder", () => {
  it("places newly discovered sessions at the top", () => {
    const nextOrder = mergeSessionOrder(
      ["older-1", "older-2"],
      [buildSession("new-1"), buildSession("older-1"), buildSession("older-2")],
    );

    expect(nextOrder).toEqual(["new-1", "older-1", "older-2"]);
  });

  it("retains user ordering for existing sessions", () => {
    const nextOrder = mergeSessionOrder(
      ["manual-2", "manual-1"],
      [buildSession("manual-1"), buildSession("manual-2")],
    );

    expect(nextOrder).toEqual(["manual-2", "manual-1"]);
  });
});
