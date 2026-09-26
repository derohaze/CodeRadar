import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import type { Finding } from "@/entities/finding/model/types";
import { buildApprovalQueue } from "@/entities/finding/lib/approval-queue";
import { orderFindingsByDecisionPriority } from "@/entities/finding/lib/finding-triage";
import { getRemediationStatusLabel, getRemediationStatusTone } from "@/entities/finding/lib/remediation-status";
import {
  formatRejectedLocation,
  getRejectionExplanation,
  getRejectionReasonLabel,
  groupRejectedCandidates,
} from "@/entities/finding/lib/rejected-candidate";
import type { RejectedCandidateGroup } from "@/entities/finding/lib/rejected-candidate";
import type { SessionAnnotation } from "@/entities/session/model/types";
import { SeverityBadge } from "@/entities/finding/ui/SeverityBadge";
import {
  describeReviewCompleteness,
  getLimitationLabel,
  getReviewStateLabel,
  isReviewComplete,
} from "@/entities/session/lib/review-state";
import type { RejectedCandidateSummary, ReviewLimitationSummary, ScanSessionDetail } from "@/shared/api/security";
import { toAnalystCopy } from "@/shared/lib/analyst-copy";
import { CopyButton } from "@/shared/ui/CopyButton";

interface Props {
  session: ScanSessionDetail | null;
  onSelectFinding: (finding: Finding) => void;
}

