import type {
  Finding,
  FindingDecisionSummary as FindingDecisionSummaryContract,
  PatchCandidate,
  RemediationPlan,
  RemediationStrategy,
} from "@/entities/finding/model/types";
import { buildPolicyOutcome, buildPolicyReason, buildPolicySummary } from "@/entities/finding/lib/policy-engine";
import { calculateFindingRiskScore, calculatePatchRiskScore } from "@/entities/finding/lib/risk-engine";

export type FindingDecisionSummary = FindingDecisionSummaryContract;

export interface PatchDecisionSummary {
  riskScore: number;
  riskLabel: string;
  decisionStatus: string;
  approvalState: string;
  policyOutcome: FindingDecisionSummary["policyOutcome"];
  stopState: FindingDecisionSummary["stopState"];
  applyReadiness: FindingDecisionSummary["applyReadiness"];
  escalationState: FindingDecisionSummary["escalationState"];
  policySummary: FindingDecisionSummary["policySummary"];
  recommendedAction: string;
  approvalPath: string;
  rolloutGuidance: string;
  approvalAuditSummary: FindingDecisionSummary["approvalAuditSummary"];
}

const IDENTITY_TOKENS = ["auth", "authentication", "authorization", "session", "privilege"];

export function buildFindingDecisionSummary(finding: Finding): FindingDecisionSummary {
  if (finding.decisionSummary) {
    return finding.decisionSummary;
  }
  const category = finding.category.toLowerCase();
  const touchesIdentity = IDENTITY_TOKENS.some((token) => category.includes(token));
  const riskScore = calculateFindingRiskScore(finding, touchesIdentity);
  const safeAutoPath = isSafeAutoPath(finding, touchesIdentity, riskScore);
  const remediationStatus = finding.remediationStatus;
  const triageBand = buildTriageBand({ finding, riskScore, touchesIdentity });
  const triageRank = buildTriageRank({ finding, riskScore, touchesIdentity });
  const executionDisposition = buildExecutionDisposition({ finding, touchesIdentity });
  const approvalState = buildApprovalState({ finding, touchesIdentity });
  const residualRiskState = buildResidualRiskState(finding);

  return {
    validationLabel: "Validated finding",
    validationNote: "This issue is already in the validated findings set, not just a candidate signal.",
    riskScore,
    riskLabel: riskScore >= 85 ? "Immediate attention" : riskScore >= 65 ? "Needs remediation" : "Review and schedule",
    triageBand,
    triageRank,
    executionDisposition,
    approvalState,
    policyOutcome: buildPolicyOutcome({ finding, riskScore, touchesIdentity, safeAutoPath }),
    policyReason: buildPolicyReason({ finding, riskScore, touchesIdentity, safeAutoPath }),
    stopState: buildStopState(finding),
    applyReadiness: buildApplyReadiness(finding, touchesIdentity, riskScore),
    escalationState: buildEscalationState(finding, touchesIdentity, riskScore),
    policySummary: buildPolicySummary(finding, touchesIdentity, riskScore, safeAutoPath),
    residualRiskState,
    recommendedAction: buildRecommendedAction(remediationStatus),
    fixRecommendation: buildFixRecommendation(category),
    approvalPath: buildApprovalPath(finding, touchesIdentity),
    approvalAuditSummary: buildApprovalAuditSummary(finding),
    riskFactors: buildRiskFactors(finding, touchesIdentity),
  };
}

