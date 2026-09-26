import type {
  Finding,
  FindingDecisionSummary,
  RemediationExplanation,
} from "@/entities/finding/model/types";
import type { Session, SessionAnalysisBrief } from "@/entities/session/model/types";

/**
 * The contract between the renderer and the local review engine.
 *
 * Two halves, deliberately kept apart in one place:
 *
 * - the **app shapes** the UI reads (`camelCase`), and
 * - the **wire shapes** the engine sends (`snake_case`).
 *
 * `mappers/` is the only place the two meet, so a field rename on either side is
 * one file's problem instead of every call site's.
 */

/* ------------------------------------------------------------------ *
 * App shapes — what the renderer's components receive
 * ------------------------------------------------------------------ */

export interface StartScanPayload {
  sourcePath: string;
  targetType: "folder" | "file";
  preset: "safe" | "balanced" | "aggressive";
  scanMode: "fast" | "deep";
  interactive?: boolean;
}

export interface RuntimeSettings {
  defaultPreset: "safe" | "balanced" | "aggressive";
  defaultScanMode: "fast" | "deep";
  autoOpenResults: boolean;
  rememberSidebarState: boolean;
  motionProfile: "fluid" | "reduced" | "instant";
  theme: "light" | "dark" | "system";
  surfaceContrast: "soft" | "standard";
  remediationMaxAttempts: number;
  remediationReuseExplanation: boolean;
  aiProvider?: string | null;
  aiModel?: string | null;
  aiBaseUrl?: string | null;
  aiApiKeyMasked?: string | null;
  aiHasKey?: boolean;
  updatedAt: string;
}

export interface UpdateRuntimeSettingsPayload {
  defaultPreset?: "safe" | "balanced" | "aggressive";
  defaultScanMode?: "fast" | "deep";
  autoOpenResults?: boolean;
  rememberSidebarState?: boolean;
  motionProfile?: "fluid" | "reduced" | "instant";
  theme?: "light" | "dark" | "system";
  surfaceContrast?: "soft" | "standard";
  remediationMaxAttempts?: number;
  remediationReuseExplanation?: boolean;
  aiProvider?: string | null;
  aiApiKey?: string | null;
  aiBaseUrl?: string | null;
  aiModel?: string | null;
}

export interface ProviderInfo {
  id: string;
  name: string;
  defaultBaseUrl: string | null;
  docsUrl: string | null;
}

export interface ProviderTestPayload {
  provider: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  model?: string | null;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number | null;
}

export interface ProviderModel {
  id: string;
  name: string;
  created?: number | null;
}

export interface ScanSessionDetail {
  session: Session;
  issues: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  findings: Finding[];
  candidateFindings: Finding[];
  /**
   * Every candidate the review bar dropped, with the reason behind each one.
   *
   * Deliberately not a `Finding`: a dropped candidate has no severity, no impact
   * and no fix, and filling those in would present a refused claim as a finding.
   * Keeping the reasons visible is what makes a refusal distinguishable from a
   * defect the review never saw.
   */
  rejectedCandidates: RejectedCandidateSummary[];
  /** The engine's own tally of rejections by reason. */
  rejectionsByReason: Record<string, number>;
  /**
   * How complete the review is, or null when the engine did not report it.
   *
   * Null is not `complete`: a response that never said whether every stage ran
   * cannot be used to claim the code is clean. Only `"complete"` may be treated
   * as a finished, trustworthy review.
   */
  reviewState: ReviewState | null;
  /** Why the review is not complete. Never rendered as a finding. */
  limitations: ReviewLimitationSummary[];
  /** What the model stage did, or null when it did not run at all. */
  aiReview: AiReviewSummary | null;
  verdict: "safe" | "issues_found";
  completedAt: string | null;
  errorMessage: string | null;
}

/** The engine's canonical review states. */
export type ReviewState = "complete" | "partial" | "degraded" | "failed";

export interface ReviewLimitationSummary {
  /** The engine's machine code, e.g. `ai-response-invalid`. */
  code: string;
  /** One sentence a reviewer can act on. */
  detail: string;
  /** How many things the sentence is about, when it has a count. */
  count: number | null;
}

