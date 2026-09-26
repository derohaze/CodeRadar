import type {
  Finding,
  FindingDecisionSummary,
  RemediationExplanation,
} from "@/entities/finding/model/types";
import type {
  ExplanationApiResponse,
  FindingApiResponse,
  FindingDecisionSummaryApiResponse,
  RejectedCandidateApiResponse,
  RejectedCandidateSummary,
} from "@/shared/api/contract";

/** A finding, a dropped candidate and the remediation explanation, as the app reads them. */

export function mapRejectedCandidate(data: RejectedCandidateApiResponse): RejectedCandidateSummary {
  const line = Number.isFinite(data.line) ? data.line : 0;
  const rawEnd = Number.isFinite(data.line_end) ? data.line_end : line;
  const comparison = data.diagnostics;

  return {
    title: data.title,
    file: data.file,
    line,
    lineEnd: Math.max(line, rawEnd),
    reason: data.reason,
    detail: data.detail,
    diagnostics:
      comparison === null || comparison === undefined
        ? null
        : {
            evidence: comparison.evidence,
            quotes: comparison.quotes ?? [],
            quotesFound: comparison.quotes_found ?? [],
            comparedFile: comparison.compared_file,
            comparedChars: comparison.compared_chars,
            usedFileReference: comparison.used_file_reference === true,
            axis: comparison.axis,
            severity: comparison.severity,
            confidence: comparison.confidence,
          },
  };
}

export function mapFinding(data: FindingApiResponse): Finding {
  return {
    id: data.id,
    severity: data.severity,
    title: data.title,
    file: data.file,
    line: data.line,
    lineEnd: data.line_end,
    category: data.category,
    confidence: data.confidence,
    summary: data.summary,
    impact: data.impact,
    explanation: data.explanation,
    evidence: data.evidence,
    attackSimulation: {
      input: data.attack_simulation.input,
      execution: data.attack_simulation.execution,
      result: data.attack_simulation.result,
    },
    auditLog: data.audit_log,
    fixSuggestions: data.fix_suggestions,
    remediationStatus: data.remediation_status,
    approvalStatus: data.approval_status,
    approvalHistory: data.approval_history,
    appliedStrategyId: data.applied_strategy_id,
    remediationNotes: data.remediation_notes,
    attemptedStrategyIds: data.attempted_strategy_ids,
    decisionSummary: mapFindingDecisionSummary(data.decision_summary),
  };
}

export function mapFindingDecisionSummary(
  data: FindingDecisionSummaryApiResponse | null | undefined,
): FindingDecisionSummary | null {
  if (!data) return null;
  return {
    validationLabel: data.validation_label,
    validationNote: data.validation_note,
    riskScore: data.risk_score,
    riskLabel: data.risk_label,
    triageBand: data.triage_band,
    triageRank: data.triage_rank,
    executionDisposition: data.execution_disposition,
    approvalState: data.approval_state,
    policyOutcome: data.policy_outcome,
    policyReason: data.policy_reason,
    stopState: data.stop_state,
    applyReadiness: data.apply_readiness,
    escalationState: data.escalation_state,
    policySummary: {
      posture: data.policy_summary.posture,
      label: data.policy_summary.label,
      summary: data.policy_summary.summary,
      autoPathState: data.policy_summary.auto_path_state,
      humanPathState: data.policy_summary.human_path_state,
      nextControl: data.policy_summary.next_control,
    },
    residualRiskState: data.residual_risk_state,
    recommendedAction: data.recommended_action,
    fixRecommendation: data.fix_recommendation,
    approvalPath: data.approval_path,
    approvalAuditSummary: {
      status: data.approval_audit_summary.status,
      label: data.approval_audit_summary.label,
      summary: data.approval_audit_summary.summary,
      note: data.approval_audit_summary.note,
      timestamp: data.approval_audit_summary.timestamp,
      resolutionCategory: data.approval_audit_summary.resolution_category,
      source: data.approval_audit_summary.source,
    },
    riskFactors: data.risk_factors,
  };
}

export function mapExplanation(data: ExplanationApiResponse): RemediationExplanation {
  return {
    findingId: data.finding_id,
    summary: data.summary,
    exploitScenario: data.exploit_scenario,
    requestExample: data.request_example,
    payloadExample: data.payload_example,
    attackSteps: data.attack_steps,
    entryPoint: data.entry_point,
    executionPath: data.execution_path,
    sink: data.sink,
    impact: data.impact,
  };
}