export function buildPatchDecisionSummary({
  finding,
  patch,
  selectedStrategy,
  mode,
}: {
  finding: Finding | null | undefined;
  patch: PatchCandidate | null | undefined;
  selectedStrategy: RemediationStrategy | null | undefined;
  mode: RemediationPlan["mode"];
}): PatchDecisionSummary {
  const category = String(finding?.category ?? "").toLowerCase();
  const touchesIdentity = IDENTITY_TOKENS.some((token) => category.includes(token));
  const findingDecision = finding ? buildFindingDecisionSummary(finding) : null;
  const riskScore = Math.max(
    findingDecision?.riskScore ?? 0,
    calculatePatchRiskScore({
      severity: finding?.severity ?? "medium",
      confidence: finding?.confidence ?? 70,
      touchesIdentity,
      selectedStrategy,
      patch,
      mode,
    }),
  );

  return {
    riskScore,
    riskLabel: riskScore >= 85 ? "Approval-sensitive" : riskScore >= 65 ? "Review carefully" : "Localized change",
    decisionStatus: buildPatchDecisionStatus({ findingDecision, selectedStrategy, patch }),
    approvalState: buildPatchApprovalState({ findingDecision, selectedStrategy, patch }),
    policyOutcome: buildPatchPolicyOutcome({ findingDecision, selectedStrategy, patch }),
    stopState: findingDecision?.stopState ?? "continue-remediation",
    applyReadiness: findingDecision?.applyReadiness ?? "local-apply-eligible",
    escalationState: findingDecision?.escalationState ?? "none",
    // `buildPolicySummary` takes a fourth argument, `safeAutoPath`, that this call
    // never supplied — so it has always been `undefined` here, and every branch
    // that reads it treats that as false. Passing `false` keeps behaviour
    // identical and makes the call honest. Whether this path *should* pass the
    // `safeAutoPath` that `buildPolicyOutcome` computes is a product decision, not
    // a refactor: it changes the summary a reviewer reads.
    policySummary:
      findingDecision?.policySummary ??
      buildPolicySummary(finding ?? buildFallbackFindingForApprovalAudit(), touchesIdentity, riskScore, false),
    recommendedAction: buildPatchRecommendedAction({ selectedStrategy, patch, findingDecision }),
    approvalPath: buildPatchApprovalPath({
      severity: finding?.severity ?? "medium",
      touchesIdentity,
      selectedStrategy,
      mode,
      findingDecision,
      patch,
    }),
    rolloutGuidance: buildPatchRolloutGuidance({ selectedStrategy, patch, findingDecision }),
    approvalAuditSummary: findingDecision?.approvalAuditSummary ?? buildApprovalAuditSummary(finding ?? buildFallbackFindingForApprovalAudit()),
  };
}

function buildFallbackFindingForApprovalAudit(): Finding {
  return {
    id: "fallback-finding",
    severity: "medium",
    title: "Fallback finding",
    file: "Unknown file",
    line: 0,
    lineEnd: 0,
    category: "Unknown category",
    confidence: 70,
    summary: "",
    impact: "",
    explanation: "",
    evidence: "",
    attackSimulation: {
      input: "",
      execution: "",
      result: "",
    },
    auditLog: [],
    fixSuggestions: [],
    remediationStatus: "open",
    approvalStatus: "not_required",
    approvalHistory: [],
    appliedStrategyId: null,
    remediationNotes: [],
    attemptedStrategyIds: [],
    decisionSummary: null,
  };
}


function buildRecommendedAction(remediationStatus: Finding["remediationStatus"]): string {
  switch (remediationStatus) {
    case "patch_generated":
      return "Review the proposed patch and approve it only if it matches the traced sink and the required security strategy.";
    case "verified_fixed":
      return "Treat the patched file as fixed, then re-run the broader review before closing repository-level risk.";
    case "verified_partial":
      return "Keep the finding open until follow-up verification or a stronger patch confirms the vulnerable path is fully closed.";
    case "validation_failed":
      return "Generate another remediation or edit the patch manually; the previous apply attempt was blocked safely.";
    case "rejected":
      return "The issue is still open. Generate a different remediation path or handle the fix manually.";
    case "rolled_back":
      return "A previous patch was rolled back. Review another remediation path before applying changes again.";
    default:
      return "Generate a remediation plan, review the patch, and apply it only after confirming the path and sink match the real finding.";
  }
}

function buildTriageBand({
  finding,
  riskScore,
  touchesIdentity,
}: {
  finding: Finding;
  riskScore: number;
  touchesIdentity: boolean;
}): string {
  if (finding.remediationStatus === "verified_fixed") {
    return "Resolved locally";
  }
  if (finding.remediationStatus === "verified_partial") {
    return touchesIdentity ? "Review before closure" : "Verification follow-up";
  }
  if (finding.remediationStatus === "validation_failed") {
    return "Blocked remediation";
  }
  if (touchesIdentity || finding.severity === "critical" || riskScore >= 85) {
    return "Priority 1";
  }
  if (finding.severity === "high" || riskScore >= 65) {
    return "Priority 2";
  }
  return "Priority 3";
}

function buildTriageRank({
  finding,
  riskScore,
  touchesIdentity,
}: {
  finding: Finding;
  riskScore: number;
  touchesIdentity: boolean;
}): number {
  if (finding.remediationStatus === "validation_failed") {
    return 1;
  }
  if (finding.remediationStatus === "verified_partial") {
    return touchesIdentity ? 2 : 3;
  }
  if (touchesIdentity && (finding.remediationStatus === "open" || finding.remediationStatus === "patch_generated")) {
    return 2;
  }
  if (finding.remediationStatus === "patch_generated") {
    return 3;
  }
  if (finding.severity === "critical" || riskScore >= 85) {
    return 4;
  }
  if (finding.severity === "high" || riskScore >= 65) {
    return 5;
  }
  if (finding.remediationStatus === "verified_fixed") {
    return 7;
  }
  return 6;
}