/**
 * What the model stage did, per call.
 *
 * `invalid` is a response that could not be read and `unavailable` is a call that
 * produced none. They are reported apart from `empty`, which is the model saying
 * a file holds no defect — a real answer, and the only kind that may be read as
 * clean code.
 */
export interface AiReviewSummary {
  attempted: number;
  valid: number;
  empty: number;
  partial: number;
  invalid: number;
  unavailable: number;
  entriesDropped: number;
  notSent: number;
}

export interface RejectedCandidateSummary {
  title: string;
  file: string;
  line: number;
  lineEnd: number;
  /** The engine's machine-readable reason, e.g. `evidence-not-in-source`. */
  reason: string;
  detail: string;
  /** Present only when the evidence gate is what dropped the candidate. */
  diagnostics: RejectionComparison | null;
}

export interface RejectionComparison {
  evidence: string | null;
  quotes: string[];
  quotesFound: boolean[];
  comparedFile: string | null;
  comparedChars: number | null;
  /** True when no quote was usable, so a file reference was the only check run. */
  usedFileReference: boolean;
  axis: string | null;
  severity: string | null;
  confidence: number | null;
}

export interface WorkflowRepoIntelligenceSummary {
  sessionCount: number;
  hotspotCount: number;
  criticalHotspots: number;
  identityZones: number;
  exposureZones: number;
  dataZones: number;
  coverageZones: number;
  topHotspotLabel: string;
  topRepositories: Record<string, number>;
}

export interface WorkflowRepoHotspotItem {
  sessionId: string;
  repo: string;
  hotspotClass: string;
  priority: string;
  label: string;
}

export interface ExplainFindingPayload {
  sessionId: string;
  findingId: string;
}

/* ------------------------------------------------------------------ *
 * Wire shapes — what the engine actually sends
 * ------------------------------------------------------------------ */

