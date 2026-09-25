/**
 * Mapping the engine's review report onto the wire contract the renderer reads.
 *
 * The renderer's client (`frontend/src/shared/api/security.ts`) is the reference
 * contract: it is unchanged by this migration on purpose, so the desktop app's
 * screens and the local API stay decoupled from the engine's internal model.
 *
 * Two rules govern this file, and both exist to keep the UI from lying:
 *
 * - A field is filled from something the report actually recorded. The review
 *   engine computes no security score, no path tracing, and no defensive-pattern
 *   inventory, so those arrive as null or zero rather than as a plausible number.
 *   The screens already render "unavailable" for a null score.
 * - Nothing is invented to fill a slot. The engine's rejected candidates are
 *   surfaced as unconfirmed risks and as `rejected_candidates`, because that is
 *   what they are, and are never dressed up as findings.
 *
 * The legacy `decision_summary` block is deliberately omitted: the renderer
 * derives it from the base finding (`buildFindingDecisionSummary`), so shipping a
 * second, server-side copy of that logic would be two sources of truth for one
 * number.
 */

import type { RejectedCandidate, ReviewFinding, ReviewReport } from "../core/findings/model.ts";
import { detectProjectProfile } from "../core/languages/detect.ts";

export type WireSeverity = "critical" | "high" | "medium" | "low";
export type WireScanMode = "fast" | "deep";
export type WirePreset = "safe" | "balanced" | "aggressive";
export type WireSessionStatus = "queued" | "scanning" | "completed" | "failed";

export interface WireFixSuggestion {
  id: string;
  label: string;
  profile: "safe" | "fast" | "recommended";
  description: string;
}

export interface WireAttackSimulation {
  input: string;
  execution: string;
  result: string;
}

export interface WireFinding {
  id: string;
  severity: WireSeverity;
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
  attack_simulation: WireAttackSimulation;
  audit_log: string[];
  fix_suggestions: WireFixSuggestion[];
  remediation_status: "open";
  approval_status: "not_required";
  approval_history: never[];
  applied_strategy_id: string | null;
  remediation_notes: string[];
  attempted_strategy_ids: string[];
  decision_summary: null;
}

/**
 * A candidate the review bar refused, as the reviewer needs to read it.
 *
 * This is a separate shape from `WireFinding` on purpose. A rejected candidate
 * has no severity, no impact, and no fix — inventing those to fit the finding
 * contract would present a refused claim as a finding, which is the one thing
 * this boundary must never do. `reason` stays the engine's machine value so the
 * renderer owns the wording and the grouping.
 */
export interface WireRejectedCandidate {
  title: string;
  file: string;
  line: number;
  line_end: number;
  reason: string;
  detail: string;
  /**
   * The comparison that produced the rejection, when the check recorded one.
   * Only rejections decided by evidence carry it; the others are decided by a
   * count, a field, or a location, where there is nothing to compare.
   */
  diagnostics: WireRejectionDiagnostics | null;
}

export interface WireRejectionDiagnostics {
  evidence: string | null;
  quotes: string[];
  quotes_found: boolean[];
  compared_file: string | null;
  compared_chars: number | null;
  used_file_reference: boolean;
  /** As the model submitted them, before normalisation. */
  axis: string | null;
  severity: string | null;
  confidence: number | null;
}

export interface WireAnalysisBrief {
  score_explanation: string;
  potential_risks: string[];
  security_observations: string[];
  analysis_limitations: string[];
  attack_thinking: string[];
  next_steps: string[];
}