function buildExecutionDisposition({
  finding,
  touchesIdentity,
}: {
  finding: Finding;
  touchesIdentity: boolean;
}): string {
  if (finding.remediationStatus === "verified_fixed") {
    return "Re-scan before repository closure";
  }
  if (finding.remediationStatus === "verified_partial") {
    return "Do not auto-close; verification follow-up required";
  }
  if (finding.remediationStatus === "validation_failed") {
    return "Blocked pending stronger patch";
  }
  if (finding.remediationStatus === "patch_generated") {
    return touchesIdentity ? "Review patch before any apply" : "Patch review in progress";
  }
  if (touchesIdentity) {
    return "Do not auto-apply without approval";
  }
  return "Eligible for remediation planning";
}

function buildApprovalState({
  finding,
  touchesIdentity,
}: {
  finding: Finding;
  touchesIdentity: boolean;
}): string {
  if (finding.remediationStatus === "verified_fixed") {
    return "Not required for local closure";
  }
  if (touchesIdentity) {
    return "Approval required";
  }
  if (finding.remediationStatus === "verified_partial") {
    return "Verification review required";
  }
  if (finding.severity === "critical" || finding.severity === "high") {
    return "Human review required";
  }
  return "Standard review";
}


function buildResidualRiskState(finding: Finding): string {
  switch (finding.remediationStatus) {
    case "verified_fixed":
      return "Reduced in patched file; repository confirmation still pending";
    case "verified_partial":
      return "Residual risk remains until follow-up verification closes the path";
    case "validation_failed":
      return "Risk unchanged because no patch was applied";
    case "rejected":
      return "Risk unchanged because the proposed remediation was rejected";
    case "rolled_back":
      return "Risk restored to the pre-patch state";
    default:
      return "Risk remains active until a verified remediation is applied";
  }
}

function buildStopState(finding: Finding): FindingDecisionSummary["stopState"] {
  const approvalStatus = getApprovalStatus(finding);
  if (finding.remediationStatus === "verified_fixed") {
    return "ready-for-closure-review";
  }
  if (["validation_failed", "rejected", "rolled_back"].includes(finding.remediationStatus)) {
    return "stop-and-regenerate";
  }
  if (finding.remediationStatus === "verified_partial" || approvalStatus === "escalated") {
    return "hold-for-review";
  }
  return "continue-remediation";
}

function buildApplyReadiness(
  finding: Finding,
  touchesIdentity: boolean,
  riskScore: number,
): FindingDecisionSummary["applyReadiness"] {
  const approvalStatus = getApprovalStatus(finding);
  if (finding.remediationStatus === "validation_failed") {
    return "blocked-before-apply";
  }
  if (approvalStatus === "approved") {
    return "local-apply-eligible";
  }
  if (
    touchesIdentity
    || finding.remediationStatus === "patch_generated"
    || finding.remediationStatus === "verified_partial"
    || finding.severity === "critical"
    || finding.severity === "high"
    || riskScore >= 85
  ) {
    return "approval-required-before-apply";
  }
  return "local-apply-eligible";
}

function buildEscalationState(
  finding: Finding,
  touchesIdentity: boolean,
  riskScore: number,
): FindingDecisionSummary["escalationState"] {
  if (getApprovalStatus(finding) === "escalated") {
    return "already-escalated";
  }
  if (touchesIdentity || finding.remediationStatus === "verified_partial" || riskScore >= 85) {
    return "required";
  }
  return "none";
}


function buildFixRecommendation(category: string): string {
  if (category.includes("sql injection")) {
    return "Prefer sink-level parameterization over input screening.";
  }
  if (category.includes("nosql")) {
    return "Prefer typed filter construction or operator allowlisting over generic sanitization.";
  }
  if (category.includes("command injection")) {
    return "Prefer structured argv execution with shell disabled.";
  }
  if (category.includes("ssrf") || category.includes("server-side request forgery")) {
    return "Prefer trusted destination validation and outbound client controls at the request boundary.";
  }
  if (category.includes("path traversal")) {
    return "Prefer canonical path containment checks against a trusted base directory.";
  }
  if (category.includes("open redirect")) {
    return "Prefer relative-only redirects or an explicit destination allowlist.";
  }
  if (category.includes("session")) {
    return "Prefer session rotation and invalidation in the auth transition itself, not only cookie hardening.";
  }
  if (category.includes("auth") || category.includes("authorization") || category.includes("privilege")) {
    return "Prefer a structural fix in the central auth or authorization path, not a local workaround.";
  }
  return "Prefer a code-level fix at the real trust boundary or sink instead of an early-path workaround.";
}

