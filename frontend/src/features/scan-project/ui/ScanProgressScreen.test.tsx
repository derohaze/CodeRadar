import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ScanProgressScreen } from "./ScanProgressScreen";
import type { ScanSessionDetail } from "@/shared/api";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  },
}));

vi.mock("@/components/ui/shiny-text", () => ({
  ShinyText: ({ text, className }: { text: string; className?: string }) => <span className={className}>{text}</span>,
}));

describe("ScanProgressScreen", () => {
  it("renders professional progress copy during repository mapping", () => {
    const session = {
      verdict: null,
      findings: [],
      candidateFindings: [],
      issues: { critical: 0, high: 0, medium: 0, low: 0 },
      errorMessage: null,
      completedAt: null,
      session: {
        id: "session-progress",
        title: "Scan backend",
        repo: "backend",
        time: "2026-04-13 01:00 UTC",
        unread: false,
        status: "scanning",
        preview: "preview",
        scanMode: "deep",
        criticalCount: 0,
        warningCount: 0,
        findingsCount: 0,
        candidateFindingsCount: 0,
        progress: 32,
        phaseProgress: 60,
        progressMessage: "Repository mapping in progress",
        currentPhase: "Repository mapping",
        elapsedSeconds: 9,
        progressLogs: [],
        progressCounters: {
          mapping_artifacts_ready: 6,
          mapping_artifacts_total: 6,
          mapping_ai_steps_completed: 0,
          mapping_ai_steps_total: 0,
        },
        runtimeMetrics: null,
        scanPlan: null,
        repositorySummary: null,
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
        isSafe: null,
        securityScore: null,
        scoreRationale: null,
        targetType: "folder",
        sourcePath: "D:/repo",
        preset: "balanced",
        createdAt: "2026-04-13T00:00:00Z",
        updatedAt: "2026-04-13T00:00:00Z",
        lastVerification: null,
        workflowSummary: null,
      },
    } as unknown as ScanSessionDetail;

    render(<ScanProgressScreen session={session} />);

    expect(screen.getByRole("heading", { name: "Reviewing your codebase for issues" })).toBeInTheDocument();
    expect(screen.getByText("Inspecting repository structure, data flow, and active review signals")).toBeInTheDocument();
    expect(screen.getByText("Coverage pending")).toBeInTheDocument();
    expect(screen.getByText("Repository structure, dependency markers, and review metadata are being prepared")).toBeInTheDocument();

    expect(screen.queryByText("Codebase analysis in progress")).not.toBeInTheDocument();
    expect(screen.queryByText(/trust boundaries, framework markers, sinks, and graph summaries/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Coverage starts during review")).not.toBeInTheDocument();
  });

  it("shows a clear empty-path message when scan completed with no path candidates", () => {
    const session = {
      verdict: "safe",
      findings: [],
      candidateFindings: [],
      issues: { critical: 0, high: 0, medium: 0, low: 0 },
      errorMessage: null,
      completedAt: "2026-04-13T00:05:00Z",
      session: {
        id: "session-no-paths",
        title: "Scan backend",
        repo: "backend",
        time: "2026-04-13 01:00 UTC",
        unread: false,
        status: "completed",
        preview: "preview",
        scanMode: "deep",
        criticalCount: 0,
        warningCount: 0,
        findingsCount: 0,
        candidateFindingsCount: 0,
        progress: 100,
        phaseProgress: 100,
        progressMessage: "Scan completed",
        currentPhase: "Completed",
        elapsedSeconds: 9,
        progressLogs: [],
        progressCounters: null,
        runtimeMetrics: null,
        scanPlan: null,
        repositorySummary: null,
        repositoryInventory: null,
        frameworkProfile: null,
        repositoryGraph: null,
        graphSummary: null,
        securityRegistry: null,
        segmentationSummary: null,
        pathInventory: null,
        pathSummary: { candidate_path_count: 0 },
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
        isSafe: true,
        securityScore: null,
        scoreRationale: null,
        targetType: "folder",
        sourcePath: "D:/repo",
        preset: "balanced",
        createdAt: "2026-04-13T00:00:00Z",
        updatedAt: "2026-04-13T00:05:00Z",
        lastVerification: null,
        workflowSummary: null,
      },
    } as unknown as ScanSessionDetail;

    render(<ScanProgressScreen session={session} />);

    expect(screen.getByText("No path candidates")).toBeInTheDocument();
    expect(screen.getByText("Path tracing ran but found no source-to-sink candidates in this run")).toBeInTheDocument();
    expect(screen.queryByText("0/0 paths")).not.toBeInTheDocument();
  });

  it("does not show a zero-over-zero path count while path review is waiting for inventory", () => {
    const session = {
      verdict: null,
      findings: [],
      candidateFindings: [],
      issues: { critical: 0, high: 0, medium: 0, low: 0 },
      errorMessage: null,
      completedAt: null,
      session: {
        id: "session-review-pending",
        title: "Scan backend",
        repo: "backend",
        time: "2026-04-13 01:00 UTC",
        unread: false,
        status: "scanning",
        preview: "preview",
        scanMode: "deep",
        criticalCount: 0,
        warningCount: 0,
        findingsCount: 0,
        candidateFindingsCount: 0,
        progress: 44,
        phaseProgress: 10,
        progressMessage: "Preparing path review",
        currentPhase: "Reviewing paths",
        elapsedSeconds: 2,
        progressLogs: [],
        progressCounters: null,
        runtimeMetrics: null,
        scanPlan: null,
        repositorySummary: null,
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
        isSafe: null,
        securityScore: null,
        scoreRationale: null,
        targetType: "folder",
        sourcePath: "D:/repo",
        preset: "balanced",
        createdAt: "2026-04-13T00:00:00Z",
        updatedAt: "2026-04-13T00:00:00Z",
        lastVerification: null,
        workflowSummary: null,
      },
    } as unknown as ScanSessionDetail;

    render(<ScanProgressScreen session={session} />);

    expect(screen.getByText("Path review pending")).toBeInTheDocument();
    expect(screen.getByText("Review starts after path inventory is available")).toBeInTheDocument();
    expect(screen.queryByText("0/0 paths")).not.toBeInTheDocument();
  });
});
