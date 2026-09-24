export type SessionStatus = "queued" | "scanning" | "completed" | "failed";

export interface SessionAnnotation {
  file: string;
  lineStart: number;
  lineEnd: number;
  severity: "critical" | "high" | "medium" | "low";
  tone: "red" | "yellow";
  title: string;
  confidence: number;
  evidence: string;
  claim?: string;
  recommendation?: string;
  pathHint: string;
}

export interface SessionWorkflowSummary {
  state:
    | "scanning"
    | "decisioning"
    | "remediation-review"
    | "approval-control"
    | "verification-follow-up"
    | "completed"
    | "failed";
  label: string;
  summary: string;
  nextAction: string;
  activeController:
    | "executor"
    | "planner"
    | "approval-controller"
    | "verification-controller"
    | "recovery-controller"
    | "state-manager";
  plannerStage?: "triage" | "patch-planning" | "apply-ready" | null;
  recoverySummary?: {
    retryAvailable: boolean;
    retryableFindings: number;
    attemptedStrategies: number;
    latestFailureReason: string;
    lastVerificationStatus: string | null;
    recoveryState: "stable" | "retry-ready" | "planner-reentry" | "manual-fallback" | "terminal-failure";
    nextTransition: "none" | "retry-remediation" | "return-to-planner" | "review-failure";
    controllerStatus: "closed" | "waiting-for-retry" | "waiting-for-planner" | "manual-review-required";
    plannerReentryReady: boolean;
  } | null;
  recoveryExecution?: {
    selectedPath: "none" | "retry-path" | "planner-reentry" | "manual-review" | "manual-recovery";
    executionState: "closed" | "ready" | "held" | "stalled";
    executionLane: "none" | "retry-lane" | "planner-lane" | "manual-lane";
    reenteredPlanner: boolean;
    pathReason: string;
  } | null;
  memorySummary?: {
    attemptedStrategyCount: number;
    rejectedPathCount: number;
    escalatedPathCount: number;
    knownStrategyIds: string[];
    suppressedStrategyCount: number;
    suppressionState: "clear" | "active";
    nextMemoryAction: "no-memory-block" | "generate-materially-different-patch";
    recentConstraint: string;
  } | null;
  operationsSummary?: {
    currentLane:
      | "scan-lane"
      | "decision-lane"
      | "remediation-lane"
      | "approval-lane"
      | "verification-lane"
      | "closure-lane";
    nextLane:
      | "scan-lane"
      | "decision-lane"
      | "remediation-lane"
      | "approval-lane"
      | "verification-lane"
      | "closure-lane"
      | null;
    pendingHandoff: boolean;
    handoffReason: string;
    activeItemCount: number;
  } | null;
  operationsExecution?: {
    currentHandoff: string;
    handoffStatus: "active" | "pending" | "blocked" | "closed";
    owningController:
      | "executor"
      | "planner"
      | "approval-controller"
      | "verification-controller"
      | "recovery-controller"
      | "state-manager";
    pendingExecutionStep: string;
    stepCompletionState: string;
  } | null;
  workflowClosure?: {
    closureState: "autonomous-ready" | "human-controlled" | "manual-closure";
    closureLabel: string;
    closureReason: string;
    autonomousReady: boolean;
    requiresHumanControl: boolean;
    nextClosureStep: string;
  } | null;
  blockingItems: number;
}

export interface SessionAnalysisBrief {
  scoreExplanation: string;
  potentialRisks: string[];
  securityObservations: string[];
  analysisLimitations: string[];
  attackThinking: string[];
  nextSteps: string[];
}

export interface Session {
  id: string;
  title: string;
  repo: string;
  time: string;
  unread: boolean;
  status: SessionStatus;
  preview: string;
  scanMode: "fast" | "deep";
  criticalCount: number;
  warningCount: number;
  findingsCount: number;
  candidateFindingsCount: number;
  progress: number;
  phaseProgress: number;
  progressMessage: string;
  currentPhase: string;
  elapsedSeconds: number;
  progressLogs: string[];
  progressCounters: Record<string, unknown> | null;
  runtimeMetrics: Record<string, unknown> | null;
  scanPlan: Record<string, unknown> | null;
  repositorySummary: string | null;
  analysisBrief: SessionAnalysisBrief | null;
  repositoryInventory: Record<string, unknown> | null;
  frameworkProfile: Record<string, unknown> | null;
  repositoryGraph: Record<string, unknown> | null;
  graphSummary: Record<string, unknown> | null;
  securityRegistry: Record<string, unknown> | null;
  segmentationSummary: Record<string, unknown> | null;
  pathInventory: Record<string, unknown> | null;
  pathSummary: Record<string, unknown> | null;
  reviewQueueSummary: Record<string, unknown> | null;
  annotations: SessionAnnotation[];
  annotationSummary: Record<string, unknown> | null;
  coverageSnapshot: Record<string, unknown> | null;
  coverageSummary: string | null;
  coveragePercent: number;
  reviewedFilesCount: number;
  eligibleFilesCount: number;
  reviewedBlocksCount: number;
  totalBlocksCount: number;
  reviewedLinesCount: number;
  totalLinesCount: number;
  tracedPathsCount: number;
  totalPathsCount: number;
  skippedFilesCount: number;
  highRiskFilesCount: number;
  isSafe: boolean;
  securityScore: number | null;
  scoreRationale: Record<string, unknown> | null;
  targetType: "folder" | "file";
  sourcePath: string;
  preset: "safe" | "balanced" | "aggressive";
  lastVerification: Record<string, unknown> | null;
  workflowSummary?: SessionWorkflowSummary | null;
  createdAt: string;
  updatedAt: string;
}