function buildPatchRecommendedAction({
  selectedStrategy,
  patch,
  findingDecision,
}: {
  selectedStrategy: RemediationStrategy | null | undefined;
  patch: PatchCandidate | null | undefined;
  findingDecision: FindingDecisionSummary | null;
}): string {
  if (selectedStrategy?.policyCompliant === false) {
    return "Do not treat this as a final security fix. Either switch to a compliant strategy or apply it only as a temporary workspace-scoped workaround.";
  }
  if (findingDecision?.policyOutcome === "blocked-by-policy") {
    return "Do not apply this patch yet. The finding is currently blocked by the decision policy and needs a stronger remediation path.";
  }
  if (findingDecision?.policyOutcome === "review-required") {
    return "Keep this patch in review until the finding-level approval path is satisfied, even if the diff itself looks localized.";
  }
  if (patch?.manualReviewRequired) {
    return "Apply only after manual review of the diff, residual risks, and surrounding logic.";
  }
  if (selectedStrategy?.recommended) {
    return "Approve this patch if the diff still matches the traced sink and the surrounding business logic.";
  }
  return "Review this alternate strategy carefully before approval because it is not the primary recommendation.";
}

function buildPatchApprovalPath({
  severity,
  touchesIdentity,
  selectedStrategy,
  mode,
  findingDecision,
  patch,
}: {
  severity: Finding["severity"];
  touchesIdentity: boolean;
  selectedStrategy: RemediationStrategy | null | undefined;
  mode: RemediationPlan["mode"];
  findingDecision: FindingDecisionSummary | null;
  patch: PatchCandidate | null | undefined;
}): string {
  if (findingDecision?.policyOutcome === "blocked-by-policy") {
    return findingDecision.approvalPath;
  }
  if (selectedStrategy?.policyCompliant === false) {
    return "Human review is required because the selected strategy is below the enforced security policy.";
  }
  if (findingDecision?.policyOutcome === "review-required") {
    return findingDecision.approvalPath;
  }
  if (patch?.manualReviewRequired && findingDecision?.approvalPath) {
    return findingDecision.approvalPath;
  }
  if (touchesIdentity || mode === "batch") {
    return "Human approval is recommended before broader rollout because this patch touches a higher-risk review path.";
  }
  if (severity === "critical" || severity === "high") {
    return "Workspace apply is acceptable after patch review, but export or merge should still receive human review.";
  }
  return "This patch is localized enough for workspace apply after review, with normal merge review afterward.";
}

function buildPatchRolloutGuidance({
  selectedStrategy,
  patch,
  findingDecision,
}: {
  selectedStrategy: RemediationStrategy | null | undefined;
  patch: PatchCandidate | null | undefined;
  findingDecision: FindingDecisionSummary | null;
}): string {
  if (findingDecision?.residualRiskState) {
    return findingDecision.residualRiskState;
  }
  if (selectedStrategy?.fixType === "risky_workaround") {
    return "Treat the current patch as exposure reduction, not final closure of the vulnerability class.";
  }
  if (patch?.residualRisks?.length) {
    return "Review residual risks before rollout; the diff improves the traced path but may not eliminate all related exposure.";
  }
  return "The patch is scoped to the traced file and should be re-verified through a fresh review run after application.";
}

function buildPatchDecisionStatus({
  findingDecision,
  selectedStrategy,
  patch,
}: {
  findingDecision: FindingDecisionSummary | null;
  selectedStrategy: RemediationStrategy | null | undefined;
  patch: PatchCandidate | null | undefined;
}): string {
  if (findingDecision?.policyOutcome === "blocked-by-policy") {
    return "Blocked by finding policy";
  }
  if (selectedStrategy?.policyCompliant === false) {
    return "Below enforced policy";
  }
  if (findingDecision?.policyOutcome === "review-required") {
    return "Finding requires approval review";
  }
  if (patch?.manualReviewRequired) {
    return "Manual review required";
  }
  return "Eligible for workspace apply";
}

