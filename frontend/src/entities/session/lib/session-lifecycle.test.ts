import { describe, expect, it } from "vitest";
import type { Session } from "@/entities/session/model/types";
import { getSessionLifecycleSummary } from "@/entities/session/lib/session-lifecycle";

function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    title: "Analyst backend",
    repo: "backend",
    time: "2026-04-11 10:00 UTC",
    unread: false,
    status: "completed",
    preview: "preview",
    scanMode: "deep",
    criticalCount: 0,
    warningCount: 1,
    findingsCount: 1,
    candidateFindingsCount: 1,
    progress: 100,
    phaseProgress: 100,
    progressMessage: "Completed",
    currentPhase: "Completed",
    elapsedSeconds: 10,
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
    coveragePercent: 100,
    reviewedFilesCount: 1,
    eligibleFilesCount: 1,
    reviewedBlocksCount: 1,
    totalBlocksCount: 1,
    reviewedLinesCount: 1,
    totalLinesCount: 1,
    tracedPathsCount: 1,
    totalPathsCount: 1,
    skippedFilesCount: 0,
    highRiskFilesCount: 0,
    isSafe: false,
    securityScore: 80,
    scoreRationale: null,
    targetType: "folder",
    sourcePath: "backend",
    preset: "balanced",
    lastVerification: null,
    createdAt: "2026-04-11T10:00:00Z",
    updatedAt: "2026-04-11T10:05:00Z",
    ...overrides,
  };
}

describe("getSessionLifecycleSummary", () => {
  it("prefers blocked patch state when validation failures exist", () => {
    const summary = getSessionLifecycleSummary(
      buildSession({
        reviewQueueSummary: {
          remediation_status_counts: {
            validation_failed: 2,
            patch_generated: 1,
          },
        },
      }),
    );

    expect(summary).toEqual({
      label: "2 blocked patches",
      tone: "warning",
    });
  });

  it("shows patch-ready state when remediation plans are waiting", () => {
    const summary = getSessionLifecycleSummary(
      buildSession({
        reviewQueueSummary: {
          remediation_status_counts: {
            patch_generated: 1,
          },
        },
      }),
    );

    expect(summary).toEqual({
      label: "1 patch ready",
      tone: "progress",
    });
  });

  it("shows rolled-back state from the last verification action", () => {
    const summary = getSessionLifecycleSummary(
      buildSession({
        lastVerification: {
          status: "rolled_back",
        },
      }),
    );

    expect(summary).toEqual({
      label: "Rolled back",
      tone: "warning",
    });
  });
});
