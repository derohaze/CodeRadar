export type FindingSeverity = "critical" | "high" | "medium" | "low";

export type FixSuggestionProfile = "safe" | "fast" | "recommended";

export interface FixSuggestion {
  id: string;
  label: string;
  profile: FixSuggestionProfile;
  description: string;
}

export interface FindingAttackSimulation {
  input: string;
  execution: string;
  result: string;
}

export interface FindingDecisionSummary {
  validationLabel: string;
  validationNote: string;
  riskScore: number;
  riskLabel: string;
  triageBand: string;
  triageRank: number;
  executionDisposition: string;
  approvalState: string;
  policyOutcome: "auto-eligible" | "review-required" | "blocked-by-policy";
  policyReason: string;
  stopState: "continue-remediation" | "hold-for-review" | "stop-and-regenerate" | "ready-for-closure-review";
  applyReadiness: "local-apply-eligible" | "approval-required-before-apply" | "blocked-before-apply";
  escalationState: "none" | "required" | "already-escalated";
  policySummary: PolicySummary;
  residualRiskState: string;
  recommendedAction: string;
  fixRecommendation: string;
  approvalPath: string;
  approvalAuditSummary: ApprovalAuditSummary;
  riskFactors: string[];
}

export interface ApprovalHistoryEntry {
  status: "not_required" | "pending" | "approved" | "rejected" | "escalated";
  note: string;
  timestamp: string;
}

export interface ApprovalAuditSummary {
  status: ApprovalHistoryEntry["status"];
  label: string;
  summary: string;
  note: string;
  timestamp: string | null;
  resolutionCategory: "not-required" | "awaiting-review" | "resolved" | "rejected" | "held";
  source: "policy-default" | "approval-queue" | "approval-controller";
}

export interface PolicySummary {
  posture: "allow" | "review" | "block";
  label: string;
  summary: string;
  autoPathState: "eligible" | "gated" | "forbidden";
  humanPathState: "standard-review" | "approval-required" | "approved-review-cycle" | "escalated-review" | "regenerate-required";
  /**
   * `proceed-with-workspace-apply` is what this app's own policy engine emits
   * (`lib/policy-engine.ts`); the engine's wire contract names the same step
   * `proceed-with-local-apply`. Both are accepted here rather than renaming one:
   * the value is what this app produces, and a rename would change the meaning of
   * a summary that is already stored.
   */
  nextControl:
    | "continue-standard-review"
    | "collect-approval"
    | "proceed-with-local-apply"
    | "proceed-with-workspace-apply"
    | "resolve-escalation"
    | "generate-a-stronger-patch";
}

export interface RemediationExplanation {
  findingId: string;
  summary: string;
  exploitScenario: string;
  requestExample: string;
  payloadExample: string;
  attackSteps: string[];
  entryPoint: string;
  executionPath: string;
  sink: string;
  impact: string;
}

export interface RemediationStrategy {
  id: string;
  label: string;
  kind: "refactor" | "guard" | "sanitization";
  confidence: number;
  impact: string;
  effort: string;
  summary: string;
  rationale: string;
  diff: string;
  recommended: boolean;
  fixType: "full_fix" | "partial_mitigation" | "temporary_guard" | "risky_workaround";
  securityStrength: "high" | "medium" | "low";
  regressionRisk: "low" | "medium" | "high";
  selectionReason: string;
  nonSelectionReason: string;
  residualRisks: string[];
  policyCompliant: boolean;
  policyViolations: string[];
}

export interface PatchCandidate {
  file: string;
  language: string;
  summary: string;
  diff: string;
  validationNotes: string[];
  beforeSnippet: string;
  afterSnippet: string;
  fixType: "full_fix" | "partial_mitigation" | "temporary_guard" | "risky_workaround";
  rationale: string;
  residualRisks: string[];
  manualReviewRequired: boolean;
}

export interface RemediationStep {
  id: string;
  title: string;
  status: "done" | "running" | "pending";
  agent: string;
  details: string[];
}

export interface RemediationMetrics {
  file: string;
  vulnerabilityType: string;
  remediationMode: "single" | "batch";
  analyzedLines: number;
  pathSteps: number;
  evidenceLocation: string;
}

export interface RemediationScore {
  total: number;
  strategyQuality: number;
  fixCompleteness: number;
  sinkAlignment: number;
  residualRisk: number;
  confidence: number;
  rationale: string[];
}

export interface RemediationPlan {
  mode: "single" | "batch";
  findingIds: string[];
  reviewSummary: string;
  explanation: RemediationExplanation | null;
  strategies: RemediationStrategy[];
  recommendedStrategyId: string | null;
  patch: PatchCandidate | null;
  steps: RemediationStep[];
  metrics: RemediationMetrics | null;
  score: RemediationScore | null;
}

export interface RemediationActionResult {
  findingId: string;
  status: "applied" | "rejected" | "validation_failed" | "rolled_back";
  file: string;
  appliedStrategyId: string | null;
  fixType: "full_fix" | "partial_mitigation" | "temporary_guard" | "risky_workaround";
  validationNotes: string[];
  manualEditApplied: boolean;
  checkpointId: string | null;
  rollbackAvailable: boolean;
  verificationStatus: "verified" | "manual_review_required" | "not_run" | "rolled_back";
  verificationNotes: string[];
  verificationConfidence: number | null;
  verificationConfidenceValid: boolean;
  approvalGateOutcome: "auto-approved" | "review-required" | "blocked-by-policy";
  approvalGateReason: string;
  writeScope: string;
  networkPolicy: string;
}

export interface PatchExportSnapshot {
  file: string;
  diff: string;
  beforeSnippet: string;
  afterSnippet: string;
  strategyId: string | null;
  strategyLabel: string | null;
  fixType: RemediationActionResult["fixType"];
  summary: string;
  rationale: string;
  residualRisks: string[];
  manualEdit: boolean;
  mode: "single" | "batch";
}

export interface Finding {
  id: string;
  severity: FindingSeverity | "medium" | "low";
  title: string;
  file: string;
  line: number;
  lineEnd: number;
  category: string;
  confidence: number;
  summary: string;
  impact: string;
  explanation: string;
  evidence: string;
  attackSimulation: FindingAttackSimulation;
  auditLog: string[];
  fixSuggestions: FixSuggestion[];
  remediationStatus:
    | "open"
    | "patch_generated"
    | "applied"
    | "verified_fixed"
    | "verified_partial"
    | "validation_failed"
    | "rejected"
    | "rolled_back";
  approvalStatus: ApprovalHistoryEntry["status"];
  approvalHistory: ApprovalHistoryEntry[];
  appliedStrategyId: string | null;
  remediationNotes: string[];
  attemptedStrategyIds: string[];
  decisionSummary: FindingDecisionSummary | null;
}