export interface SessionApiResponse {
  id: string;
  title: string;
  repo: string;
  time: string;
  unread: boolean;
  status: Session["status"];
  preview: string;
  scan_mode: Session["scanMode"];
  critical_count: number;
  warning_count: number;
  findings_count: number;
  candidate_findings_count: number;
  progress: number;
  phase_progress: number;
  progress_message: string;
  current_phase: string;
  elapsed_seconds: number;
  progress_logs: string[];
  progress_counters: Record<string, unknown> | null;
  runtime_metrics: Record<string, unknown> | null;
  scan_plan: Record<string, unknown> | null;
  repository_summary: string | null;
  analysis_brief: {
    score_explanation: SessionAnalysisBrief["scoreExplanation"];
    potential_risks: SessionAnalysisBrief["potentialRisks"];
    security_observations: SessionAnalysisBrief["securityObservations"];
    analysis_limitations: SessionAnalysisBrief["analysisLimitations"];
    attack_thinking: SessionAnalysisBrief["attackThinking"];
    next_steps: SessionAnalysisBrief["nextSteps"];
  } | null;
  repository_inventory: Record<string, unknown> | null;
  framework_profile: Record<string, unknown> | null;
  repository_graph: Record<string, unknown> | null;
  graph_summary: Record<string, unknown> | null;
  security_registry: Record<string, unknown> | null;
  segmentation_summary: Record<string, unknown> | null;
  path_inventory: Record<string, unknown> | null;
  path_summary: Record<string, unknown> | null;
  review_queue_summary: Record<string, unknown> | null;
  annotations: Session["annotations"];
  annotation_summary: Record<string, unknown> | null;
  coverage_snapshot: Record<string, unknown> | null;
  coverage_summary: string | null;
  coverage_percent: number;
  reviewed_files_count: number;
  eligible_files_count: number;
  reviewed_blocks_count: number;
  total_blocks_count: number;
  reviewed_lines_count: number;
  total_lines_count: number;
  traced_paths_count: number;
  total_paths_count: number;
  skipped_files_count: number;
  high_risk_files_count: number;
  is_safe: boolean;
  security_score: number | null;
  score_rationale: Record<string, unknown> | null;
  target_type: Session["targetType"];
  source_path: string;
  preset: Session["preset"];
  last_verification: Record<string, unknown> | null;
  workflow_summary: {
    state: NonNullable<Session["workflowSummary"]>["state"];
    label: string;
    summary: string;
    next_action: string;
    active_controller: NonNullable<Session["workflowSummary"]>["activeController"];
    planner_stage: NonNullable<Session["workflowSummary"]>["plannerStage"];
    recovery_summary: {
      retry_available: boolean;
      retryable_findings: number;
      attempted_strategies: number;
      latest_failure_reason: string;
      last_verification_status: string | null;
      recovery_state: NonNullable<NonNullable<Session["workflowSummary"]>["recoverySummary"]>["recoveryState"];
      next_transition: NonNullable<NonNullable<Session["workflowSummary"]>["recoverySummary"]>["nextTransition"];
      controller_status: NonNullable<NonNullable<Session["workflowSummary"]>["recoverySummary"]>["controllerStatus"];
      planner_reentry_ready: boolean;
    } | null;
    recovery_execution: {
      selected_path: NonNullable<NonNullable<Session["workflowSummary"]>["recoveryExecution"]>["selectedPath"];
      execution_state: NonNullable<NonNullable<Session["workflowSummary"]>["recoveryExecution"]>["executionState"];
      execution_lane: NonNullable<NonNullable<Session["workflowSummary"]>["recoveryExecution"]>["executionLane"];
      reentered_planner: boolean;
      path_reason: string;
    } | null;
    memory_summary: {
      attempted_strategy_count: number;
      rejected_path_count: number;
      escalated_path_count: number;
      known_strategy_ids: string[];
      suppressed_strategy_count: number;
      suppression_state: "clear" | "active";
      next_memory_action: "no-memory-block" | "generate-materially-different-patch";
      recent_constraint: string;
    } | null;
    operations_summary: {
      current_lane: NonNullable<NonNullable<Session["workflowSummary"]>["operationsSummary"]>["currentLane"];
      next_lane: NonNullable<NonNullable<Session["workflowSummary"]>["operationsSummary"]>["nextLane"];
      pending_handoff: boolean;
      handoff_reason: string;
      active_item_count: number;
    } | null;
    operations_execution: {
      current_handoff: string;
      handoff_status: NonNullable<NonNullable<Session["workflowSummary"]>["operationsExecution"]>["handoffStatus"];
      owning_controller: NonNullable<NonNullable<Session["workflowSummary"]>["operationsExecution"]>["owningController"];
      pending_execution_step: string;
      step_completion_state: string;
    } | null;
    workflow_closure: {
      closure_state: NonNullable<NonNullable<Session["workflowSummary"]>["workflowClosure"]>["closureState"];
      closure_label: string;
      closure_reason: string;
      autonomous_ready: boolean;
      requires_human_control: boolean;
      next_closure_step: string;
    } | null;
    blocking_items: number;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface ScanSessionDetailApiResponse {
  session: SessionApiResponse;
  issues: ScanSessionDetail["issues"];
  findings: FindingApiResponse[];
  candidate_findings: FindingApiResponse[];
  rejected_candidates?: RejectedCandidateApiResponse[];
  rejections_by_reason?: Record<string, number>;
  review_state?: ReviewState;
  review_limitations?: { code: string; detail: string; count: number | null }[];
  ai_review?: {
    attempted: number;
    valid: number;
    empty: number;
    partial: number;
    invalid: number;
    unavailable: number;
    entries_dropped: number;
    not_sent: number;
  } | null;
  verdict: ScanSessionDetail["verdict"];
  completed_at: string | null;
  error_message: string | null;
}

export interface RejectedCandidateApiResponse {
  title: string;
  file: string;
  line: number;
  line_end: number;
  reason: string;
  detail: string;
  diagnostics: {
    evidence: string | null;
    quotes: string[];
    quotes_found: boolean[];
    compared_file: string | null;
    compared_chars: number | null;
    used_file_reference: boolean;
    axis: string | null;
    severity: string | null;
    confidence: number | null;
  } | null;
}

export interface FindingApiResponse {
  id: string;
  severity: Finding["severity"];
  title: string;
  file: string;
  line: number;
  line_end: number;
  category: string;
  confidence: number;
  summary: string;
  impact: string;
  explanation: string;
  evidence: string;
  attack_simulation: {
    input: string;
    execution: string;
    result: string;
  };
  audit_log: string[];
  fix_suggestions: Finding["fixSuggestions"];
  remediation_status: Finding["remediationStatus"];
  approval_status: Finding["approvalStatus"];
  approval_history: Finding["approvalHistory"];
  applied_strategy_id: string | null;
  remediation_notes: string[];
  attempted_strategy_ids: string[];
  decision_summary: FindingDecisionSummaryApiResponse | null;
}

export interface FindingDecisionSummaryApiResponse {
  validation_label: string;
  validation_note: string;
  risk_score: number;
  risk_label: string;
  triage_band: string;
  triage_rank: number;
  execution_disposition: string;
  approval_state: string;
  policy_outcome: "auto-eligible" | "review-required" | "blocked-by-policy";
  policy_reason: string;
  stop_state: "continue-remediation" | "hold-for-review" | "stop-and-regenerate" | "ready-for-closure-review";
  apply_readiness: "local-apply-eligible" | "approval-required-before-apply" | "blocked-before-apply";
  escalation_state: "none" | "required" | "already-escalated";
  policy_summary: {
    posture: "allow" | "review" | "block";
    label: string;
    summary: string;
    auto_path_state: "eligible" | "gated" | "forbidden";
    human_path_state: "standard-review" | "approval-required" | "approved-review-cycle" | "escalated-review" | "regenerate-required";
    next_control: "continue-standard-review" | "collect-approval" | "proceed-with-local-apply" | "resolve-escalation" | "generate-a-stronger-patch";
  };
  residual_risk_state: string;
  recommended_action: string;
  fix_recommendation: string;
  approval_path: string;
  approval_audit_summary: {
    status: Finding["approvalStatus"];
    label: string;
    summary: string;
    note: string;
    timestamp: string | null;
    resolution_category: "not-required" | "awaiting-review" | "resolved" | "rejected" | "held";
    source: "policy-default" | "approval-queue" | "approval-controller";
  };
  risk_factors: string[];
}

export interface ExplanationApiResponse {
  finding_id: string;
  summary: string;
  exploit_scenario: string;
  request_example: string;
  payload_example: string;
  attack_steps: string[];
  entry_point: string;
  execution_path: string;
  sink: string;
  impact: string;
}

export interface RuntimeSettingsApiResponse {
  default_preset: RuntimeSettings["defaultPreset"];
  default_scan_mode: RuntimeSettings["defaultScanMode"];
  auto_open_results: boolean;
  remember_sidebar_state: boolean;
  motion_profile: RuntimeSettings["motionProfile"];
  theme: RuntimeSettings["theme"];
  surface_contrast: RuntimeSettings["surfaceContrast"];
  remediation_max_attempts: number;
  remediation_reuse_explanation: boolean;
  ai_provider?: string | null;
  ai_model?: string | null;
  ai_base_url?: string | null;
  ai_api_key_masked?: string | null;
  ai_has_key?: boolean;
  updated_at: string;
}

export interface ProviderInfoApiResponse {
  id: string;
  name: string;
  default_base_url: string | null;
  docs_url: string | null;
}

export interface ProviderTestApiResponse {
  ok: boolean;
  message: string;
  latency_ms: number | null;
}

export interface ProviderModelsApiResponse {
  models: Array<{ id: string; name: string; created?: number | null }>;
}

export interface WorkflowRepoIntelligenceSummaryApiResponse {
  session_count: number;
  hotspot_count: number;
  critical_hotspots: number;
  identity_zones: number;
  exposure_zones: number;
  data_zones: number;
  coverage_zones: number;
  top_hotspot_label: string;
  top_repositories: Record<string, number>;
}

export interface WorkflowRepoHotspotItemApiResponse {
  session_id: string;
  repo: string;
  hotspot_class: string;
  priority: string;
  label: string;
}

export interface WorkflowRepoHotspotFeedApiResponse {
  items: WorkflowRepoHotspotItemApiResponse[];
}
