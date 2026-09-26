import type { Session } from "@/entities/session/model/types";
import type {
  ScanSessionDetail,
  ScanSessionDetailApiResponse,
  SessionApiResponse,
} from "@/shared/api/contract";
import { mapFinding, mapRejectedCandidate } from "@/shared/api/mappers/finding";

/**
 * The scan session, wire shape to app shape.
 *
 * Every optional field is read defensively: the renderer can be newer than the
 * engine it talks to, and a missing field must not take a whole screen down.
 */

export function mapScanSessionDetail(data: ScanSessionDetailApiResponse): ScanSessionDetail {
  return {
    session: mapSession(data.session),
    issues: data.issues,
    findings: data.findings.map(mapFinding),
    candidateFindings: data.candidate_findings.map(mapFinding),
    // An engine older than this field answers without it, and a dropped candidate
    // is not worth failing the whole screen for.
    rejectedCandidates: (data.rejected_candidates ?? []).map(mapRejectedCandidate),
    rejectionsByReason: data.rejections_by_reason ?? {},
    // Absent rather than guessed: an engine that did not report a state has not
    // said the review was complete.
    reviewState: data.review_state ?? null,
    limitations: (data.review_limitations ?? []).map((limitation) => ({
      code: limitation.code,
      detail: limitation.detail,
      count: limitation.count,
    })),
    aiReview:
      data.ai_review === null || data.ai_review === undefined
        ? null
        : {
            attempted: data.ai_review.attempted,
            valid: data.ai_review.valid,
            empty: data.ai_review.empty,
            partial: data.ai_review.partial,
            invalid: data.ai_review.invalid,
            unavailable: data.ai_review.unavailable,
            entriesDropped: data.ai_review.entries_dropped,
            notSent: data.ai_review.not_sent,
          },
    verdict: data.verdict,
    completedAt: data.completed_at,
    errorMessage: data.error_message,
  };
}

export function mapSession(data: SessionApiResponse): Session {
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
