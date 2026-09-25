import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ScanResultsScreen } from "./ScanResultsScreen";
import type { ScanSessionDetail } from "@/shared/api/security";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: { children?: ReactNode }) => <button {...props}>{children}</button>,
  },
}));

describe("ScanResultsScreen", () => {
  it("surfaces review-queued findings only once and keeps validated findings focused on open items", () => {
    const onSelectFinding = vi.fn();
    const queuedPatchFinding = {
      id: "finding-sql",
      severity: "high" as const,
      title: "Dynamic query construction may allow injection",
      file: "app/core/security/validator.py",
      line: 40,
      lineEnd: 40,
      category: "SQL injection",
      confidence: 82,
      summary: "summary",
      impact: "impact",
      explanation: "explanation",
      evidence: "query = f\"...\"",
      attackSimulation: { input: "input", execution: "execution", result: "result" },
      auditLog: [],
      fixSuggestions: [],
      remediationStatus: "patch_generated" as const,
      approvalStatus: "pending" as const,
      approvalHistory: [],
      appliedStrategyId: null,
      remediationNotes: [],
      attemptedStrategyIds: [],
      decisionSummary: null,
    };
    const verificationFinding = {
      id: "finding-path",
      severity: "high" as const,
      title: "User-controlled path may reach filesystem access",
      file: "app/features/chat/service.py",
      line: 16,
      lineEnd: 16,
      category: "Path traversal",
      confidence: 84,
      summary: "summary",
      impact: "impact",
      explanation: "explanation",
      evidence: "open(user_path)",
      attackSimulation: { input: "input", execution: "execution", result: "result" },
      auditLog: [],
      fixSuggestions: [],
      remediationStatus: "verified_partial" as const,
      approvalStatus: "approved" as const,
      approvalHistory: [],
      appliedStrategyId: "safe-join",
      remediationNotes: [],
      attemptedStrategyIds: [],
      decisionSummary: null,
    };

    const session = {
      verdict: "issues_found",
      findings: [queuedPatchFinding, verificationFinding],
      candidateFindings: [],
      issues: { critical: 0, high: 2, medium: 0, low: 0 },
      errorMessage: null,
      completedAt: null,
      session: {
        id: "session-1",
        title: "Scan backend",
        repo: "backend",
        time: "2026-04-13 01:00 UTC",
        unread: false,
        status: "completed",
        preview: "preview",
        scanMode: "deep",
        criticalCount: 0,
        warningCount: 2,
        findingsCount: 2,
        candidateFindingsCount: 0,
        progress: 100,
        phaseProgress: 100,
        progressMessage: "Completed",
        currentPhase: "Reporting",
        elapsedSeconds: 32,
        progressLogs: [],
        progressCounters: null,
        runtimeMetrics: null,
        scanPlan: null,
        repositorySummary: "Repository assessment summary.",
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
        coverageSummary: "Coverage summary.",
        coveragePercent: 100,
        reviewedFilesCount: 2,
        eligibleFilesCount: 2,
        reviewedBlocksCount: 3,
        totalBlocksCount: 3,
        reviewedLinesCount: 10,
        totalLinesCount: 10,
        tracedPathsCount: 2,
        totalPathsCount: 2,
        skippedFilesCount: 0,
        highRiskFilesCount: 2,
        isSafe: false,
        securityScore: 89,
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

    render(
      <ScanResultsScreen
        session={session}
        onSelectFinding={onSelectFinding}
      />,
    );

    expect(screen.getByText(/all validated findings in this session are already tracked in the review queue below/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open queue/i })).not.toBeInTheDocument();
    expect(screen.getAllByText("Dynamic query construction may allow injection")).toHaveLength(1);
    expect(screen.getAllByText("User-controlled path may reach filesystem access")).toHaveLength(1);
    expect(screen.getByText("Validated findings")).toBeInTheDocument();
    expect(screen.getAllByText("Review queue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Dynamic query construction may allow injection"));
    expect(onSelectFinding).toHaveBeenCalledWith(expect.objectContaining({ id: "finding-sql" }));
  });

  it("renders AI-generated analyst brief sections when available", () => {
    const session = {
      verdict: "safe",
      findings: [],
      candidateFindings: [],
      issues: { critical: 0, high: 0, medium: 0, low: 0 },
      errorMessage: null,
      completedAt: null,
      session: {
        id: "session-2",
        title: "Scan optimization",
        repo: "optimization",
        time: "2026-04-15 20:44 UTC",
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
        progressMessage: "Completed",
        currentPhase: "Completed",
        elapsedSeconds: 311,
        progressLogs: [],
        progressCounters: null,
        runtimeMetrics: null,
        scanPlan: null,
        repositorySummary: "No validated security issue was confirmed in the selected scope.",
        analysisBrief: {
          scoreExplanation: "The score remained below 100 because cross-file path evidence and runtime integration visibility were limited in this run.",
          potentialRisks: ["Redis-backed cache boundaries were reviewed, but key construction should still be checked for tenant isolation drift."],
          securityObservations: ["Protected routes appear to rely on centralized auth middleware rather than scattered inline checks."],
          analysisLimitations: ["No cross-file source-to-sink path was reconstructed from the reviewed evidence."],
          attackThinking: ["Probe malformed API input against monitor endpoints to confirm validators reject unexpected payload shapes."],
          nextSteps: ["Re-scan after auth or cache changes and add a targeted runtime test for cache isolation."],
        },
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
        coverageSummary: "Coverage summary.",
        coveragePercent: 100,
        reviewedFilesCount: 29,
        eligibleFilesCount: 29,
        reviewedBlocksCount: 64,
        totalBlocksCount: 64,
        reviewedLinesCount: 120,
        totalLinesCount: 120,
        tracedPathsCount: 0,
        totalPathsCount: 0,
        skippedFilesCount: 0,
        highRiskFilesCount: 2,
        isSafe: true,
        securityScore: 90,
        scoreRationale: null,
        targetType: "folder",
        sourcePath: "D:/repo",
        preset: "balanced",
        createdAt: "2026-04-15T20:00:00Z",
        updatedAt: "2026-04-15T20:44:00Z",
        lastVerification: null,
        workflowSummary: null,
      },
    } as unknown as ScanSessionDetail;

    render(
      <ScanResultsScreen
        session={session}
        onSelectFinding={vi.fn()}
      />,
    );

    expect(screen.getByText("AI score explanation")).toBeInTheDocument();
    expect(screen.getByText("Potential risks")).toBeInTheDocument();
    expect(screen.getByText("What CodeRadar could not verify")).toBeInTheDocument();
    expect(screen.getAllByText(/cross-file path evidence and runtime integration visibility were limited/i)).toHaveLength(1);
    expect(screen.getByText(/redis-backed cache boundaries were reviewed/i)).toBeInTheDocument();
    expect(screen.getByText(/probe malformed api input against monitor endpoints/i)).toBeInTheDocument();
  });
});
