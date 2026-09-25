import type { Finding, FindingDecisionSummary, RemediationActionResult, RemediationExplanation, RemediationPlan } from "@/entities/finding/model/types";
import type { Session, SessionAnalysisBrief } from "@/entities/session/model/types";
import { fetchWithStartupRetry } from "@/shared/api/network";

// The desktop app runs the review engine in its own main process and hands the
// renderer the address it bound. The environment variable and the fallback stay
// for a renderer served outside Electron, where nothing is listening anyway.
const API_BASE_URL =
  (typeof window !== "undefined" ? window.electronAPI?.apiBaseUrl ?? null : null) ??
  import.meta.env.VITE_API_BASE_URL ??
  "http://127.0.0.1:9000/api/v1";

// The local API reads the user's source tree and can send it to a model
// provider, so it refuses anything that cannot present the launch token. It is
// never persisted; the main process regenerates it on every start.
const API_TOKEN = typeof window !== "undefined" ? window.electronAPI?.apiToken ?? null : null;

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
  verdict: "safe" | "issues_found";
  completedAt: string | null;
  errorMessage: string | null;
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

export interface WorkflowTeamPostureSummary {
  sessionCount: number;
  hotspotCount: number;
  criticalHotspots: number;
  controlDrag: number;
  riskDrag: number;
  coverageDrag: number;
  throughputDrag: number;
  topHotspotLabel: string;
}

export interface WorkflowServiceExposureSummary {
  sessionCount: number;
  hotspotCount: number;
  criticalHotspots: number;
  boundaryDrag: number;
  networkDrag: number;
  pathDrag: number;
  entrypointDrag: number;
  topHotspotLabel: string;
  topServices: Record<string, number>;
}

export interface WorkflowRepoHotspotItem {
  sessionId: string;
  repo: string;
  hotspotClass: string;
  priority: string;
  label: string;
}

export interface WorkflowTeamPostureItem {
  sessionId: string;
  repo: string;
  status: string;
  hotspotClass: string;
  priority: string;
  findingCount: number;
  coveragePercent: number;
}

export interface WorkflowServiceExposureItem {
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

export async function listSessions(): Promise<Session[]> {
  const data = await request<SessionApiResponse[]>("/sessions");
  return data.map(mapSession);
}

export async function startScan(payload: StartScanPayload): Promise<ScanSessionDetail> {
  const data = await request<ScanSessionDetailApiResponse>("/scans", {
    method: "POST",
    body: JSON.stringify({
      source_path: payload.sourcePath,
      target_type: payload.targetType,
      preset: payload.preset,
      scan_mode: payload.scanMode,
      interactive: payload.interactive ?? true,
    }),
  });
  return mapScanSessionDetail(data);
}

export async function getScanSession(sessionId: string): Promise<ScanSessionDetail> {
  const data = await request<ScanSessionDetailApiResponse>(`/scans/${sessionId}`);
  return mapScanSessionDetail(data);
}

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const data = await request<RuntimeSettingsApiResponse>("/settings/runtime");
  return mapRuntimeSettings(data);
}

