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
      rejectedCandidates: [],
      rejectionsByReason: {},
      reviewState: "complete",
      limitations: [],
      aiReview: null,
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
      rejectedCandidates: [],
      rejectionsByReason: {},
      reviewState: "complete",
      limitations: [],
      aiReview: null,
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

  it("explains every dropped candidate, distinguishing a refusal from a merge", () => {
    const rejectedCandidates = [
      {
        title: "Missing null check on user.address",
        file: "src/user-profile.ts",
        line: 27,
        lineEnd: 29,
        reason: "evidence-not-in-source",
        detail: "the quoted evidence does not appear in the reviewed file",
        diagnostics: {
          evidence: 'Code: lines 27-29: `city: user.address.city, plan: user.plan_code;`',
          quotes: ["city: user.address.city, plan: user.plan_code;"],
          quotesFound: [false],
          comparedFile: "src/user-profile.ts",
          comparedChars: 1060,
          usedFileReference: false,
          axis: "correctness",
          severity: "high",
          confidence: 92,
        },
      },
      {
        title: "Revocations are not awaited",
        file: "src/session-store.ts",
        line: 27,
        lineEnd: 27,
        reason: "evidence-not-in-source",
        detail: "the quoted evidence does not appear in the reviewed file",
        diagnostics: {
          evidence: "the revocations never complete for this device",
          quotes: [],
          quotesFound: [],
          comparedFile: "src/session-store.ts",
          comparedChars: 812,
          usedFileReference: true,
          axis: "concurrency",
          severity: "critical",
          confidence: 95,
        },
      },
      {
        title: "applyQuantityCap mutates the caller's array",
        file: "src/cart.ts",
        line: 14,
        lineEnd: 18,
        reason: "merged-duplicate",
        detail: "merged into f-1a2b3c4d (Cart is mutated in place)",
        diagnostics: null,
      },
      {
        title: "Search term reaches SQL without a parameter",
        file: "src/report-query.ts",
        line: 31,
        lineEnd: 31,
        reason: "over-finding-cap",
        detail: "dropped by the cap of 15 findings",
        diagnostics: null,
      },
    ];

    const session = {
      verdict: "safe",
      findings: [],
      candidateFindings: [],
      rejectedCandidates,
      rejectionsByReason: { "evidence-not-in-source": 2, "merged-duplicate": 1, "over-finding-cap": 1 },
      reviewState: "complete",
      limitations: [],
      aiReview: null,
      issues: { critical: 0, high: 0, medium: 0, low: 0 },
      errorMessage: null,
      completedAt: null,
      session: {
        id: "session-3",
        title: "Scan ai-review fixture",
        repo: "repo",
        time: "2026-09-25 08:00 UTC",
        unread: false,
        status: "completed",
        preview: "preview",
        scanMode: "deep",
        criticalCount: 0,
        warningCount: 0,
        findingsCount: 0,
        candidateFindingsCount: 4,
        progress: 100,
        phaseProgress: 100,
        progressMessage: "Completed",
        currentPhase: "Completed",
        elapsedSeconds: 61,
        progressLogs: [],
        progressCounters: null,
        runtimeMetrics: null,
        scanPlan: null,
        repositorySummary: "Reviewed the fixture and kept no finding.",
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
        reviewedFilesCount: 11,
        eligibleFilesCount: 11,
        reviewedBlocksCount: 11,
        totalBlocksCount: 11,
        reviewedLinesCount: 200,
        totalLinesCount: 200,
        tracedPathsCount: 0,
        totalPathsCount: 0,
        skippedFilesCount: 0,
        highRiskFilesCount: 0,
        isSafe: true,
        securityScore: 96,
        scoreRationale: null,
        targetType: "folder",
        sourcePath: "D:/repo",
        preset: "balanced",
        createdAt: "2026-09-25T08:00:00Z",
        updatedAt: "2026-09-25T08:01:00Z",
        lastVerification: null,
        workflowSummary: null,
      },
    } as unknown as ScanSessionDetail;

    render(<ScanResultsScreen session={session} onSelectFinding={vi.fn()} />);

    // The count, the locations, and the reasons are all on screen, so a reviewer
    // can tell a refused claim from a defect the review never saw.
    expect(screen.getByText("Rejected candidates")).toBeInTheDocument();
    expect(screen.getByText("4 dropped")).toBeInTheDocument();
    // The headline count and the row count are the same number, and the chip in
    // the score panel agrees with both.
    expect(screen.getByText("Dropped candidates")).toBeInTheDocument();
    expect(screen.getByText("src/user-profile.ts:27-29")).toBeInTheDocument();
    expect(screen.getByText("src/session-store.ts:27")).toBeInTheDocument();
    expect(screen.getAllByText("Evidence not found in source")).toHaveLength(2);
    // A merged duplicate is not the same event as a refused claim, so it is not
    // filed under the same heading.
    expect(screen.getByText("Merged into an existing finding")).toBeInTheDocument();
    expect(screen.getByText("Over the finding cap")).toBeInTheDocument();

    // Collapsed by default: the reason is visible, the comparison is not.
    expect(screen.queryByText(/the quoted evidence does not appear in the reviewed file/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Missing null check on user.address/ }));

    expect(screen.getByText(/the quoted evidence does not appear in the reviewed file/)).toBeInTheDocument();
    // The quoted code and the outcome of comparing it are both on screen.
    expect(screen.getAllByText(/city: user.address.city, plan: user.plan_code;/).length).toBeGreaterThan(0);
    expect(screen.getByText("not found in src/user-profile.ts")).toBeInTheDocument();
    expect(screen.getByText(/Compared against src\/user-profile.ts \(1060 characters\)/)).toBeInTheDocument();
    expect(screen.getByText(/Submitted as correctness \/ high \/ confidence 92%/)).toBeInTheDocument();

    // The candidate that quoted nothing says so, instead of looking like it was
    // never compared at all.
    fireEvent.click(screen.getByRole("button", { name: /Revocations are not awaited/ }));
    expect(
      screen.getByText(/No quoted code was submitted, and the evidence does not name src\/session-store.ts, so there was nothing left to verify/),
    ).toBeInTheDocument();
  });

  it("never presents an incomplete review as clean", () => {
    render(
      <ScanResultsScreen
        session={
          {
            verdict: "safe",
            findings: [],
            candidateFindings: [],
            rejectedCandidates: [],
            rejectionsByReason: {},
            reviewState: "degraded",
            limitations: [
              {
                code: "ai-response-invalid",
                detail: "2 model responses could not be read as a review, so 2 files were checked deterministically only.",
                count: 2,
              },
            ],
            aiReview: {
              attempted: 11,
              valid: 0,
              empty: 0,
              partial: 0,
              invalid: 2,
              unavailable: 9,
              entriesDropped: 0,
              notSent: 0,
            },
            issues: { critical: 0, high: 0, medium: 0, low: 0 },
            session: {
              id: "session-1",
              title: "repo",
              repo: "repo",
              time: "2m",
              status: "completed",
              scanMode: "deep",
              securityScore: null,
              repositorySummary: null,
              coveragePercent: 100,
              reviewedFilesCount: 11,
              eligibleFilesCount: 11,
              candidateFindingsCount: 0,
              skippedFilesCount: 0,
              preset: "balanced",
              createdAt: "2026-04-15T20:00:00Z",
              updatedAt: "2026-04-15T20:02:00Z",
              lastVerification: null,
              workflowSummary: null,
              annotations: [],
            },
          } as unknown as ScanSessionDetail
        }
        onSelectFinding={vi.fn()}
      />,
    );

    // The three claims the screen must not make for a review that could not read
    // its own model answers.
    expect(screen.queryByText(/no validated security issue was confirmed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no high-confidence, confirmed security issue was found/i)).not.toBeInTheDocument();
    expect(screen.getByText(/not evidence of clean code/i)).toBeInTheDocument();

    // The limitation is shown as a review limit, with its own heading, and is not
    // dressed up as a finding. The state label appears in the header and on the
    // card, so it is asserted as present rather than unique.
    expect(screen.getAllByText(/Review incomplete/i).length).toBeGreaterThan(0);
    expect(screen.getByText("A model answer could not be read")).toBeInTheDocument();
    expect(screen.getByText(/not proof that the code is unsafe, and not findings/i)).toBeInTheDocument();
    expect(screen.getByText(/No confirmed finding was retained, and the review did not cover everything/i)).toBeInTheDocument();
  });

  it("keeps a complete review's clean wording", () => {
    render(
      <ScanResultsScreen
        session={
          {
            verdict: "safe",
            findings: [],
            candidateFindings: [],
            rejectedCandidates: [],
            rejectionsByReason: {},
            reviewState: "complete",
            limitations: [],
            aiReview: { attempted: 3, valid: 0, empty: 3, partial: 0, invalid: 0, unavailable: 0, entriesDropped: 0, notSent: 0 },
            issues: { critical: 0, high: 0, medium: 0, low: 0 },
            session: {
              id: "session-2",
              title: "repo",
              repo: "repo",
              time: "1m",
              status: "completed",
              scanMode: "deep",
              securityScore: null,
              repositorySummary: "Reviewed 3 files",
              coveragePercent: 100,
              reviewedFilesCount: 3,
              eligibleFilesCount: 3,
              candidateFindingsCount: 0,
              skippedFilesCount: 0,
              preset: "balanced",
              createdAt: "2026-04-15T20:00:00Z",
              updatedAt: "2026-04-15T20:01:00Z",
              lastVerification: null,
              workflowSummary: null,
              annotations: [],
            },
          } as unknown as ScanSessionDetail
        }
        onSelectFinding={vi.fn()}
      />,
    );

    expect(screen.getByText(/no validated security issue was confirmed/i)).toBeInTheDocument();
    // No limitation card exists for a complete review.
    expect(screen.queryByText(/not proof that the code is unsafe, and not findings/i)).not.toBeInTheDocument();
  });
});