export function ScanResultsScreen({ session, onSelectFinding }: Props) {
  if (!session) return null;
  const safeVerdict = session.verdict === "safe";
  const hasFindings = session.findings.length > 0;
  const hasCoverageGap = session.session.coveragePercent < 100;
  const hasSecurityScore = typeof session.session.securityScore === "number";
  const analysisBrief = session.session.analysisBrief;
  const excludedFiles = getExcludedFiles(session.session.coverageSnapshot);
  const orderedValidatedFindings = orderFindingsByDecisionPriority(session.findings);
  const filteredCandidateFindings = dedupeCandidateFindings(orderedValidatedFindings, session.candidateFindings);
  const hasCandidateFindings = filteredCandidateFindings.length > 0;
  const rejectedCandidates = session.rejectedCandidates ?? [];
  const rejectedGroups = groupRejectedCandidates(rejectedCandidates);
  const hasRejectedCandidates = rejectedCandidates.length > 0;
  const limitations = session.limitations ?? [];
  // Only a complete review may be presented as finished. A partial, degraded or
  // unreported one looks identical in a findings count, which is why it is read
  // from the state the engine recorded.
  const reviewComplete = isReviewComplete(session.reviewState);
  const cleanReview = safeVerdict && reviewComplete;
  const approvalQueue = buildApprovalQueue(orderedValidatedFindings);
  const approvalQueuedFindingIds = new Set(approvalQueue.map((item) => item.findingId));
  const surfacedValidatedFindings = orderedValidatedFindings.filter((finding) => !approvalQueuedFindingIds.has(finding.id));
  const activeFindingCounts = countSeverities(surfacedValidatedFindings);
  const activeValidatedCount = surfacedValidatedFindings.length;
  const hasAiScoreExplanation = Boolean(toAnalystCopy(analysisBrief?.scoreExplanation ?? "").trim());
  const scoreExplanation = buildScoreExplanation(session, {
    activeValidatedCount,
    approvalQueueCount: approvalQueue.length,
    // The count has to agree with the rows the screen shows below it, and the
    // dropped candidates are the ones it shows.
    candidateCount: rejectedCandidates.length,
  });
  const showWorkflowDetails = hasMeaningfulWorkflowDetails(session);
  const showTechnicalSignals = hasMeaningfulTechnicalSignals(session);
  const hasAnalysisBrief = Boolean(
    analysisBrief?.potentialRisks.length
      || analysisBrief?.securityObservations.length
      || analysisBrief?.analysisLimitations.length
      || analysisBrief?.attackThinking.length
      || analysisBrief?.nextSteps.length,
  );
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="hide-scrollbar flex-1 overflow-y-auto bg-surface px-6 py-6"
    >
      <div className="mx-auto max-w-5xl space-y-4">
        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex items-center justify-between rounded-xl border bg-card px-5 py-4"
          style={{ borderColor: "hsl(var(--border-soft))" }}
        >
          <div>
            <p className="text-sm font-semibold text-txt-primary">{session.session.repo}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-txt-tertiary">
              {session.session.scanMode === "deep" ? "Deep review" : "Fast review"} | {session.session.time}
            </p>
          </div>
          <div className="flex items-center gap-2 text-txt-secondary">
            <CheckCircle2 size={15} className={cleanReview ? "text-status-success" : "text-txt-secondary"} />
            <span className="text-sm font-medium text-txt-primary">
              {cleanReview ? "Reviewed" : reviewComplete ? "Completed" : getReviewStateLabel(session.reviewState)}
            </span>
          </div>
        </motion.div>

        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className={`rounded-xl border px-5 py-4 ${cleanReview ? "bg-[#f7fbf7]" : "bg-card"}`}
          style={{ borderColor: cleanReview ? "rgba(94, 155, 110, 0.22)" : "hsl(var(--border-soft))" }}
        >
          <p className={`text-sm font-medium ${cleanReview ? "text-status-success" : "text-txt-primary"}`}>
            {cleanReview
              ? "No validated security issue was confirmed in the selected scope"
              : reviewComplete
                ? "Validated repository assessment"
                : "Review completed with limitations"}
          </p>
          <p className="mt-2 text-sm leading-6 text-txt-secondary">
            {reviewComplete
              ? toAnalystCopy(session.session.repositorySummary) ||
                (cleanReview
                  ? "The selected source was reviewed and no high-confidence issue was confirmed"
                  : "CodeRadar completed the repository assessment")
              : describeReviewCompleteness(session.reviewState, limitations)}
          </p>
          {!reviewComplete && (
            <p className="mt-3 text-xs leading-5 text-txt-tertiary">
              A limitation is not a finding and not a defect: nothing was claimed about the code. The full list is in Review
              limitations below.
            </p>
          )}
          {reviewComplete && !hasFindings && hasCoverageGap && (
            <p className="mt-2 text-sm leading-6 text-txt-secondary">
              The score is below 100 because the reviewed coverage was partial. No confirmed finding was retained, but the selected scope was not fully covered.
              {hasCandidateFindings ? " Candidate findings are shown below for manual review" : ""}
            </p>
          )}
        </motion.div>

        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16 }}
          className="rounded-xl border bg-card px-4 py-4"
          style={{ borderColor: "hsl(var(--border-soft))" }}
        >
          <div className="grid gap-3 xl:grid-cols-[280px_1fr] xl:items-stretch">
            <div className="rounded-lg border bg-[#f4f4f5] px-4 py-4" style={{ borderColor: "hsl(var(--border-soft))" }}>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-txt-tertiary">Security score — Greptile 5-point</p>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-[34px] font-semibold leading-none tracking-[-0.05em] text-txt-primary">
                  {hasSecurityScore ? session.session.securityScore : "—"}
                </span>
                <span className="pb-0.5 text-xs text-txt-tertiary">{hasSecurityScore ? "/100" : "unavailable"}</span>
                {hasSecurityScore && (
                  <span className="ml-2 rounded-full bg-black px-2 py-0.5 text-xs font-medium text-white">{Math.ceil((session.session.securityScore ?? 0)/20)}/5</span>
                )}
              </div>
              {hasSecurityScore && session.session.securityScore === 100 && (
                <p className="mt-2 text-xs leading-5 text-emerald-600">5/5 — clean, no action needed. No risky paths, no prompt required</p>
              )}
              {hasSecurityScore && session.session.securityScore >= 95 && session.session.securityScore < 100 && (
                <p className="mt-2 text-xs leading-5 text-txt-secondary">~5/5 — 1pt reserved for coverage completeness, no fix needed</p>
              )}
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#d4d4d4]">
                <div className="h-full rounded-full bg-primary" style={{ width: `${hasSecurityScore ? session.session.securityScore : 0}%` }} />
              </div>
            </div>

            <div className="rounded-lg border bg-card px-4 py-4" style={{ borderColor: "hsl(var(--border-soft))" }}>
              <p className="text-sm font-semibold text-txt-primary">{hasAiScoreExplanation ? "AI score explanation" : "Score signals"}</p>
              <div className="mt-3 space-y-2 text-sm leading-6 text-txt-secondary">
                {scoreExplanation.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <ScoreIssueChip label="Confirmed issues" value={activeValidatedCount} tone="high" />
                <ScoreIssueChip label="Review queue" value={approvalQueue.length} tone="medium" />
                <ScoreIssueChip label="Dropped candidates" value={rejectedCandidates.length} tone="low" />
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="rounded-xl border bg-card px-5 py-4"
          style={{ borderColor: "hsl(var(--border-soft))" }}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-txt-primary">Review coverage</p>
            <span className="text-xs font-medium uppercase tracking-[0.16em] text-txt-tertiary">
              {session.session.coveragePercent}% covered
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-txt-secondary">
            {toAnalystCopy(session.session.coverageSummary) || "Coverage details were not captured for this review."}
          </p>
          <div className="mt-3 grid gap-2 text-xs text-txt-secondary sm:grid-cols-2">
            <span>Files reviewed: {session.session.reviewedFilesCount}/{session.session.eligibleFilesCount || session.session.reviewedFilesCount}</span>
            <span>Blocks reviewed: {session.session.reviewedBlocksCount}/{session.session.totalBlocksCount || session.session.reviewedBlocksCount}</span>
            <span>Paths traced: {session.session.tracedPathsCount}/{session.session.totalPathsCount || session.session.tracedPathsCount}</span>
            <span>Elapsed: {formatElapsedSeconds(session.session.elapsedSeconds)}</span>
          </div>
          {excludedFiles.length > 0 && (
            <div className="mt-4 rounded-lg border bg-[#f4f4f5] px-4 py-3" style={{ borderColor: "hsl(var(--border-soft))" }}>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-txt-tertiary">Excluded files</p>
              <div className="mt-2 space-y-1.5 text-sm text-txt-secondary">
                {excludedFiles.slice(0, 6).map((item) => (
                  <p key={`${item.file}:${item.reason}`}>
                    <span className="font-mono text-txt-primary">{item.file}</span> - {item.reason}
                  </p>
                ))}
              </div>
            </div>
          )}
        </motion.div>

        {showWorkflowDetails && session.session.workflowSummary && (
          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.19 }}
            className="rounded-lg border bg-card px-5 py-4"
            style={{ borderColor: "hsl(var(--border-soft))" }}
          >
            <div>
              <div>
                <p className="text-sm font-semibold text-txt-primary">Workflow orchestration</p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-txt-tertiary">{session.session.workflowSummary.label}</p>
              </div>
              <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-txt-tertiary">
                {session.session.workflowSummary.activeController}
              </p>
            </div>
            <p className="mt-2 text-sm leading-6 text-txt-secondary">{session.session.workflowSummary.summary}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <InfoSummaryCard
                label="Next action"
                value={session.session.workflowSummary.nextAction}
                note={`${session.session.workflowSummary.blockingItems} active workflow blocker${session.session.workflowSummary.blockingItems === 1 ? "" : "s"}`}
              />
              <InfoSummaryCard
                label="Workflow state"
                value={session.session.workflowSummary.state}
                note={`Controlled by ${session.session.workflowSummary.activeController}${session.session.workflowSummary.plannerStage ? ` - planner stage ${session.session.workflowSummary.plannerStage}` : ""}`}
              />
            </div>
            {session.session.workflowSummary.operationsSummary && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <InfoSummaryCard
                  label="Operations lane"
                  value={session.session.workflowSummary.operationsSummary.currentLane}
                  note={`Next lane ${session.session.workflowSummary.operationsSummary.nextLane ?? "none"} - ${session.session.workflowSummary.operationsSummary.activeItemCount} active item(s)`}
                />
                <InfoSummaryCard
                  label="Lane handoff"
                  value={session.session.workflowSummary.operationsSummary.pendingHandoff ? "Pending handoff" : "No handoff pending"}
                  note={session.session.workflowSummary.operationsSummary.handoffReason}
                />
              </div>
            )}
            {session.session.workflowSummary.operationsExecution && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <InfoSummaryCard
                  label="Operations execution"
                  value={session.session.workflowSummary.operationsExecution.currentHandoff}
                  note={`Status ${session.session.workflowSummary.operationsExecution.handoffStatus} - owner ${session.session.workflowSummary.operationsExecution.owningController}`}
                />
                <InfoSummaryCard
                  label="Pending step"
                  value={session.session.workflowSummary.operationsExecution.pendingExecutionStep}
                  note={session.session.workflowSummary.operationsExecution.stepCompletionState}
                />
              </div>
            )}
            {session.session.workflowSummary.workflowClosure && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <InfoSummaryCard
                  label="Workflow closure"
                  value={session.session.workflowSummary.workflowClosure.closureLabel}
                  note={`${session.session.workflowSummary.workflowClosure.closureState} - next ${session.session.workflowSummary.workflowClosure.nextClosureStep}`}
                />
                <InfoSummaryCard
                  label="Closure control"
                  value={session.session.workflowSummary.workflowClosure.autonomousReady ? "Autonomous-ready" : session.session.workflowSummary.workflowClosure.requiresHumanControl ? "Human control required" : "Controlled progression"}
                  note={session.session.workflowSummary.workflowClosure.closureReason}
                />
              </div>
            )}
            {session.session.workflowSummary.recoverySummary && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <InfoSummaryCard
                  label="Recovery readiness"
                  value={session.session.workflowSummary.recoverySummary.retryAvailable ? "Retry available" : "Stable"}
                  note={`${session.session.workflowSummary.recoverySummary.retryableFindings} retryable finding(s) - ${session.session.workflowSummary.recoverySummary.attemptedStrategies} attempted strategies - ${session.session.workflowSummary.recoverySummary.controllerStatus}`}
                />
                <InfoSummaryCard
                  label="Latest recovery signal"
                  value={session.session.workflowSummary.recoverySummary.lastVerificationStatus ?? "No recent verification"}
                  note={session.session.workflowSummary.recoverySummary.latestFailureReason}
                />
              </div>
            )}
            {session.session.workflowSummary.recoverySummary && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <InfoSummaryCard
                  label="Recovery transition"
                  value={session.session.workflowSummary.recoverySummary.nextTransition}
                  note={`Recovery state ${session.session.workflowSummary.recoverySummary.recoveryState}${session.session.workflowSummary.recoverySummary.plannerReentryReady ? " - planner re-entry is ready" : ""}`}
                />
                <InfoSummaryCard
                  label="Recovery controller"
                  value={session.session.workflowSummary.recoverySummary.controllerStatus}
                  note={session.session.workflowSummary.recoverySummary.retryAvailable ? "A recovery path is still active for this session" : "No active recovery path remains"}
                />
              </div>
            )}
            {session.session.workflowSummary.recoveryExecution && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <InfoSummaryCard
                  label="Recovery path"
                  value={session.session.workflowSummary.recoveryExecution.selectedPath}
                  note={`Lane ${session.session.workflowSummary.recoveryExecution.executionLane} - state ${session.session.workflowSummary.recoveryExecution.executionState}`}
                />
                <InfoSummaryCard
                  label="Recovery execution"
                  value={session.session.workflowSummary.recoveryExecution.reenteredPlanner ? "Planner re-entry recorded" : "No planner re-entry"}
                  note={session.session.workflowSummary.recoveryExecution.pathReason}
                />
              </div>
            )}
            {session.session.workflowSummary.memorySummary && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <InfoSummaryCard
                  label="Session memory"
                  value={`${session.session.workflowSummary.memorySummary.attemptedStrategyCount} attempted strategies`}
                  note={`${session.session.workflowSummary.memorySummary.rejectedPathCount} rejected path(s) - ${session.session.workflowSummary.memorySummary.escalatedPathCount} escalated path(s) - ${session.session.workflowSummary.memorySummary.suppressedStrategyCount} suppressed strategy(s)`}
                />
                <InfoSummaryCard
                  label="Current constraint"
                  value={
                    session.session.workflowSummary.memorySummary.knownStrategyIds.length > 0
                      ? session.session.workflowSummary.memorySummary.knownStrategyIds.join(", ")
                      : "No stored strategy ids"
                  }
                  note={`${session.session.workflowSummary.memorySummary.suppressionState} memory - ${session.session.workflowSummary.memorySummary.nextMemoryAction}. ${session.session.workflowSummary.memorySummary.recentConstraint}`}
                />
              </div>
            )}
          </motion.div>
        )}

        {showTechnicalSignals && (
        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid gap-3 md:grid-cols-3"
        >
          <InfoSummaryCard
            label="Framework profile"
            value={formatFrameworkValue(session.session.frameworkProfile)}
            note={formatFrameworkNote(session.session.frameworkProfile)}
          />
          <InfoSummaryCard
            label="Repository graph"
            value={`${Number(session.session.graphSummary?.import_edges ?? 0)} import edges`}
            note={`${Number(session.session.graphSummary?.route_files ?? 0)} route files and ${Number(session.session.graphSummary?.auth_files ?? 0)} auth files`}
          />
          <InfoSummaryCard
            label="Path tracing"
            value={`${Number(session.session.pathSummary?.candidate_path_count ?? 0)} candidate paths`}
            note={`${Number(session.session.pathSummary?.cross_file_paths ?? 0)} cross-file paths identified`}
          />
        </motion.div>
        )}

        {showTechnicalSignals && (
        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22 }}
          className="grid gap-3 md:grid-cols-3"
        >
          <InfoSummaryCard
            label="Review mode"
            value={session.session.scanMode === "deep" ? "Deep review" : "Fast review"}
            note={getScanPlanWorkUnitStrategyPaths(session.session.scanPlan) ?? "Path-centric review"}
          />
          <InfoSummaryCard
            label="Review queue"
            value={`${Number(session.session.reviewQueueSummary?.ranked_review_items ?? 0)} review items`}
            note={`${Number(session.session.reviewQueueSummary?.ranked_path_units ?? 0)} ranked paths`}
          />
          <InfoSummaryCard
            label="Score rationale"
            value={
              session.session.status === "failed"
                ? "Unavailable"
                : `${activeValidatedCount} open`
            }
            note={
              session.session.status === "failed"
                ? toAnalystCopy(String(session.errorMessage ?? "The review did not complete, so no security score was produced"))
                : `Queue ${approvalQueue.length} item(s) - coverage ${Number(session.session.scoreRationale?.coverage_percent ?? session.session.coveragePercent)} percent - candidate pressure ${Number(session.session.scoreRationale?.candidate_pressure ?? 0)}`
            }
          />
        </motion.div>
        )}

        {hasAnalysisBrief && analysisBrief && (
          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.23 }}
            className="grid gap-3 md:grid-cols-2"
          >
            <AnalystListCard
              label="Potential risks"
              intro="Unconfirmed concerns derived from reviewed evidence, missing verification, or suspicious patterns"
              items={analysisBrief.potentialRisks}
              emptyMessage="No additional potential risk was surfaced beyond the validated queue"
            />
            <AnalystListCard
              label="Security observations"
              intro="Defensive patterns that appear to be present in the reviewed scope"
              items={analysisBrief.securityObservations}
              emptyMessage="No distinct defensive observation was captured for this run"
            />
            <AnalystListCard
              label="What CodeRadar could not verify"
              intro="These are real review limits from the reviewed run, not proof that the code is unsafe"
              items={analysisBrief.analysisLimitations}
              emptyMessage="No major verification limit was surfaced for this run"
            />
            <AnalystListCard
              label="If I were attacking this"
              intro="Attack probes CodeRadar would prioritize next against the reviewed surfaces"
              items={analysisBrief.attackThinking}
              emptyMessage="No additional attack probe was highlighted beyond the reviewed surfaces"
            />
            <AnalystListCard
              label="Recommended next steps"
              intro="Concrete follow-up actions generated from the current run"
              items={analysisBrief.nextSteps}
              emptyMessage="No additional follow-up step was suggested for this run"
            />
          </motion.div>
        )}

        <FindingsCard
          title="Validated findings"
          subtitle={approvalQueue.length > 0 ? "Open findings only" : undefined}
          findings={surfacedValidatedFindings}
          emptyMessage={
            !reviewComplete
              ? "No confirmed finding was retained, and the review did not cover everything it was asked to — this is not a clean result. See the review limitations above."
              : safeVerdict
                ? hasCoverageGap
                  ? "No confirmed finding was retained, but the reviewed coverage was partial — the score stays below 100 until the selected scope is fully covered"
                  : hasSecurityScore
                    ? `The review finished with a score of ${session.session.securityScore}/100 — no high-confidence, confirmed security issue was found in the reviewed scope`
                    : "No high-confidence, confirmed security issue was found in the reviewed scope"
                : approvalQueue.length > 0
                  ? "All validated findings in this session are already tracked in the review queue below"
                  : "No confirmed findings were returned for this review"
          }
          onSelectFinding={onSelectFinding}
        />

        {hasCandidateFindings && (
          <CandidateFindingsCard
            findings={filteredCandidateFindings}
            groups={groupCandidateFindings(filteredCandidateFindings)}
            onSelectFinding={onSelectFinding}
          />
        )}

        {!reviewComplete && limitations.length > 0 && (
          <ReviewLimitationsCard state={session.reviewState} limitations={limitations} />
        )}

        {hasRejectedCandidates && (
          <RejectedCandidatesCard candidates={rejectedCandidates} groups={rejectedGroups} />
        )}

        {surfacedValidatedFindings.length > 0 && (
          <div className="rounded-xl border bg-card px-5 py-4" style={{ borderColor: "hsl(var(--border-soft))" }}>
            <p className="text-sm font-semibold text-txt-primary">Agent fix prompt — copy to Codex / Claude / Cursor</p>
            <p className="mt-1 text-xs text-txt-tertiary">Greptile-style: 1-4/5 shows file:line + prompt, 5/5 shows no fix needed</p>
            <pre className="mt-3 max-h-[220px] overflow-auto rounded-lg bg-[#0f0f0f] p-3 text-[11px] leading-5 text-white/80">{buildAgentFixPrompt(surfacedValidatedFindings)}</pre>
            <div className="mt-3">
              <CopyButton value={buildAgentFixPrompt(surfacedValidatedFindings)} label="Copy prompt" />
            </div>
          </div>
        )}

        {approvalQueue.length > 0 && (
        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="rounded-xl border bg-card px-5 py-4"
          style={{ borderColor: "hsl(var(--border-soft))" }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-txt-primary">Approval queue</p>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-txt-tertiary">Review-required items</p>
            </div>
            <span className="text-xs font-medium uppercase tracking-[0.16em] text-txt-tertiary">
              {approvalQueue.length} queued
            </span>
          </div>
          <div className="mt-3 space-y-2.5">
            {approvalQueue.map((item) => {
              const finding = orderedValidatedFindings.find((entry) => entry.id === item.findingId);
              return (
                <button
                  key={item.findingId}
                  onClick={() => finding && onSelectFinding(finding)}
                  className="flex w-full items-start gap-4 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted/30"
                  style={{ borderColor: "hsl(var(--border-soft))" }}
                >
                  <div className="mt-0.5">
                    <SeverityBadge severity={item.severity} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium text-txt-primary">{item.title}</p>
                      <span className="shrink-0 text-xs uppercase tracking-[0.16em] text-txt-tertiary">{item.statusLabel}</span>
                    </div>
                    <p className="mt-1 text-xs text-txt-tertiary">{item.file}</p>
                    <p className="mt-2 text-sm leading-6 text-txt-secondary">{item.reason}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </motion.div>
        )}

        {session.session.annotations.length > 0 && (
        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.26 }}
          className="rounded-xl border bg-card px-5 py-4"
          style={{ borderColor: "hsl(var(--border-soft))" }}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-txt-primary">Line annotations</p>
            <span className="text-xs uppercase tracking-[0.16em] text-txt-tertiary">{session.session.annotations.length} ready</span>
          </div>
          <div className="mt-3 space-y-2.5">
            {session.session.annotations.slice(0, 6).map((annotation) => (
              <AnnotationRow key={`${annotation.file}:${annotation.lineStart}:${annotation.title}`} annotation={annotation} />
            ))}
          </div>
        </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function buildScoreExplanation(
  session: ScanSessionDetail,
  counts: { activeValidatedCount: number; approvalQueueCount: number; candidateCount: number },
): string[] {
  const score = session.session.securityScore;
  const rationale = session.session.scoreRationale ?? {};
  const coveragePercent = Number(rationale.coverage_percent ?? session.session.coveragePercent);
  const candidatePressure = Number(rationale.candidate_pressure ?? counts.candidateCount);
  const candidateFindingsCount = Number(rationale.candidate_findings_count ?? counts.candidateCount);
  const validatedFindingsCount = Number(rationale.validated_findings_count ?? counts.activeValidatedCount);
  const pathCount = Number(rationale.path_count ?? session.session.pathSummary?.candidate_path_count ?? session.session.totalPathsCount);
  const emptyPathPenalty = Number(rationale.empty_path_penalty ?? 0);
  const unsupportedPenalty = Number(rationale.unsupported_penalty ?? 0);
  const lowSignalPenalty = Number(rationale.low_signal_penalty ?? 0);
  const coverageBand = readableValue(rationale.coverage_band);
  const supportPrimary = getScoreSupportPrimary(rationale.support_matrix);
  const aiScoreExplanation = toAnalystCopy(session.session.analysisBrief?.scoreExplanation ?? "");
  const explanations: string[] = [];

  if (aiScoreExplanation) {
    explanations.push(aiScoreExplanation);
  } else if (typeof score === "number") {
    const scoreInputs = [
      `${score}/100 score`,
      `${coveragePercent}% coverage`,
      `${validatedFindingsCount} validated finding(s)`,
      `${candidateFindingsCount} candidate finding(s)`,
      `${pathCount} candidate path(s)`,
    ];
    if (coverageBand) {
      scoreInputs.push(`${coverageBand} coverage band`);
    }
    if (supportPrimary) {
      scoreInputs.push(`${supportPrimary.stack} support: ${supportPrimary.confidence}`);
    }
    explanations.push(`Score inputs from this run: ${scoreInputs.join(", ")}.`);
  } else {
    explanations.push("This review did not return a score from the backend.");
  }

  const reductions = [
    emptyPathPenalty > 0 ? `empty path inventory -${emptyPathPenalty}` : null,
    unsupportedPenalty > 0 ? `framework support -${unsupportedPenalty}` : null,
    lowSignalPenalty > 0 ? `low evidence signal -${lowSignalPenalty}` : null,
    candidatePressure > 0 ? `candidate pressure -${candidatePressure}` : null,
  ].filter(Boolean);
  if (reductions.length > 0) {
    explanations.push(`Score reductions recorded by the scorer: ${reductions.join(", ")}.`);
  } else if (typeof score === "number" && score === 100 && validatedFindingsCount === 0 && candidateFindingsCount === 0) {
    explanations.push("Perfect score — no deductions, 5/5 Greptile. No risky paths or findings, no prompt needed");
  } else if (typeof score === "number" && score >= 95 && validatedFindingsCount === 0) {
    explanations.push("~5/5 Greptile — clean file, minor reserve (no attack paths found). No fix needed, no prompt required");
  }

  if (counts.activeValidatedCount > 0 || counts.approvalQueueCount > 0 || candidateFindingsCount > 0) {
    explanations.push(`Current review state: ${counts.activeValidatedCount} open finding(s), ${counts.approvalQueueCount} queued approval item(s), ${candidateFindingsCount} candidate finding(s).`);
  }

  if (explanations.length === 1 && typeof score === "number") {
    explanations.push(`Reviewed evidence summary: ${coveragePercent}% coverage, ${pathCount} candidate path(s), ${validatedFindingsCount} validated finding(s).`);
  }

  return explanations;
}

function getScoreSupportPrimary(value: unknown): { stack: string; confidence: string } | null {
  if (!value || typeof value !== "object") return null;
  const primary = (value as Record<string, unknown>).primary;
  if (!primary || typeof primary !== "object") return null;
  const primaryRecord = primary as Record<string, unknown>;
  const stack = readableValue(primaryRecord.stack);
  const confidence = readableValue(primaryRecord.confidence);
  if (!stack || !confidence) return null;
  return { stack, confidence };
}

function readableValue(value: unknown): string {
  return String(value ?? "")
    .replace(/[_-]+/g, " ")
    .trim();
}

function hasMeaningfulWorkflowDetails(session: ScanSessionDetail): boolean {
  const workflow = session.session.workflowSummary;
  if (!workflow) return false;
  if (workflow.state !== "completed" || workflow.blockingItems > 0) return true;
  if (workflow.operationsSummary?.pendingHandoff || (workflow.operationsSummary?.activeItemCount ?? 0) > 0) return true;
  if (workflow.recoverySummary?.retryAvailable || workflow.recoverySummary?.controllerStatus !== "closed") return true;
  if (workflow.workflowClosure?.requiresHumanControl) return true;
  return false;
}

function hasMeaningfulTechnicalSignals(session: ScanSessionDetail): boolean {
  if (session.findings.length > 0 || session.candidateFindings.length > 0) return true;
  if (session.session.targetType === "folder") return true;
  if (session.session.totalPathsCount > 0 || Number(session.session.pathSummary?.candidate_path_count ?? 0) > 0) return true;
  return false;
}

function buildFindingFingerprint(finding: Finding): string {
  const category = finding.category.trim().toLowerCase();
  const title = finding.title.trim().toLowerCase();
  const evidence = finding.evidence.trim().toLowerCase().slice(0, 160);
  return [finding.file, category, title, evidence || `${finding.line}:${finding.lineEnd}`].join("|");
}

function dedupeCandidateFindings(validatedFindings: Finding[], candidateFindings: Finding[]): Finding[] {
  const validatedFingerprints = new Set(validatedFindings.map(buildFindingFingerprint));
  return candidateFindings.filter((finding) => !validatedFingerprints.has(buildFindingFingerprint(finding)));
}

function getExcludedFiles(coverageSnapshot: Record<string, unknown> | null): Array<{ file: string; reason: string }> {
  const rawItems = coverageSnapshot?.["excluded_files"];
  if (!Array.isArray(rawItems)) {
    return [];
  }

  return rawItems
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const file = "file" in item ? String(item.file ?? "").trim() : "";
      const reason = "reason" in item ? String(item.reason ?? "").trim() : "";
      if (!file || !reason) return null;
      return { file, reason };
    })
    .filter((item): item is { file: string; reason: string } => item !== null);
}

function getScanPlanWorkUnitStrategyPaths(scanPlan: Record<string, unknown> | null): string | null {
  if (!scanPlan || typeof scanPlan !== "object") return null;
  const workUnitStrategy = scanPlan["work_unit_strategy"];
  if (!workUnitStrategy || typeof workUnitStrategy !== "object") return null;
  const paths = (workUnitStrategy as Record<string, unknown>).paths;
  return paths != null ? String(paths) : null;
}

function FindingsCard({
  title,
  subtitle,
  findings,
  emptyMessage,
  onSelectFinding,
  action,
  lowConfidence = false,
}: {
  title: string;
  subtitle?: string;
  findings: Finding[];
  emptyMessage: string;
  onSelectFinding: (finding: Finding) => void;
  action?: ReactNode;
  lowConfidence?: boolean;
}) {
  return (
    <motion.div
                 initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden rounded-xl border bg-card"
      style={{ borderColor: "hsl(var(--border-soft))" }}
    >
      <div className="px-5 pb-3 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-txt-primary">{title}</h3>
            {subtitle && <p className="mt-1 text-xs uppercase tracking-[0.16em] text-txt-tertiary">{subtitle}</p>}
          </div>
          {action}
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: "hsl(var(--border-soft))" }}>
        {findings.map((finding) => (
          <button
            key={`${title}-${finding.id}`}
            onClick={() => onSelectFinding(finding)}
            className="flex w-full items-start gap-4 px-5 py-4 text-left transition-colors duration-150 hover:bg-muted/30"
          >
            <div className="mt-0.5">
              <SeverityBadge severity={finding.severity} />
            </div>
            <div className="min-w-0">
              <p className="leading-snug text-sm font-medium text-txt-primary">{finding.title}</p>
              <p className="mt-1 text-xs text-txt-tertiary">
                {finding.file}:{formatFindingRange(finding)} - {finding.category}
              </p>
              {finding.remediationStatus !== "open" && (
                <p className={`mt-1 text-xs ${
                  getRemediationStatusTone(finding.remediationStatus) === "success"
                    ? "text-status-success"
                    : getRemediationStatusTone(finding.remediationStatus) === "warning"
                      ? "text-status-high"
                      : getRemediationStatusTone(finding.remediationStatus) === "progress"
                        ? "text-status-progress"
                        : "text-txt-secondary"
                }`}>
                  {getRemediationStatusLabel(finding.remediationStatus)}
                </p>
              )}
              {lowConfidence && (
                <p className="mt-1 text-xs text-txt-secondary">
                  Needs validation - confidence {finding.confidence}%
                </p>
              )}
            </div>
          </button>
        ))}
        {findings.length === 0 && (
          <div className="px-5 py-6 text-sm text-txt-secondary">{emptyMessage}</div>
        )}
      </div>
    </motion.div>
  );
}

function ScoreIssueChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "critical" | "high" | "medium" | "low";
}) {
  const numberToneClass =
    tone === "critical"
      ? "text-status-critical"
      : tone === "high"
        ? "text-status-high"
        : tone === "medium"
          ? "text-[#525252]"
          : "text-[#666666]";

  return (
    <div className="min-w-0 rounded-lg border bg-[#f4f4f5] px-3 py-3" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-txt-tertiary">{label}</p>
      <div className="mt-3 flex min-h-[44px] items-center justify-center">
        <span
          className={`block min-w-0 max-w-full overflow-hidden text-center font-mono text-[26px] font-semibold leading-none tracking-[-0.05em] tabular-nums ${numberToneClass}`}
          style={{ overflowWrap: "anywhere" }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function InfoSummaryCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-4" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-txt-tertiary">{label}</p>
      <p className="mt-3 text-sm font-semibold text-txt-primary">{value}</p>
      <p className="mt-2 text-xs leading-5 text-txt-secondary">{note}</p>
    </div>
  );
}

function AnalystListCard({
  label,
  intro,
  items,
  emptyMessage,
}: {
  label: string;
  intro: string;
  items: string[];
  emptyMessage?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-4" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-txt-tertiary">{label}</p>
      <p className="mt-3 text-sm leading-6 text-txt-secondary">{intro}</p>
      {items.length > 0 ? (
        <div className="mt-3 space-y-2 text-sm text-txt-primary">
          {items.map((item, index) => (
            <p key={`${label}-${index}`} className="leading-6">
              {index + 1}. {item}
            </p>
          ))}
        </div>
      ) : emptyMessage !== undefined ? (
        <p className="mt-3 text-sm leading-6 text-txt-secondary">{emptyMessage ?? "No additional review note was captured"}</p>
      ) : null
      }
    </div>
  );
}

function AnnotationRow({ annotation }: { annotation: SessionAnnotation }) {
  const toneClass = annotation.tone === "red" ? "bg-[#fff6f4] text-status-critical" : "bg-[#f4f4f5] text-status-high";
  return (
    <div className="rounded-lg border px-3 py-3" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-txt-primary">{annotation.title}</p>
          <p className="mt-1 text-xs text-txt-tertiary">
            {annotation.file}:{annotation.lineStart}{annotation.lineEnd > annotation.lineStart ? `-${annotation.lineEnd}` : ""} - {annotation.pathHint || annotation.claim || "Reviewed evidence path"}
          </p>
          {annotation.recommendation ? (
            <p className="mt-2 text-xs leading-5 text-txt-secondary">
              <span className="font-medium text-txt-primary">Suggested fix: </span>
              {annotation.recommendation}
            </p>
          ) : null}
        </div>
        <span className={`rounded-md px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] ${toneClass}`}>
          {annotation.tone}
        </span>
      </div>
    </div>
  );
}

function formatFindingRange(finding: Finding) {
  return finding.lineEnd > finding.line ? `${finding.line}-${finding.lineEnd}` : `${finding.line}`;
}

function formatFrameworkNote(profile: Record<string, unknown> | null) {
  if (!profile) {
    return "No framework markers were recorded.";
  }
  const supportMatrix = profile.support_matrix;
  const supportStack =
    supportMatrix && typeof supportMatrix === "object" && supportMatrix !== null && "primary" in supportMatrix
      ? String((supportMatrix.primary as { stack?: unknown })?.stack ?? "")
      : "";
  if (String(profile.primary_framework ?? "unknown") === "unknown" && supportStack && supportStack !== "unknown") {
    return `No explicit framework markers were recorded. Classified from the primary language as ${supportStack}.`;
  }
  const frameworks = Array.isArray(profile.frameworks) ? profile.frameworks.map(String).join(", ") : "";
  return frameworks || "No framework markers were recorded.";
}

function formatFrameworkValue(profile: Record<string, unknown> | null) {
  if (!profile) {
    return "unknown";
  }
  const primaryFramework = String(profile.primary_framework ?? "unknown");
  if (primaryFramework !== "unknown") {
    return primaryFramework;
  }
  const supportMatrix = profile.support_matrix;
  const supportStack =
    supportMatrix && typeof supportMatrix === "object" && supportMatrix !== null && "primary" in supportMatrix
      ? String((supportMatrix.primary as { stack?: unknown })?.stack ?? "unknown")
      : "unknown";
  return supportStack || "unknown";
}

function formatElapsedSeconds(value: number) {
  const totalSeconds = Math.max(0, value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildAgentFixPrompt(findings: Finding[]) {
  const greptileScore = findings.length === 0 ? "5/5" : findings.some(f => f.severity === "critical") ? "1/5" : findings.some(f => f.severity === "high") ? "2/5" : "3/5";
  const header = greptileScore === "5/5"
    ? "Code review: 5/5 — no fix needed, clean"
    : `Code review: ${greptileScore} — fix the ${findings.length} finding(s) below`;
  const sections = findings.slice(0, 8).map((f, index) => {
    const fix = f.fixSuggestions.find((entry) => entry.profile === "recommended") ?? f.fixSuggestions[0];
    const range = f.lineEnd > f.line ? `${f.line}-${f.lineEnd}` : `${f.line}`;
    return [
      `### ${index + 1}. ${f.title}`,
      `Location: ${f.file}:${range}`,
      `Severity: ${f.severity} (confidence ${f.confidence}%)`,
      `What is wrong: ${toAnalystCopy(f.summary) || f.summary}`,
      `Why it matters: ${toAnalystCopy(f.impact) || f.impact}`,
      f.evidence ? `Evidence: ${toAnalystCopy(f.evidence) || f.evidence}` : null,
      fix ? `Recommended fix: ${toAnalystCopy(fix.description) || fix.description}` : null,
    ].filter((line): line is string => Boolean(line)).join("\n");
  }).join("\n\n");
  return [
    header,
    "",
    sections,
    "",
    "Fix prompt for Codex / Claude / Cursor:",
    "- Read each file at the reported location and apply the recommended fix",
    "- Keep the change minimal and behavior-preserving; do not refactor unrelated code",
    "- Preserve existing tests and add coverage for every patched path",
    "- If a fix changes a public signature or return shape, update its callers",
    "- Run the project's typecheck and tests, then report the diff for each finding",
  ].join("\n");
}

function countSeverities(findings: Finding[]) {
  return findings.reduce(
    (summary, finding) => {
      summary[finding.severity] += 1;
      return summary;
    },
    {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    } satisfies Record<Finding["severity"], number>,
  );
}

interface CandidateLocation {
  id: string;
  file: string;
  line: number;
  lineEnd: number;
}

interface CandidateGroup {
  title: string;
  category: string;
  severity: string;
  confidence: number;
  locations: CandidateLocation[];
}

function groupCandidateFindings(findings: Finding[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>();
  for (const finding of findings) {
    const key = `${finding.title}|${finding.category}`;
    const existing = groups.get(key);
    if (existing) {
      existing.locations.push({
        id: finding.id,
        file: finding.file,
        line: finding.line,
        lineEnd: finding.lineEnd,
      });
      continue;
    }
    groups.set(key, {
      title: finding.title,
      category: finding.category,
      severity: finding.severity,
      confidence: finding.confidence,
      locations: [{ id: finding.id, file: finding.file, line: finding.line, lineEnd: finding.lineEnd }],
    });
  }
  return Array.from(groups.values());
}

/**
 * Why the review is not a complete answer.
 *
 * Kept apart from findings and from dropped candidates on purpose: a limitation
 * is a statement about the review, not about the code. Merging it into either
 * would present coverage as a defect.
 */
function ReviewLimitationsCard({
  state,
  limitations,
}: {
  state: ScanSessionDetail["reviewState"];
  limitations: ReviewLimitationSummary[];
}) {
  return (
    <div className="rounded-xl border bg-card px-5 py-4" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-txt-primary">{getReviewStateLabel(state)}</h3>
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-txt-tertiary">
          {limitations.length} limitation{limitations.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-txt-secondary">
        Each one below is something the review did not do. The panel above states what that means for the result.
      </p>
      <ul className="mt-3 space-y-2">
        {limitations.map((limitation) => (
          <li key={limitation.code} className="rounded-lg bg-[#f4f4f5] px-3 py-2">
            <p className="text-xs font-medium text-txt-primary">{getLimitationLabel(limitation.code)}</p>
            <p className="mt-0.5 text-xs leading-5 text-txt-secondary">{limitation.detail}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-5 text-txt-tertiary">
        These are review limits, not proof that the code is unsafe, and not findings.
      </p>
    </div>
  );
}

/**
 * What the review bar dropped, and why.
 *
 * A review that reports nothing looks identical to a review that found nothing,
 * and the two need opposite responses. This card is the difference: every dropped
 * candidate is listed with the reason, the evidence it submitted, and the
 * comparison that refused it. Nothing here is presented as a defect.
 */
function RejectedCandidatesCard({
  candidates,
  groups,
}: {
  candidates: RejectedCandidateSummary[];
  groups: RejectedCandidateGroup[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <div className="px-5 pb-3 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-txt-primary">Rejected candidates</h3>
            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-txt-tertiary">Dropped by the review bar</p>
          </div>
          <span className="text-xs font-medium uppercase tracking-[0.16em] text-txt-tertiary">
            {candidates.length} dropped
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-txt-secondary">
          None of these is a reported defect. Each row says why it was not, so a refused claim is not mistaken for a
          defect the review never saw.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {groups.map((group) => (
            <span
              key={group.classification}
              className="rounded-md bg-muted px-2 py-1 text-[11px] text-txt-secondary"
            >
              {group.shortLabel} {group.candidates.length}
            </span>
          ))}
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.classification} className="border-t" style={{ borderColor: "hsl(var(--border-soft))" }}>
          <p className="px-5 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.16em] text-txt-tertiary">
            {group.heading}
          </p>
          <div className="divide-y" style={{ borderColor: "hsl(var(--border-soft))" }}>
            {group.candidates.map((candidate) => (
              <RejectedCandidateRow key={`${candidate.file}:${candidate.line}:${candidate.title}`} candidate={candidate} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One dropped candidate: the reason at a glance, the comparison on demand.
 *
 * Collapsed by default, because the detail is only worth reading once the reason
 * has made a reviewer ask what happened.
 */
function RejectedCandidateRow({ candidate }: { candidate: RejectedCandidateSummary }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-5 py-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-txt-primary">{candidate.title}</span>
          <span className="mt-1 block font-mono text-xs text-txt-tertiary">{formatRejectedLocation(candidate)}</span>
        </span>
        <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[11px] text-txt-secondary">
          {getRejectionReasonLabel(candidate.reason)}
        </span>
      </button>
      {expanded && <RejectionDetail candidate={candidate} />}
    </div>
  );
}

function RejectionDetail({ candidate }: { candidate: RejectedCandidateSummary }) {
  const comparison = candidate.diagnostics;

  return (
    <div className="mt-3 space-y-3 rounded-lg border bg-[#f4f4f5] px-4 py-3" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-txt-tertiary">Why it was dropped</p>
        <p className="mt-1 text-sm leading-6 text-txt-primary">{getRejectionExplanation(candidate.reason)}</p>
        <p className="mt-1 font-mono text-xs text-txt-secondary">{candidate.detail}</p>
      </div>

      {comparison !== null && (
        <>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-txt-tertiary">Evidence submitted</p>
            <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-txt-secondary">
              {comparison.evidence === null || comparison.evidence.trim() === ""
                ? "No evidence text was submitted."
                : comparison.evidence}
            </p>
          </div>

          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-txt-tertiary">Quotes checked</p>
            {comparison.quotes.length > 0 ? (
              <ul className="mt-1 space-y-1.5">
                {comparison.quotes.map((quote, index) => (
                  <li key={`${quote}-${index}`} className="text-xs leading-5 text-txt-secondary">
                    <span className="font-mono break-words text-txt-primary">{quote}</span>
                    <span className="mt-0.5 block">
                      {comparison.quotesFound[index] === true
                        ? `found in ${comparison.comparedFile ?? "the reviewed file"}`
                        : `not found in ${comparison.comparedFile ?? "the reviewed file"}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              // Diagnostics are only attached by an evidence rejection, so this
              // comparison is always the failed one: no quote was usable and the
              // evidence did not name the file either.
              <p className="mt-1 text-xs leading-5 text-txt-secondary">
                No quoted code was submitted, and the evidence does not name
                {` ${comparison.comparedFile ?? "the reviewed file"}, `}
                so there was nothing left to verify.
              </p>
            )}
          </div>

          {comparison.comparedFile !== null && (
            <p className="text-xs text-txt-tertiary">
              Compared against {comparison.comparedFile}
              {comparison.comparedChars === null ? "." : ` (${comparison.comparedChars} characters).`}
            </p>
          )}

          <p className="text-xs text-txt-tertiary">
            Submitted as {formatSubmittedComparison(comparison)}
          </p>
        </>
      )}
    </div>
  );
}

/** The claim's own axis, severity, and confidence, as the model stated them. */
function formatSubmittedComparison(comparison: NonNullable<RejectedCandidateSummary["diagnostics"]>): string {
  const parts: string[] = [];
  if (comparison.axis !== null && comparison.axis !== "") parts.push(comparison.axis);
  if (comparison.severity !== null && comparison.severity !== "") parts.push(comparison.severity);
  if (comparison.confidence !== null) parts.push(`confidence ${comparison.confidence}%`);
  return parts.length === 0 ? "no axis, severity, or confidence" : parts.join(" / ");
}

function CandidateFindingsCard({
  findings,
  groups,
  onSelectFinding,
}: {
  findings: Finding[];
  groups: CandidateGroup[];
  onSelectFinding: (finding: Finding) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <div className="px-5 pb-3 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-txt-primary">Candidate findings</h3>
            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-txt-tertiary">Needs review</p>
          </div>
          <span className="text-xs uppercase tracking-[0.16em] text-txt-tertiary">{groups.length} pattern(s)</span>
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: "hsl(var(--border-soft))" }}>
        {groups.map((group) => (
          <div key={`${group.title}|${group.category}`} className="px-5 py-4">
            <div className="flex items-center gap-4">
              <SeverityBadge severity={group.severity as Finding["severity"]} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-txt-primary">{group.title}</p>
                <p className="mt-1 text-xs text-txt-tertiary">
                  {group.locations.length} location{group.locations.length === 1 ? "" : "s"} · {group.category}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {group.locations.slice(0, 6).map((location) => (
                <button
                  key={location.id}
                  onClick={() => {
                    const target = findings.find((entry) => entry.id === location.id);
                    if (target) onSelectFinding(target);
                  }}
                  className="rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-txt-secondary transition-colors hover:bg-secondary hover:text-txt-primary"
                >
                  {location.file}:{location.line}
                </button>
              ))}
              {group.locations.length > 6 && (
                <span className="text-[11px] text-txt-tertiary">+{group.locations.length - 6} more</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