export async function updateRuntimeSettings(payload: UpdateRuntimeSettingsPayload): Promise<RuntimeSettings> {
  const body: Record<string, unknown> = {};
  if (payload.defaultPreset !== undefined) body.default_preset = payload.defaultPreset;
  if (payload.defaultScanMode !== undefined) body.default_scan_mode = payload.defaultScanMode;
  if (payload.autoOpenResults !== undefined) body.auto_open_results = payload.autoOpenResults;
  if (payload.rememberSidebarState !== undefined) body.remember_sidebar_state = payload.rememberSidebarState;
  if (payload.motionProfile !== undefined) body.motion_profile = payload.motionProfile;
  if (payload.theme !== undefined) body.theme = payload.theme;
  if (payload.surfaceContrast !== undefined) body.surface_contrast = payload.surfaceContrast;
  if (payload.remediationMaxAttempts !== undefined) body.remediation_max_attempts = payload.remediationMaxAttempts;
  if (payload.remediationReuseExplanation !== undefined) body.remediation_reuse_explanation = payload.remediationReuseExplanation;
  if (payload.aiProvider !== undefined) body.ai_provider = payload.aiProvider;
  if (payload.aiApiKey !== undefined) body.ai_api_key = payload.aiApiKey;
  if (payload.aiBaseUrl !== undefined) body.ai_base_url = payload.aiBaseUrl;
  if (payload.aiModel !== undefined) body.ai_model = payload.aiModel;

  const data = await request<RuntimeSettingsApiResponse>("/settings/runtime", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return mapRuntimeSettings(data);
}

export async function listProviders(): Promise<ProviderInfo[]> {
  const data = await request<ProviderInfoApiResponse[]>("/settings/providers");
  return data.map((p) => ({ id: p.id, name: p.name, defaultBaseUrl: p.default_base_url, docsUrl: p.docs_url }));
}

export async function testProvider(payload: ProviderTestPayload): Promise<ProviderTestResult> {
  const data = await request<ProviderTestApiResponse>("/settings/providers/test", {
    method: "POST",
    body: JSON.stringify({ provider: payload.provider, api_key: payload.apiKey ?? null, base_url: payload.baseUrl ?? null, model: payload.model ?? null }),
  });
  return { ok: data.ok, message: data.message, latencyMs: data.latency_ms };
}

export async function listProviderModels(payload: ProviderTestPayload): Promise<ProviderModel[]> {
  const data = await request<ProviderModelsApiResponse>("/settings/providers/models", {
    method: "POST",
    body: JSON.stringify({ provider: payload.provider, api_key: payload.apiKey ?? null, base_url: payload.baseUrl ?? null }),
  });
  return data.models.map((m) => ({ id: m.id, name: m.name, created: m.created ?? null }));
}

export function subscribeToScanEvents(
  sessionId: string,
  handlers: {
    onSession: (detail: ScanSessionDetail) => void;
    onTerminal?: (detail: ScanSessionDetail) => void;
    onError?: () => void;
  },
): () => void {
  // `EventSource` cannot send headers, so the token travels as a query
  // parameter on this one route.
  const tokenQuery = API_TOKEN === null ? "" : `?token=${encodeURIComponent(API_TOKEN)}`;
  const source = new EventSource(`${API_BASE_URL}/scans/${sessionId}/events${tokenQuery}`);
  const handleDetail = (event: MessageEvent<string>, terminal: boolean) => {
    const parsed = JSON.parse(event.data) as ScanSessionDetailApiResponse;
    const detail = mapScanSessionDetail(parsed);
    handlers.onSession(detail);
    if (terminal) {
      handlers.onTerminal?.(detail);
      source.close();
    }
  };

  source.addEventListener("scan_progress", (event) => handleDetail(event as MessageEvent<string>, false));
  source.addEventListener("scan_completed", (event) => handleDetail(event as MessageEvent<string>, true));
  source.addEventListener("scan_failed", (event) => handleDetail(event as MessageEvent<string>, true));
  source.onerror = () => {
    source.close();
    handlers.onError?.();
  };

  return () => source.close();
}

export async function deleteScanSession(sessionId: string): Promise<void> {
  await request<void>(`/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export async function deleteAllScanSessions(): Promise<void> {
  await request<void>("/sessions", {
    method: "DELETE",
  });
}

export async function explainFinding(payload: ExplainFindingPayload): Promise<RemediationExplanation> {
  const data = await request<ExplanationApiResponse>("/remediation/explain", {
    method: "POST",
    body: JSON.stringify({
      session_id: payload.sessionId,
      finding_id: payload.findingId,
    }),
  });
  return mapExplanation(data);
}

export async function getRepoIntelligenceSummary(limit = 25): Promise<WorkflowRepoIntelligenceSummary> {
  const data = await request<WorkflowRepoIntelligenceSummaryApiResponse>(`/sessions/repo-intelligence-summary?limit=${limit}`);
  return mapWorkflowRepoIntelligenceSummary(data);
}

export async function getRepoHotspots(limit = 25): Promise<WorkflowRepoHotspotItem[]> {
  const data = await request<WorkflowRepoHotspotFeedApiResponse>(`/sessions/repo-hotspots?limit=${limit}`);
  return data.items.map(mapWorkflowRepoHotspotItem);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithStartupRetry(`${API_BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(API_TOKEN === null ? {} : { "X-CodeRadar-Token": API_TOKEN }),
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (error) {
    console.error("[CodeRadar] Network request failed", {
      path,
      method: init?.method ?? "GET",
      error,
    });
    throw error;
  }

  if (!response.ok) {
    const fallback = `Request failed with status ${response.status}`;
    let body: { detail?: string } | null = null;
    try {
      body = (await response.json()) as { detail?: string };
    } catch {
      body = null;
    }

    console.error("[CodeRadar] API request failed", {
      path,
      method: init?.method ?? "GET",
      status: response.status,
      ...(body ? { body } : {}),
    });

    const message =
      typeof body?.detail === "string" && body.detail.trim().length > 0
        ? body.detail
        : fallback;
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function mapScanSessionDetail(data: ScanSessionDetailApiResponse): ScanSessionDetail {
  return {
    session: mapSession(data.session),
    issues: data.issues,
    findings: data.findings.map(mapFinding),
    candidateFindings: data.candidate_findings.map(mapFinding),
    verdict: data.verdict,
    completedAt: data.completed_at,
    errorMessage: data.error_message,
  };
}

function mapSession(data: SessionApiResponse): Session {
  return {
    id: data.id,
    title: data.title,
    repo: data.repo,
    time: data.time,
    unread: data.unread,
    status: data.status,
    preview: data.preview,
    scanMode: data.scan_mode,
    criticalCount: data.critical_count,
    warningCount: data.warning_count,
    findingsCount: data.findings_count,
    candidateFindingsCount: data.candidate_findings_count,
    progress: data.progress,
    phaseProgress: data.phase_progress,
    progressMessage: data.progress_message,
    currentPhase: data.current_phase,
    elapsedSeconds: data.elapsed_seconds,
    progressLogs: data.progress_logs,
    progressCounters: data.progress_counters,
    runtimeMetrics: data.runtime_metrics,
    scanPlan: data.scan_plan,
    repositorySummary: data.repository_summary,
    analysisBrief: data.analysis_brief
      ? {
          scoreExplanation: data.analysis_brief.score_explanation,
          potentialRisks: data.analysis_brief.potential_risks,
          securityObservations: data.analysis_brief.security_observations,
          analysisLimitations: data.analysis_brief.analysis_limitations,
          attackThinking: data.analysis_brief.attack_thinking,
          nextSteps: data.analysis_brief.next_steps,
        }
      : null,
    repositoryInventory: data.repository_inventory,
    frameworkProfile: data.framework_profile,
    repositoryGraph: data.repository_graph,
    graphSummary: data.graph_summary,
    securityRegistry: data.security_registry,
    segmentationSummary: data.segmentation_summary,
    pathInventory: data.path_inventory,
    pathSummary: data.path_summary,
    reviewQueueSummary: data.review_queue_summary,
    annotations: data.annotations,
    annotationSummary: data.annotation_summary,
    coverageSnapshot: data.coverage_snapshot,
    coverageSummary: data.coverage_summary,
    coveragePercent: data.coverage_percent,
    reviewedFilesCount: data.reviewed_files_count,
    eligibleFilesCount: data.eligible_files_count,
    reviewedBlocksCount: data.reviewed_blocks_count,
    totalBlocksCount: data.total_blocks_count,
    reviewedLinesCount: data.reviewed_lines_count,
    totalLinesCount: data.total_lines_count,
    tracedPathsCount: data.traced_paths_count,
    totalPathsCount: data.total_paths_count,
    skippedFilesCount: data.skipped_files_count,
    highRiskFilesCount: data.high_risk_files_count,
    isSafe: data.is_safe,
    securityScore: data.security_score,
    scoreRationale: data.score_rationale,
    targetType: data.target_type,
    sourcePath: data.source_path,
    preset: data.preset,
    lastVerification: data.last_verification,
    workflowSummary: data.workflow_summary
      ? {
          state: data.workflow_summary.state,
          label: data.workflow_summary.label,
          summary: data.workflow_summary.summary,
          nextAction: data.workflow_summary.next_action,
          activeController: data.workflow_summary.active_controller,
          plannerStage: data.workflow_summary.planner_stage,
          recoverySummary: data.workflow_summary.recovery_summary
            ? {
                retryAvailable: Boolean(data.workflow_summary.recovery_summary.retry_available),
                retryableFindings: Number(data.workflow_summary.recovery_summary.retryable_findings ?? 0),
                attemptedStrategies: Number(data.workflow_summary.recovery_summary.attempted_strategies ?? 0),
                latestFailureReason: String(data.workflow_summary.recovery_summary.latest_failure_reason ?? ""),
                lastVerificationStatus:
                  typeof data.workflow_summary.recovery_summary.last_verification_status === "string"
                    ? data.workflow_summary.recovery_summary.last_verification_status
                    : null,
                recoveryState: data.workflow_summary.recovery_summary.recovery_state,
                nextTransition: data.workflow_summary.recovery_summary.next_transition,
                controllerStatus: data.workflow_summary.recovery_summary.controller_status,
                plannerReentryReady: Boolean(data.workflow_summary.recovery_summary.planner_reentry_ready),
              }
            : null,
          recoveryExecution: data.workflow_summary.recovery_execution
            ? {
                selectedPath: data.workflow_summary.recovery_execution.selected_path,
                executionState: data.workflow_summary.recovery_execution.execution_state,
                executionLane: data.workflow_summary.recovery_execution.execution_lane,
                reenteredPlanner: Boolean(data.workflow_summary.recovery_execution.reentered_planner),
                pathReason: String(data.workflow_summary.recovery_execution.path_reason ?? ""),
              }
            : null,
          memorySummary: data.workflow_summary.memory_summary
            ? {
                attemptedStrategyCount: Number(data.workflow_summary.memory_summary.attempted_strategy_count ?? 0),
                rejectedPathCount: Number(data.workflow_summary.memory_summary.rejected_path_count ?? 0),
                escalatedPathCount: Number(data.workflow_summary.memory_summary.escalated_path_count ?? 0),
                knownStrategyIds: Array.isArray(data.workflow_summary.memory_summary.known_strategy_ids)
                  ? data.workflow_summary.memory_summary.known_strategy_ids.map((item) => String(item))
                  : [],
                suppressedStrategyCount: Number(data.workflow_summary.memory_summary.suppressed_strategy_count ?? 0),
                suppressionState:
                  data.workflow_summary.memory_summary.suppression_state === "active" ? "active" : "clear",
                nextMemoryAction:
                  data.workflow_summary.memory_summary.next_memory_action === "generate-materially-different-patch"
                    ? "generate-materially-different-patch"
                    : "no-memory-block",
                recentConstraint: String(data.workflow_summary.memory_summary.recent_constraint ?? ""),
              }
            : null,
          operationsSummary: data.workflow_summary.operations_summary
            ? {
                currentLane: data.workflow_summary.operations_summary.current_lane,
                nextLane: data.workflow_summary.operations_summary.next_lane,
                pendingHandoff: Boolean(data.workflow_summary.operations_summary.pending_handoff),
                handoffReason: String(data.workflow_summary.operations_summary.handoff_reason ?? ""),
                activeItemCount: Number(data.workflow_summary.operations_summary.active_item_count ?? 0),
              }
            : null,
          operationsExecution: data.workflow_summary.operations_execution
            ? {
                currentHandoff: String(data.workflow_summary.operations_execution.current_handoff ?? ""),
                handoffStatus: data.workflow_summary.operations_execution.handoff_status,
                owningController: data.workflow_summary.operations_execution.owning_controller,
                pendingExecutionStep: String(data.workflow_summary.operations_execution.pending_execution_step ?? ""),
                stepCompletionState: String(data.workflow_summary.operations_execution.step_completion_state ?? ""),
              }
            : null,
          workflowClosure: data.workflow_summary.workflow_closure
            ? {
                closureState: data.workflow_summary.workflow_closure.closure_state,
                closureLabel: String(data.workflow_summary.workflow_closure.closure_label ?? ""),
                closureReason: String(data.workflow_summary.workflow_closure.closure_reason ?? ""),
                autonomousReady: Boolean(data.workflow_summary.workflow_closure.autonomous_ready),
                requiresHumanControl: Boolean(data.workflow_summary.workflow_closure.requires_human_control),
                nextClosureStep: String(data.workflow_summary.workflow_closure.next_closure_step ?? ""),
              }
            : null,
          blockingItems: data.workflow_summary.blocking_items,
        }
      : null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

function mapFinding(data: FindingApiResponse): Finding {
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

function mapFindingDecisionSummary(data: FindingDecisionSummaryApiResponse | null | undefined): FindingDecisionSummary | null {
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

function mapExplanation(data: ExplanationApiResponse): RemediationExplanation {
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

function mapRemediationPlan(data: RemediationPlanApiResponse): RemediationPlan {
  return {
    mode: data.mode,
    findingIds: data.finding_ids,
    reviewSummary: data.review_summary,
    explanation: data.explanation ? mapExplanation(data.explanation) : null,
    strategies: data.strategies.map((strategy) => ({
      id: strategy.id,
      label: strategy.label,
      kind: strategy.kind,
      confidence: strategy.confidence,
      impact: strategy.impact,
      effort: strategy.effort,
      summary: strategy.summary,
      rationale: strategy.rationale,
      diff: strategy.diff,
      recommended: strategy.recommended,
      fixType: strategy.fix_type,
      securityStrength: strategy.security_strength,
      regressionRisk: strategy.regression_risk,
      selectionReason: strategy.selection_reason,
      nonSelectionReason: strategy.non_selection_reason,
      residualRisks: strategy.residual_risks,
      policyCompliant: strategy.policy_compliant,
      policyViolations: strategy.policy_violations,
    })),
    recommendedStrategyId: data.recommended_strategy_id,
    patch: data.patch
      ? {
          file: data.patch.file,
          language: data.patch.language,
          summary: data.patch.summary,
          diff: data.patch.diff,
          validationNotes: data.patch.validation_notes,
          beforeSnippet: data.patch.before_snippet,
          afterSnippet: data.patch.after_snippet,
          fixType: data.patch.fix_type,
          rationale: data.patch.rationale,
          residualRisks: data.patch.residual_risks,
          manualReviewRequired: data.patch.manual_review_required,
        }
      : null,
    steps: data.steps.map((step) => ({
      id: step.id,
      title: step.title,
      status: step.status,
      agent: step.agent,
      details: step.details,
    })),
    metrics: data.metrics
      ? {
          file: data.metrics.file,
          vulnerabilityType: data.metrics.vulnerability_type,
          remediationMode: data.metrics.remediation_mode,
          analyzedLines: data.metrics.analyzed_lines,
          pathSteps: data.metrics.path_steps,
          evidenceLocation: data.metrics.evidence_location,
        }
      : null,
    score: data.score
      ? {
          total: data.score.total,
          strategyQuality: data.score.strategy_quality,
          fixCompleteness: data.score.fix_completeness,
          sinkAlignment: data.score.sink_alignment,
          residualRisk: data.score.residual_risk,
          confidence: data.score.confidence,
          rationale: data.score.rationale,
        }
      : null,
  };
}

function mapRemediationExecution(data: RemediationExecutionApiResponse): RemediationExecutionResult {
  return {
    action: {
      findingId: data.action.finding_id,
      status: data.action.status,
      file: data.action.file,
      appliedStrategyId: data.action.applied_strategy_id,
      fixType: data.action.fix_type,
      validationNotes: data.action.validation_notes,
      manualEditApplied: data.action.manual_edit_applied,
      checkpointId: data.action.checkpoint_id,
      rollbackAvailable: data.action.rollback_available,
      verificationStatus: data.action.verification_status,
      verificationNotes: data.action.verification_notes,
      verificationConfidence: data.action.verification_confidence,
      verificationConfidenceValid: data.action.verification_confidence_valid,
      approvalGateOutcome: data.action.approval_gate_outcome,
      approvalGateReason: data.action.approval_gate_reason,
      writeScope: data.action.write_scope,
      networkPolicy: data.action.network_policy,
    },
    session: mapSession(data.session),
    findings: data.findings.map(mapFinding),
    candidateFindings: data.candidate_findings.map(mapFinding),
  };
}

function mapRuntimeSettings(data: RuntimeSettingsApiResponse): RuntimeSettings {
  return {
    defaultPreset: data.default_preset,
    defaultScanMode: data.default_scan_mode,
    autoOpenResults: data.auto_open_results,
    rememberSidebarState: data.remember_sidebar_state,
    motionProfile: data.motion_profile,
    theme: data.theme,
    surfaceContrast: data.surface_contrast,
    remediationMaxAttempts: data.remediation_max_attempts,
    remediationReuseExplanation: data.remediation_reuse_explanation,
    aiProvider: (data as unknown as Record<string, unknown>).ai_provider as string | null | undefined ?? null,
    aiModel: (data as unknown as Record<string, unknown>).ai_model as string | null | undefined ?? null,
    aiBaseUrl: (data as unknown as Record<string, unknown>).ai_base_url as string | null | undefined ?? null,
    aiApiKeyMasked: (data as unknown as Record<string, unknown>).ai_api_key_masked as string | null | undefined ?? null,
    aiHasKey: Boolean((data as unknown as Record<string, unknown>).ai_has_key),
    updatedAt: data.updated_at,
  };
}

function mapWorkflowRepoIntelligenceSummary(
  data: WorkflowRepoIntelligenceSummaryApiResponse,
): WorkflowRepoIntelligenceSummary {
  return {
    sessionCount: data.session_count,
    hotspotCount: data.hotspot_count,
    criticalHotspots: data.critical_hotspots,
    identityZones: data.identity_zones,
    exposureZones: data.exposure_zones,
    dataZones: data.data_zones,
    coverageZones: data.coverage_zones,
    topHotspotLabel: data.top_hotspot_label,
    topRepositories: data.top_repositories,
  };
}

function mapWorkflowTeamPostureSummary(data: WorkflowTeamPostureSummaryApiResponse): WorkflowTeamPostureSummary {
  return {
    sessionCount: data.session_count,
    hotspotCount: data.hotspot_count,
    criticalHotspots: data.critical_hotspots,
    controlDrag: data.control_drag,
    riskDrag: data.risk_drag,
    coverageDrag: data.coverage_drag,
    throughputDrag: data.throughput_drag,
    topHotspotLabel: data.top_hotspot_label,
  };
}

function mapWorkflowServiceExposureSummary(
  data: WorkflowServiceExposureSummaryApiResponse,
): WorkflowServiceExposureSummary {
  return {
    sessionCount: data.session_count,
    hotspotCount: data.hotspot_count,
    criticalHotspots: data.critical_hotspots,
    boundaryDrag: data.boundary_drag,
    networkDrag: data.network_drag,
    pathDrag: data.path_drag,
    entrypointDrag: data.entrypoint_drag,
    topHotspotLabel: data.top_hotspot_label,
    topServices: data.top_services,
  };
}

function mapWorkflowRepoHotspotItem(data: WorkflowRepoHotspotItemApiResponse): WorkflowRepoHotspotItem {
  return {
    sessionId: data.session_id,
    repo: data.repo,
    hotspotClass: data.hotspot_class,
    priority: data.priority,
    label: data.label,
  };
}

function mapWorkflowTeamPostureItem(data: WorkflowTeamPostureItemApiResponse): WorkflowTeamPostureItem {
  return {
    sessionId: data.session_id,
    repo: data.repo,
    status: data.status,
    hotspotClass: data.hotspot_class,
    priority: data.priority,
    findingCount: data.finding_count,
    coveragePercent: data.coverage_percent,
  };
}

function mapWorkflowServiceExposureItem(data: WorkflowServiceExposureItemApiResponse): WorkflowServiceExposureItem {
  return {
    sessionId: data.session_id,
    repo: data.repo,
    hotspotClass: data.hotspot_class,
    priority: data.priority,
    label: data.label,
  };
}

interface SessionApiResponse {
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

interface ScanSessionDetailApiResponse {
  session: SessionApiResponse;
  issues: ScanSessionDetail["issues"];
  findings: FindingApiResponse[];
  candidate_findings: FindingApiResponse[];
  verdict: ScanSessionDetail["verdict"];
  completed_at: string | null;
  error_message: string | null;
}

interface FindingApiResponse {
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

interface FindingDecisionSummaryApiResponse {
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

interface ExplanationApiResponse {
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

interface RemediationPlanApiResponse {
  mode: "single" | "batch";
  finding_ids: string[];
  review_summary: string;
  explanation: ExplanationApiResponse | null;
  strategies: Array<{
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
    fix_type: "full_fix" | "partial_mitigation" | "temporary_guard" | "risky_workaround";
    security_strength: "high" | "medium" | "low";
    regression_risk: "low" | "medium" | "high";
    selection_reason: string;
    non_selection_reason: string;
    residual_risks: string[];
    policy_compliant: boolean;
    policy_violations: string[];
  }>;
  recommended_strategy_id: string | null;
  patch: {
    file: string;
    language: string;
    summary: string;
    diff: string;
    validation_notes: string[];
    before_snippet: string;
    after_snippet: string;
    fix_type: "full_fix" | "partial_mitigation" | "temporary_guard" | "risky_workaround";
    rationale: string;
    residual_risks: string[];
    manual_review_required: boolean;
  } | null;
  steps: Array<{
    id: string;
    title: string;
    status: "done" | "running" | "pending";
    agent: string;
    details: string[];
  }>;
  metrics: {
    file: string;
    vulnerability_type: string;
    remediation_mode: "single" | "batch";
    analyzed_lines: number;
    path_steps: number;
    evidence_location: string;
  } | null;
  score: {
    total: number;
    strategy_quality: number;
    fix_completeness: number;
    sink_alignment: number;
    residual_risk: number;
    confidence: number;
    rationale: string[];
  } | null;
}

interface RemediationExecutionApiResponse {
  action: {
    finding_id: string;
    status: "applied" | "rejected" | "validation_failed" | "rolled_back";
    file: string;
    applied_strategy_id: string | null;
    fix_type: "full_fix" | "partial_mitigation" | "temporary_guard" | "risky_workaround";
    validation_notes: string[];
    manual_edit_applied: boolean;
    checkpoint_id: string | null;
    rollback_available: boolean;
    verification_status: "verified" | "manual_review_required" | "not_run" | "rolled_back";
    verification_notes: string[];
    verification_confidence: number | null;
    verification_confidence_valid: boolean;
    approval_gate_outcome: "auto-approved" | "review-required" | "blocked-by-policy";
    approval_gate_reason: string;
    write_scope: string;
    network_policy: string;
  };
  session: SessionApiResponse;
  findings: FindingApiResponse[];
  candidate_findings: FindingApiResponse[];
}

interface RuntimeSettingsApiResponse {
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

interface ProviderInfoApiResponse {
  id: string;
  name: string;
  default_base_url: string | null;
  docs_url: string | null;
}

interface ProviderTestApiResponse {
  ok: boolean;
  message: string;
  latency_ms: number | null;
}

interface ProviderModelsApiResponse {
  models: Array<{ id: string; name: string; created?: number | null }>;
}

interface WorkflowRepoIntelligenceSummaryApiResponse {
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

interface WorkflowTeamPostureSummaryApiResponse {
  session_count: number;
  hotspot_count: number;
  critical_hotspots: number;
  control_drag: number;
  risk_drag: number;
  coverage_drag: number;
  throughput_drag: number;
  top_hotspot_label: string;
}

interface WorkflowServiceExposureSummaryApiResponse {
  session_count: number;
  hotspot_count: number;
  critical_hotspots: number;
  boundary_drag: number;
  network_drag: number;
  path_drag: number;
  entrypoint_drag: number;
  top_hotspot_label: string;
  top_services: Record<string, number>;
}

interface WorkflowRepoHotspotItemApiResponse {
  session_id: string;
  repo: string;
  hotspot_class: string;
  priority: string;
  label: string;
}

interface WorkflowRepoHotspotFeedApiResponse {
  items: WorkflowRepoHotspotItemApiResponse[];
}

interface WorkflowTeamPostureItemApiResponse {
  session_id: string;
  repo: string;
  status: string;
  hotspot_class: string;
  priority: string;
  finding_count: number;
  coverage_percent: number;
}

interface WorkflowTeamPostureFeedApiResponse {
  items: WorkflowTeamPostureItemApiResponse[];
}

interface WorkflowServiceExposureItemApiResponse {
  session_id: string;
  repo: string;
  hotspot_class: string;
  priority: string;
  label: string;
}

interface WorkflowServiceExposureFeedApiResponse {
  items: WorkflowServiceExposureItemApiResponse[];
}