export interface WireSession {
  id: string;
  title: string;
  repo: string;
  time: string;
  unread: boolean;
  status: WireSessionStatus;
  preview: string;
  scan_mode: WireScanMode;
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
  progress_counters: Record<string, number>;
  runtime_metrics: Record<string, number>;
  scan_plan: Record<string, unknown> | null;
  repository_summary: string | null;
  analysis_brief: WireAnalysisBrief | null;
  repository_inventory: Record<string, unknown> | null;
  framework_profile: Record<string, unknown> | null;
  repository_graph: Record<string, unknown> | null;
  graph_summary: Record<string, unknown> | null;
  security_registry: Record<string, unknown> | null;
  segmentation_summary: Record<string, unknown> | null;
  path_inventory: Record<string, unknown> | null;
  path_summary: Record<string, unknown> | null;
  review_queue_summary: Record<string, unknown> | null;
  annotations: never[];
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
  target_type: "file" | "folder";
  source_path: string;
  preset: WirePreset;
  last_verification: Record<string, unknown> | null;
  workflow_summary: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface WireScanDetail {
  session: WireSession;
  issues: { critical: number; high: number; medium: number; low: number };
  findings: WireFinding[];
  /**
   * Always empty, and not the carrier for dropped candidates.
   *
   * The renderer types this field as a list of findings, so filling it from the
   * report's rejections would mean inventing a severity, an impact and a fix for
   * a claim that was refused. Dropped candidates travel in
   * `rejected_candidates`, which has the shape they actually have.
   */
  candidate_findings: never[];
  /** Every candidate the review bar dropped, with the reason behind each one. */
  rejected_candidates: WireRejectedCandidate[];
  /** The engine's own rejection tally, by reason. */
  rejections_by_reason: Record<string, number>;
  verdict: "safe" | "issues_found";
  completed_at: string | null;
  error_message: string | null;
}

export function countSeverities(findings: readonly ReviewFinding[]): { critical: number; high: number; medium: number; low: number } {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/**
 * The engine states a problem, a reason, a consequence, a fix, and the code it
 * read. The detail panel shows those as entry point, unsafe execution, and
 * impact, so each slot is filled from the report field that carries that meaning
 * rather than from a generated story.
 */
function attackSimulation(finding: ReviewFinding): WireAttackSimulation {
  const { file, line, lineEnd } = finding.location;
  const range = lineEnd > line ? `${line}-${lineEnd}` : `${line}`;
  return { input: `${file}:${range}`, execution: finding.evidence, result: finding.impact };
}

function fixSuggestions(finding: ReviewFinding): WireFixSuggestion[] {
  const suggestions: WireFixSuggestion[] = [
    { id: `${finding.id}-fix`, label: "Recommended fix", profile: "recommended", description: finding.fix },
  ];

  if (finding.suggestedPatch !== null) {
    suggestions.push({ id: `${finding.id}-patch`, label: "Apply the suggested patch", profile: "fast", description: finding.suggestedPatch });
  }
  if (finding.suggestedTest !== null) {
    suggestions.push({ id: `${finding.id}-test`, label: "Add the regression test", profile: "safe", description: finding.suggestedTest });
  }

  return suggestions;
}

export function toWireFinding(finding: ReviewFinding): WireFinding {
  const { file, line, lineEnd } = finding.location;
  return {
    id: finding.id,
    severity: finding.severity,
    title: finding.title,
    file,
    line,
    line_end: lineEnd,
    // The review axis is the engine's own classification. The screens show it
    // next to the location, so it has to mean what it says.
    category: finding.axis,
    confidence: finding.confidence,
    summary: finding.problem,
    impact: finding.impact,
    explanation: finding.why,
    evidence: finding.evidence,
    attack_simulation: attackSimulation(finding),
    audit_log: [],
    fix_suggestions: fixSuggestions(finding),
    remediation_status: "open",
    approval_status: "not_required",
    approval_history: [],
    applied_strategy_id: null,
    remediation_notes: [],
    attempted_strategy_ids: [],
    decision_summary: null,
  };
}

/** "3 candidates" / "1 candidate", for a sentence a person reads. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function rejectionLabel(candidate: RejectedCandidate): string {
  return `${candidate.file}:${candidate.line} — ${candidate.title} (${candidate.reason.replace(/-/g, " ")}: ${candidate.detail})`;
}

function buildAnalysisBrief(report: ReviewReport, aiSkipped: boolean): WireAnalysisBrief {
  const limitations: string[] = [];
  const nextSteps: string[] = [];
  const index = report.repositoryIndex;

  if (aiSkipped) {
    limitations.push(
      "The model did not review this run, so every finding comes from the deterministic checks. Cross-file and intent-level defects are not covered.",
    );
    nextSteps.push("Add an API key in Settings to include the model in the next review.");
  }
  if (report.stats.filesReviewed < report.stats.filesDiscovered) {
    limitations.push(
      `${report.stats.filesReviewed} of ${report.stats.filesDiscovered} discovered files were reviewed; the rest were outside the selected scope or beyond the review budget.`,
    );
  }
  if (index.contentUnavailable) {
    limitations.push("File contents were unavailable, so route, auth, and sink markers could not be counted.");
  }
  if (index.truncatedFiles > 0) {
    limitations.push(`${plural(index.truncatedFiles, "file")} too large to index in full.`);
  }
  if (report.scope.diffAware) {
    limitations.push(
      `Findings are anchored to lines changed against ${report.scope.baseBranch ?? "the base branch"}; the other files in scope were still reviewed in full.`,
    );
  }

  if (report.findings.length > 0) {
    nextSteps.push(`Apply the recommended fix for ${plural(report.findings.length, "finding")} and re-run the review.`);
  }
  if (report.rejected.length > 0) {
    nextSteps.push(`Decide on ${plural(report.rejected.length, "candidate")} that did not clear the review bar.`);
  }

  return {
    score_explanation: report.summary,
    // A rejected candidate is a real observation that could not be proved. That
    // is exactly what the "potential risks" card says it lists.
    potential_risks: report.rejected.slice(0, 10).map(rejectionLabel),
    security_observations: [],
    analysis_limitations: limitations,
    attack_thinking: [],
    next_steps: nextSteps,
  };
}

/** Coverage of the review itself: how much of the discovered scope was read. */
function coverage(report: ReviewReport): { percent: number; summary: string; reviewed: number; discovered: number } {
  const reviewed = report.stats.filesReviewed;
  const discovered = report.stats.filesDiscovered;
  const percent = discovered === 0 ? 100 : Math.min(100, Math.round((reviewed / discovered) * 100));

  return {
    percent,
    reviewed,
    discovered,
    summary:
      discovered === 0
        ? "The selected target contained no reviewable source file."
        : `${reviewed} of ${discovered} discovered ${discovered === 1 ? "file was" : "files were"} read and reviewed.`,
  };
}

export interface BuildSessionInput {
  id: string;
  report: ReviewReport;
  sourcePath: string;
  targetType: "file" | "folder";
  preset: WirePreset;
  scanMode: WireScanMode;
  aiSkipped: boolean;
  createdAt: string;
  completedAt: string | null;
  elapsedSeconds: number;
  /** Progress carried over from the last streamed event, so a poll matches it. */
  progress: number;
  phaseProgress: number;
  currentPhase: string;
  progressMessage: string;
  progressLogs: string[];
  status: WireSessionStatus;
  errorMessage: string | null;
}

export function buildWireSession(input: BuildSessionInput, report: ReviewReport | null): WireSession {
  const findings = report?.findings ?? [];
  const counts = countSeverities(findings);
  const coverageInfo = report === null ? null : coverage(report);
  const index = report?.repositoryIndex ?? null;
  const repositoryRelativeTo = report === null ? null : report.scope.pathBase;
  const projectProfile = index === null ? null : detectProjectProfile(index.manifests);

  const title = input.sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? input.sourcePath;
  const firstFinding = findings[0];

  return {
    id: input.id,
    title,
    repo: title,
    time: formatClock(input.elapsedSeconds),
    unread: false,
    status: input.status,
    preview: firstFinding?.title ?? report?.summary.slice(0, 120) ?? "",
    scan_mode: input.scanMode,
    critical_count: counts.critical,
    warning_count: counts.high,
    findings_count: findings.length,
    candidate_findings_count: report?.rejected.length ?? 0,
    progress: input.progress,
    phase_progress: input.phaseProgress,
    progress_message: input.progressMessage,
    current_phase: input.currentPhase,
    elapsed_seconds: input.elapsedSeconds,
    progress_logs: input.progressLogs,
    progress_counters: { reviewed_files: coverageInfo?.reviewed ?? 0, findings: findings.length },
    runtime_metrics: { elapsed_seconds: input.elapsedSeconds },
    scan_plan: null,
    repository_summary: report?.summary ?? null,
    analysis_brief: report === null ? null : buildAnalysisBrief(report, input.aiSkipped),
    repository_inventory:
      index === null
        ? null
        : {
            files_indexed: index.filesIndexed,
            languages: index.languages,
            manifests: index.manifests,
            bytes_indexed: index.bytesIndexed,
            truncated_files: index.truncatedFiles,
            content_unavailable: index.contentUnavailable,
            paths_relative_to: repositoryRelativeTo,
          },
    framework_profile:
      projectProfile === null
        ? null
        : {
            primary_framework: projectProfile.kind,
            frameworks: Object.keys(index?.languages ?? {}),
            manifest: projectProfile.manifest,
            package_manager: projectProfile.packageManager,
          },
    repository_graph: null,
    // Only the marker counts the indexer actually counted. Import-edge and
    // path-tracing numbers are not computed by this engine, so they are absent
    // rather than reported as zero-with-confidence.
    graph_summary:
      index === null
        ? null
        : {
            route_files: index.routeFiles,
            auth_files: index.authFiles,
            source_markers: index.sourceMarkers,
            sink_markers: index.sinkMarkers,
          },
    security_registry: null,
    segmentation_summary: null,
    path_inventory: null,
    path_summary: null,
    review_queue_summary:
      report === null
        ? null
        : {
            current_validated_findings_count: findings.length,
            current_candidate_findings_count: report.rejected.length,
            ranked_review_items: report.stats.filesReviewed,
            ranked_path_units: index?.routeFiles ?? 0,
          },
    annotations: [],
    annotation_summary: null,
    coverage_snapshot: null,
    coverage_summary: coverageInfo?.summary ?? null,
    coverage_percent: coverageInfo?.percent ?? 0,
    reviewed_files_count: coverageInfo?.reviewed ?? 0,
    eligible_files_count: coverageInfo?.discovered ?? 0,
    // The review engine has no block- or path-level unit, so these stay zero
    // instead of echoing the file counts under a different name.
    reviewed_blocks_count: 0,
    total_blocks_count: 0,
    reviewed_lines_count: 0,
    total_lines_count: 0,
    traced_paths_count: 0,
    total_paths_count: 0,
    skipped_files_count: coverageInfo === null ? 0 : Math.max(0, coverageInfo.discovered - coverageInfo.reviewed),
    high_risk_files_count: index?.hotspots.length ?? 0,
    is_safe: findings.length === 0,
    // The engine produces no safety score. A number here would be a claim about
    // the code that nothing in the pipeline can support.
    security_score: null,
    score_rationale:
      report === null
        ? null
        : {
            coverage_percent: coverageInfo?.percent ?? 0,
            validated_findings_count: findings.length,
            candidate_findings_count: report.rejected.length,
          },
    target_type: input.targetType,
    source_path: input.sourcePath,
    preset: input.preset,
    last_verification: null,
    workflow_summary: null,
    created_at: input.createdAt,
    updated_at: input.completedAt ?? input.createdAt,
  };
}

function toWireRejectedCandidate(candidate: RejectedCandidate): WireRejectedCandidate {
  const lineEnd = Number.isFinite(candidate.lineEnd) ? Math.max(candidate.lineEnd, candidate.line) : candidate.line;
  const diagnostics = candidate.diagnostics;

  return {
    title: candidate.title,
    file: candidate.file,
    line: candidate.line,
    line_end: lineEnd,
    reason: candidate.reason,
    detail: candidate.detail,
    diagnostics:
      diagnostics === undefined
        ? null
        : {
            evidence: diagnostics.evidence ?? null,
            quotes: diagnostics.quotes ?? [],
            quotes_found: diagnostics.quotesFound ?? [],
            compared_file: diagnostics.compared?.file ?? null,
            compared_chars: diagnostics.compared?.chars ?? null,
            used_file_reference: diagnostics.usedFileReference === true,
            axis: diagnostics.axis ?? null,
            severity: diagnostics.severity ?? null,
            confidence: diagnostics.confidence ?? null,
          },
  };
}

export function buildWireScanDetail(session: WireSession, report: ReviewReport | null, errorMessage: string | null): WireScanDetail {
  const findings = (report?.findings ?? []).map(toWireFinding);
  const rejected = report?.rejected ?? [];
  return {
    session,
    issues: countSeverities(report?.findings ?? []),
    findings,
    candidate_findings: [],
    rejected_candidates: rejected.map(toWireRejectedCandidate),
    rejections_by_reason: report?.stats.rejectionsByReason ?? {},
    verdict: findings.length === 0 ? "safe" : "issues_found",
    completed_at: session.status === "completed" || session.status === "failed" ? session.updated_at : null,
    error_message: errorMessage,
  };
}

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