function buildPatchApprovalState({
  findingDecision,
  selectedStrategy,
  patch,
}: {
  findingDecision: FindingDecisionSummary | null;
  selectedStrategy: RemediationStrategy | null | undefined;
  patch: PatchCandidate | null | undefined;
}): string {
  if (findingDecision?.approvalState) {
    return findingDecision.approvalState;
  }
  if (selectedStrategy?.policyCompliant === false) {
    return "Human review required";
  }
  if (patch?.manualReviewRequired) {
    return "Manual review required";
  }
  return "Standard review";
}

function buildPatchPolicyOutcome({
  findingDecision,
  selectedStrategy,
  patch,
}: {
  findingDecision: FindingDecisionSummary | null;
  selectedStrategy: RemediationStrategy | null | undefined;
  patch: PatchCandidate | null | undefined;
}): FindingDecisionSummary["policyOutcome"] {
  if (findingDecision?.policyOutcome) {
    return findingDecision.policyOutcome;
  }
  if (selectedStrategy?.policyCompliant === false || patch?.manualReviewRequired) {
    return "review-required";
  }
  return "auto-eligible";
}

function buildApprovalPath(finding: Finding, touchesIdentity: boolean): string {
  if (touchesIdentity) {
    return "Human approval is required for rollout because this finding touches identity or access-control behavior.";
  }
  if (finding.severity === "critical" || finding.severity === "high") {
    return "Human review is required before broader rollout. Workspace apply can proceed after patch review, but export or PR should still be reviewed.";
  }
  return "Workspace apply is eligible after patch review. Broader rollout should still be reviewed before merging.";
}

function buildApprovalAuditSummary(finding: Finding): FindingDecisionSummary["approvalAuditSummary"] {
  const approvalHistory = getApprovalHistory(finding);
  const latestEntry = approvalHistory.at(-1) ?? null;
  const status = getApprovalStatus(finding);
  return {
    status,
    label:
      status === "not_required"
        ? "No approval gate"
        : status === "pending"
          ? "Approval pending"
          : status === "approved"
            ? "Approval resolved"
            : status === "rejected"
              ? "Approval rejected"
              : "Escalated review",
    summary:
      status === "not_required"
        ? "This remediation path does not currently require a stored approval decision."
        : status === "pending"
          ? "This remediation path is waiting for an approval decision before workspace apply can proceed."
          : status === "approved"
            ? "This remediation path has a stored approval decision and can proceed within the current review cycle."
            : status === "rejected"
              ? "The last approval decision rejected this remediation path, so a different patch or a renewed review is required."
              : "This remediation path is held in escalated review and cannot proceed until that review is resolved.",
    note:
      latestEntry?.note
      || (status === "not_required"
        ? "No approval note is required for the current remediation path."
        : status === "pending"
          ? "Waiting for an explicit approval decision."
          : status === "approved"
            ? "The remediation path was approved for the current review cycle."
            : status === "rejected"
              ? "The remediation path was rejected during approval review."
              : "The remediation path remains under escalated review."),
    timestamp: latestEntry?.timestamp ?? null,
    resolutionCategory:
      status === "not_required"
        ? "not-required"
        : status === "pending"
          ? "awaiting-review"
          : status === "approved"
            ? "resolved"
            : status === "rejected"
              ? "rejected"
              : "held",
    source:
      status === "not_required"
        ? "policy-default"
        : status === "approved" || status === "rejected" || status === "escalated"
          ? "approval-controller"
          : "approval-queue",
  };
}

function getApprovalStatus(finding: Finding): Finding["approvalStatus"] {
  return finding.approvalStatus ?? "not_required";
}

function getApprovalHistory(finding: Finding): Finding["approvalHistory"] {
  return finding.approvalHistory ?? [];
}

function isSafeAutoPath(
  finding: Finding,
  touchesIdentity: boolean,
  riskScore: number,
): boolean {
  return (
    !touchesIdentity
    && finding.severity !== "critical"
    && finding.severity !== "high"
    && riskScore < 85
    && !["verified_partial", "patch_generated", "validation_failed", "rejected", "rolled_back"].includes(finding.remediationStatus)
  );
}

function buildRiskFactors(finding: Finding, touchesIdentity: boolean): string[] {
  const factors = [
    `${capitalize(finding.severity)} severity with ${finding.confidence}% model confidence.`,
    finding.impact,
  ];
  if (touchesIdentity) {
    factors.push("The issue touches identity, session, or authorization logic, which raises rollout risk.");
  } else if (finding.remediationStatus === "verified_partial" || finding.remediationStatus === "validation_failed") {
    factors.push("The current remediation state is incomplete, so the issue should stay open until a stronger result is confirmed.");
  } else {
    factors.push("The finding is still tied to a concrete source-to-sink path in the validated review result.");
  }
  return factors;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
