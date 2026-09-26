import { useEffect, useMemo, useRef, useState } from "react";
import { Description, Label } from "@/components/ui/field";
import {
  ProgressBar,
  ProgressBarHeader,
  ProgressBarTrack,
  ProgressBarValue,
} from "@/components/ui/progress-bar";
import type { ScanSessionDetail } from "@/shared/api";
import { toAnalystCopy } from "@/shared/lib/analyst-copy";
import { ThinkingOrb } from "@/shared/ui/ThinkingOrb";
import type { ThinkingOrbState } from "@/shared/ui/thinking-orbs";

interface ScanProgressScreenProps {
  session: ScanSessionDetail | null;
  onStop?: () => void;
}

// Each live phase maps to the orb animation that matches the kind of work in
// flight, so the indicator shows the actual activity instead of a generic spinner.
const ORB_STATE_BY_PHASE: Record<string, ThinkingOrbState> = {
  Discovery: "working",
  "Repository mapping": "searching",
  Segmentation: "shaping",
  "Path tracing": "composing",
  "Reviewing paths": "solving",
  Validation: "solving",
  Scoring: "listening",
  Completed: "listening",
};

function resolveOrbState(session: ScanSessionDetail | null, isFailed: boolean): ThinkingOrbState {
  if (isFailed) return "listening";
  const phase = session?.session.currentPhase;
  if (!phase) return "working";
  return ORB_STATE_BY_PHASE[phase] ?? "working";
}

export function ScanProgressScreen({ session, onStop }: ScanProgressScreenProps) {
  const isFailed = session?.session.status === "failed";
  const isActive = session?.session.status === "queued" || session?.session.status === "scanning";
  const isFile = session?.session.targetType === "file";
  const scopeLabel = isFile ? "file" : "codebase";
  const reviewKindLabel = isFile ? `Reviewing ${session?.session.repo ?? "file"}` : "Reviewing your codebase";
  const subLabel = isFile ? "Inspecting selected file and its immediate context" : "Inspecting repository structure, data flow, and active review signals";
  const currentLine = toAnalystCopy(session?.session.progressMessage ?? "Waiting for review updates...");
  const [revealedLineCount, setRevealedLineCount] = useState(0);
  const [activeLineCharCount, setActiveLineCharCount] = useState(0);
  const lastSessionIdRef = useRef<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const liveCandidateCount = Number(session?.session.reviewQueueSummary?.current_candidate_findings_count ?? session?.session.candidateFindingsCount ?? 0);
  const liveValidatedCount = Number(session?.session.reviewQueueSummary?.current_validated_findings_count ?? session?.session.findingsCount ?? 0);
  const progressCounters = session?.session.progressCounters as Record<string, number | string> | null | undefined;
  const animatedMetrics = useAnimatedMetrics(session, progressCounters, liveCandidateCount, liveValidatedCount);
  const liveElapsedSeconds = useLiveElapsedSeconds(session?.session.elapsedSeconds ?? 0, Boolean(isActive), session?.session.id ?? null);
  const animatedCurrentLine = useTypedText(currentLine, 14);
  const phaseSnapshot = useMemo(() => buildPhaseSnapshot(session, animatedMetrics), [animatedMetrics, session]);
  const coverageDisplay = useMemo(() => buildCoverageDisplay(session, phaseSnapshot, animatedMetrics), [animatedMetrics, phaseSnapshot, session]);
  const pathDisplay = useMemo(() => buildPathDisplay(session, animatedMetrics), [animatedMetrics, session]);

  useEffect(() => {
    const nextSessionId = session?.session.id ?? null;
    if (lastSessionIdRef.current === nextSessionId) return;

    lastSessionIdRef.current = nextSessionId;
    setRevealedLineCount(0);
    setActiveLineCharCount(0);
    stickToBottomRef.current = true;
  }, [session?.session.id]);

  const orbState = resolveOrbState(session, Boolean(isFailed));
  const isCompleted = session?.session.status === "completed" || session?.session.status === "failed";
  const stageLines = useMemo(() => {
    if (!session) {
      return ["Waiting for review to start..."];
    }

    return buildLiveStageLines(session.session.progressLogs, currentLine);
  }, [currentLine, session]);

  useEffect(() => {
    if (isCompleted) {
      setRevealedLineCount(stageLines.length - 1);
      setActiveLineCharCount(stageLines[stageLines.length - 1]?.length ?? 0);
      return;
    }
    if (stageLines.length === 0) return;

    if (revealedLineCount > stageLines.length - 1) {
      setRevealedLineCount(Math.max(stageLines.length - 1, 0));
      setActiveLineCharCount(0);
      return;
    }

    const activeLine = stageLines[revealedLineCount] ?? "";
    if (!activeLine) return;

    if (activeLineCharCount > activeLine.length) {
      setActiveLineCharCount(activeLine.length);
      return;
    }

    const timeout = window.setTimeout(() => {
      if (activeLineCharCount < activeLine.length) {
        setActiveLineCharCount((current) => Math.min(current + 2, activeLine.length));
        return;
      }

      if (revealedLineCount < stageLines.length - 1) {
        setRevealedLineCount((current) => current + 1);
        setActiveLineCharCount(0);
      }
    }, activeLineCharCount < activeLine.length ? 18 : 140);

    return () => window.clearTimeout(timeout);
  }, [activeLineCharCount, isCompleted, revealedLineCount, stageLines]);

  const visibleStageLines = useMemo(() => {
    if (stageLines.length === 0) {
      return [];
    }
    if (isCompleted) return stageLines;

    return stageLines
      .map((line, index) => {
        if (index < revealedLineCount) {
          return line;
        }

        if (index === revealedLineCount) {
          return line.slice(0, Math.max(activeLineCharCount, 1));
        }

        return "";
      })
      .filter(Boolean);
  }, [activeLineCharCount, isCompleted, revealedLineCount, stageLines]);

  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) return;
    if (!stickToBottomRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [activeLineCharCount, revealedLineCount, visibleStageLines.length]);

  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) return;

    const updateStickToBottom = () => {
      const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0);
      stickToBottomRef.current = maxScrollTop - container.scrollTop <= 32;
    };

    updateStickToBottom();
    container.addEventListener("scroll", updateStickToBottom);
    window.addEventListener("resize", updateStickToBottom);

    return () => {
      container.removeEventListener("scroll", updateStickToBottom);
      window.removeEventListener("resize", updateStickToBottom);
    };
  }, [visibleStageLines.length, activeLineCharCount, revealedLineCount]);

  return (
    <div
      className="hide-scrollbar flex min-h-0 flex-1 items-start justify-center overflow-y-auto bg-surface px-6 py-8 pb-14"
    >
      <div className="mx-auto flex w-full max-w-[820px] flex-col items-center">
        <ThinkingOrb state={orbState} size={64} paused={Boolean(isFailed)} decorative />

        <p className="mt-3 text-center text-[12px] font-medium uppercase tracking-[0.16em] text-txt-tertiary">
          {isFailed ? "Review failed" : `Live ${scopeLabel} review`}
        </p>
        <h2 className="mt-2 text-center text-[26px] font-semibold tracking-[-0.03em] text-txt-primary">
          {isFailed ? "The review could not be completed" : `${reviewKindLabel} for issues`}
        </h2>

        <p className="mt-2.5 max-w-[560px] text-center text-[13.5px] leading-6 text-txt-secondary">
          {isFailed ? "Open Settings → Providers to verify the model and API key, then run the review again" : subLabel}
        </p>
        {isActive && onStop && (
          <button onClick={onStop} className="mt-3.5 rounded-full border border-txt-tertiary/20 px-4 py-1.5 text-[12px] font-medium text-txt-secondary hover:bg-muted/50">Stop review</button>
        )}

        <div className="mt-8 w-full">
          <ProgressBar value={animatedMetrics.actualProgress}>
            <ProgressBarHeader>
              <Label className="inline-flex items-center gap-2">
                {!isFailed && isActive && <ThinkingOrb state={orbState} size={20} decorative />}
                {isFailed ? "Code review failed" : `${scopeLabel} review in progress`}
              </Label>
              <ProgressBarValue />
            </ProgressBarHeader>
            <ProgressBarTrack className="bg-[#e5e5e5] [--progress-content-bg:hsl(var(--primary))]" />
            <Description className="h-6 overflow-hidden text-ellipsis whitespace-nowrap">
              {animatedCurrentLine}
            </Description>
          </ProgressBar>
        </div>

        {session && (
          <div className="mt-3 w-full rounded-xl border bg-card px-4 py-3.5" style={{ borderColor: "hsl(var(--border-soft))" }}>
            <div className="flex items-center justify-between gap-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-txt-tertiary">
                Current Phase Progress
              </p>
              <p className="text-xs text-txt-secondary">
                {animatedMetrics.phaseProgress}% of {session.session.currentPhase.toLowerCase()}
              </p>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-md bg-[#e5e5e5]">
              <div
                className="h-full rounded-md bg-primary"
                style={{ width: `${animatedMetrics.phaseProgress}%` }}
              />
            </div>
            <p className="mt-2.5 text-xs leading-5 text-txt-secondary">
              {describePhaseCounters(session.session.currentPhase, animatedMetrics)}
            </p>
          </div>
        )}

        {session && (
          <div className={`mt-3 grid w-full gap-2 ${session.session.targetType === "file" ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
            <ProgressInfoCard
              label="Mode and phase"
              value={session.session.scanMode === "deep" ? "Deep review" : "Fast review"}
              note={`${session.session.currentPhase} · ${formatElapsedSeconds(liveElapsedSeconds)}`}
            />
            <ProgressInfoCard
              label="Coverage progress"
              value={coverageDisplay.value}
              note={coverageDisplay.note}
            />
            {session.session.targetType !== "file" && (
              <>
                <ProgressInfoCard
                  label="Path review"
                  value={pathDisplay.value}
                  note={pathDisplay.note}
                />
                <ProgressInfoCard
                  label="Live inventory"
                  value={phaseSnapshot.value}
                  note={phaseSnapshot.note}
                />
              </>
            )}
          </div>
        )}

        <div
          className="mt-4 w-full overflow-hidden rounded-2xl border bg-card"
          style={{ borderColor: "hsl(var(--border-soft))" }}
        >
          <div ref={logContainerRef} className="hide-scrollbar max-h-[320px] min-h-[200px] overflow-y-auto px-5 py-4">
            <div className="space-y-2">
              {visibleStageLines.map((line, index) => (
                <div
                  key={`stage-line-${index}`}
                  className="flex items-start gap-3 text-[13px] leading-6 text-txt-secondary"
                >
                  {index === visibleStageLines.length - 1 && !isFailed ? (
                    <ThinkingOrb state={orbState} size={20} className="mt-0.5 shrink-0" decorative />
                  ) : (
                    <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-txt-tertiary" />
                  )}
                  <span className={`min-w-0 break-words leading-6 ${index === visibleStageLines.length - 1 && !isFailed ? "text-txt-primary" : ""}`}>
                    {toAnalystCopy(line)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {isFailed && session?.errorMessage && (
          <div className="mt-5 w-full rounded-xl border px-5 py-4 text-sm leading-6" style={{ borderColor: "hsl(var(--status-critical) / 0.25)" }}>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-status-critical">What went wrong</p>
            <p className="mt-1.5 text-status-critical">{toAnalystCopy(session.errorMessage)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressInfoCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="flex min-h-[84px] flex-col overflow-hidden rounded-xl border bg-card px-3.5 py-3 shadow-[0_8px_18px_rgba(0,0,0,0.025)]" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-txt-tertiary">{label}</p>
      <p className="mt-1.5 truncate text-[12.5px] font-semibold leading-5 text-txt-primary" title={value}>{value}</p>
      <p className="mt-1 line-clamp-2 overflow-hidden text-xs leading-5 text-txt-secondary" title={note}>{note}</p>
    </div>
  );
}

function formatElapsedSeconds(value: number) {
  const totalSeconds = Math.max(0, value);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    days > 0 ? `${days}d` : null,
    days > 0 || hours > 0 ? `${hours}h` : null,
    days > 0 || hours > 0 || minutes > 0 ? `${minutes}m` : null,
    `${seconds}s`,
  ].filter(Boolean);

  return parts.join(" ");
}

function useLiveElapsedSeconds(baseElapsedSeconds: number, active: boolean, sessionId: string | null) {
  const [elapsedSeconds, setElapsedSeconds] = useState(baseElapsedSeconds);

  useEffect(() => {
    setElapsedSeconds(baseElapsedSeconds);
  }, [baseElapsedSeconds, sessionId]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active, sessionId]);

  return elapsedSeconds;
}

function useTypedText(value: string, chunkSize = 2) {
  const [typedValue, setTypedValue] = useState(value);
  const [targetValue, setTargetValue] = useState(value);

  useEffect(() => {
    setTargetValue(value);
    setTypedValue((current) => (value.startsWith(current) ? current : ""));
  }, [value]);

  useEffect(() => {
    if (typedValue === targetValue) return;
    const timer = window.setTimeout(() => {
      setTypedValue(targetValue.slice(0, Math.min(typedValue.length + chunkSize, targetValue.length)));
    }, 16);
    return () => window.clearTimeout(timer);
  }, [chunkSize, targetValue, typedValue]);

  return typedValue;
}

type AnimatedMetrics = ReturnType<typeof buildAnimatedMetricTargets>;

function useAnimatedMetrics(
  session: ScanSessionDetail | null,
  counters: Record<string, number | string> | null | undefined,
  liveCandidateCount: number,
  liveValidatedCount: number,
) {
  const targets = useMemo(
    () => buildAnimatedMetricTargets(session, counters, liveCandidateCount, liveValidatedCount),
    [counters, liveCandidateCount, liveValidatedCount, session],
  );
  const [metrics, setMetrics] = useState<AnimatedMetrics>(targets);
  const metricsRef = useRef(metrics);

  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  useEffect(() => {
    const start = performance.now();
    const duration = 420;
    let frame = 0;

    const from = metricsRef.current;
    const to = targets;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Object.fromEntries(
        Object.keys(to).map((key) => {
          const fromValue = from[key as keyof AnimatedMetrics] ?? 0;
          const toValue = to[key as keyof AnimatedMetrics] ?? 0;
          return [key, fromValue + (toValue - fromValue) * eased];
        }),
      ) as AnimatedMetrics;
      setMetrics(next);
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [targets]);

  return useMemo(
    () =>
      Object.fromEntries(
        Object.entries(metrics).map(([key, value]) => [key, Math.max(0, Math.round(Number(value) || 0))]),
      ) as AnimatedMetrics,
    [metrics],
  );
}

function buildAnimatedMetricTargets(
  session: ScanSessionDetail | null,
  counters: Record<string, number | string> | null | undefined,
  liveCandidateCount: number,
  liveValidatedCount: number,
) {
  return {
    actualProgress: numberValue(session?.session.progress),
    phaseProgress: numberValue(session?.session.phaseProgress),
    coveragePercent: numberValue(session?.session.coveragePercent),
    reviewedFilesCount: numberValue(session?.session.reviewedFilesCount),
    eligibleFilesCount: numberValue(session?.session.eligibleFilesCount),
    reviewedBlocksCount: numberValue(session?.session.reviewedBlocksCount),
    totalBlocksCount: numberValue(session?.session.totalBlocksCount),
    totalPathsCount: numberValue(session?.session.totalPathsCount),
    tracedPathsCount: numberValue(session?.session.tracedPathsCount),
    candidateFindingsCount: numberValue(liveCandidateCount),
    validatedFindingsCount: numberValue(liveValidatedCount),
    files_indexed: numberValue(counters?.files_indexed),
    files_total: numberValue(counters?.files_total),
    mapping_artifacts_ready: numberValue(counters?.mapping_artifacts_ready || counters?.mapping_units_completed),
    mapping_artifacts_total: numberValue(counters?.mapping_artifacts_total || counters?.mapping_units_total),
    mapping_ai_steps_completed: numberValue(counters?.mapping_ai_steps_completed),
    mapping_ai_steps_total: numberValue(counters?.mapping_ai_steps_total),
    files_segmented: numberValue(counters?.files_segmented),
    files_to_segment: numberValue(counters?.files_to_segment),
    paths_prepared: numberValue(counters?.paths_prepared),
    paths_total: numberValue(counters?.paths_total),
    review_items_prepared: numberValue(counters?.review_items_prepared),
    review_items_total: numberValue(counters?.review_items_total),
    blocks_reviewed: numberValue(counters?.blocks_reviewed),
    blocks_total: numberValue(counters?.blocks_total),
    review_batches_completed: numberValue(counters?.review_batches_completed),
    review_batches_total: numberValue(counters?.review_batches_total),
    candidates_validated: numberValue(counters?.candidates_validated),
    candidates_total: numberValue(counters?.candidates_total),
    validation_artifacts_ready: numberValue(counters?.validation_artifacts_ready),
    validation_artifacts_total: numberValue(counters?.validation_artifacts_total),
    artifacts_finalized: numberValue(counters?.artifacts_finalized),
    artifacts_total: numberValue(counters?.artifacts_total),
  };
}

function buildLiveStageLines(progressLogs: string[], currentLine: string) {
  const normalizedCurrentLine = normalizeStageLine(currentLine);
  const nextLines: string[] = [];
  const signatures: string[] = [];

  progressLogs
    .filter(Boolean)
    .map((entry) => toAnalystCopy(entry))
    .forEach((line) => {
      const normalizedLine = normalizeStageLine(line);
      if (!normalizedLine) return;
      if (normalizedLine === normalizedCurrentLine) return;
      if (signatures.some((signature) => areStageLinesTooSimilar(signature, normalizedLine))) {
        return;
      }
      signatures.push(normalizedLine);
      nextLines.push(line.trim());
    });

  if (normalizedCurrentLine) {
    const duplicateIndex = signatures.findIndex((signature) =>
      areStageLinesTooSimilar(signature, normalizedCurrentLine),
    );
    if (duplicateIndex >= 0) {
      nextLines.splice(duplicateIndex, 1);
      signatures.splice(duplicateIndex, 1);
    }
    nextLines.push(currentLine.trim());
  }

  return nextLines.length > 0 ? nextLines : ["Review is preparing the next live update..."];
}

function normalizeStageLine(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function areStageLinesTooSimilar(left: string, right: string) {
  if (!left || !right) return false;
  if (left === right) return true;

  const leftTokens = left.split(" ").filter(Boolean);
  const rightTokens = right.split(" ").filter(Boolean);
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let overlap = 0;

  leftSet.forEach((token) => {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  });

  const union = new Set([...leftSet, ...rightSet]).size;
  if (union === 0) return false;

  const similarity = overlap / union;
  return similarity >= 0.82;
}

function describePhaseCounters(
  phase: string,
  counters: Record<string, number | string> | null | undefined,
) {
  if (!counters) {
    return "Waiting for live work-unit counters";
  }

  if (phase === "Discovery") {
    return `${numberValue(counters.files_indexed)}/${numberValue(counters.files_total)} files indexed`;
  }
  if (phase === "Repository mapping") {
    const artifactReady = numberValue(counters.mapping_artifacts_ready || counters.mapping_units_completed);
    const artifactTotal = numberValue(counters.mapping_artifacts_total || counters.mapping_units_total);
    const aiReady = numberValue(counters.mapping_ai_steps_completed);
    const aiTotal = numberValue(counters.mapping_ai_steps_total);
    if (aiTotal > 0) {
      return `${artifactReady}/${artifactTotal} mapping artifacts ready, ${aiReady}/${aiTotal} AI boundary summaries completed`;
    }
    return `${artifactReady}/${artifactTotal} mapping artifacts ready`;
  }
  if (phase === "Segmentation") {
    return `${numberValue(counters.files_segmented)}/${numberValue(counters.files_to_segment)} files segmented`;
  }
  if (phase === "Path tracing") {
    return `${numberValue(counters.paths_prepared)}/${numberValue(counters.paths_total)} paths prepared, ${numberValue(counters.review_items_prepared)}/${numberValue(counters.review_items_total)} review items queued`;
  }
  if (phase === "Reviewing paths") {
    return `${numberValue(counters.blocks_reviewed)}/${numberValue(counters.blocks_total)} blocks reviewed, ${numberValue(counters.review_batches_completed)}/${numberValue(counters.review_batches_total)} batches completed`;
  }
  if (phase === "Validation") {
    return `${numberValue(counters.candidates_validated)}/${numberValue(counters.candidates_total)} candidate findings validated, ${numberValue(counters.validation_artifacts_ready)}/${numberValue(counters.validation_artifacts_total)} validation artifacts ready`;
  }
  if (phase === "Scoring") {
    return `${numberValue(counters.artifacts_finalized)}/${numberValue(counters.artifacts_total)} scoring artifacts finalized`;
  }
  return "Awaiting the next work-unit update";
}

function numberValue(value: number | string | undefined) {
  return Number(value ?? 0);
}

function buildCoverageDisplay(
  session: ScanSessionDetail | null,
  phaseSnapshot: { value: string; note: string },
  metrics: AnimatedMetrics,
) {
  if (!session) {
    return {
      value: "Waiting for coverage",
      note: "Coverage counters begin after repository review starts",
    };
  }

  const phase = session.session.currentPhase;
  const reviewHasStarted = metrics.reviewedBlocksCount > 0 || phase === "Reviewing paths" || phase === "Validation" || phase === "Scoring" || phase === "Completed";
  if (!reviewHasStarted) {
    return {
      value: "Coverage pending",
      note: "Coverage metrics will appear once prioritized files enter active review",
    };
  }

  return {
    value: `${metrics.coveragePercent}% coverage`,
    note: `${metrics.reviewedFilesCount}/${metrics.eligibleFilesCount || metrics.reviewedFilesCount} files, ${metrics.reviewedBlocksCount}/${metrics.totalBlocksCount || metrics.reviewedBlocksCount} blocks`,
  };
}

function buildPathDisplay(session: ScanSessionDetail | null, metrics: AnimatedMetrics) {
  if (!session) {
    return {
      value: "Waiting for path inventory",
      note: "",
    };
  }

  const pathSummary = (session.session.pathSummary ?? {}) as Record<string, unknown>;
  const candidatePathSummary = Number(pathSummary.candidate_path_count);
  const candidatePaths = Number.isFinite(candidatePathSummary) ? candidatePathSummary : Number(metrics.totalPathsCount ?? 0);
  const reviewedPaths = Number(metrics.tracedPathsCount ?? 0);
  const preparedPaths = Number(metrics.paths_prepared ?? 0);
  const preparedPathsTotal = Number(metrics.paths_total ?? 0);
  const totalPaths = Number(metrics.totalPathsCount ?? 0);
  const phase = session.session.currentPhase;

  if (session.session.status === "completed" && reviewedPaths <= 0 && candidatePaths <= 0) {
    return {
      value: "No path candidates",
      note: "Path tracing ran but found no source-to-sink candidates in this run",
    };
  }
  if ((phase === "Discovery" || phase === "Repository mapping" || phase === "Segmentation") && candidatePaths <= 0 && reviewedPaths <= 0) {
    return {
      value: "Path tracing pending",
      note: "Path inventory appears after segmentation completes",
    };
  }
  if (preparedPathsTotal > 0 && reviewedPaths <= 0 && candidatePaths <= 0) {
    return {
      value: `${preparedPaths}/${preparedPathsTotal} paths prepared`,
      note: "Tracing is building candidate source-to-sink paths",
    };
  }
  if (phase === "Reviewing paths" && reviewedPaths <= 0 && candidatePaths <= 0 && totalPaths <= 0) {
    return {
      value: "Path review pending",
      note: "Review starts after path inventory is available",
    };
  }
  if (reviewedPaths <= 0 && candidatePaths > 0) {
    return {
      value: `${candidatePaths} candidate paths`,
      note: "Inventory prepared",
    };
  }
  if (reviewedPaths <= 0 && totalPaths <= 0) {
    return {
      value: "Path review pending",
      note: "No reviewable path inventory has been reported yet",
    };
  }
  return {
    value: `${reviewedPaths}/${totalPaths || reviewedPaths} paths`,
    note: "",
  };
}

function buildPhaseSnapshot(
  session: ScanSessionDetail | null,
  counters: Record<string, number | string> | null | undefined,
) {
  if (!session || !counters) {
    return {
      value: "Awaiting work units",
      note: "Live review counters will appear as soon as discovery starts",
    };
  }

  if (session.session.currentPhase === "Discovery") {
    return {
      value: `${numberValue(counters.files_indexed)}/${numberValue(counters.files_total)} files indexed`,
      note: "Repository discovery is building the file inventory",
    };
  }
  if (session.session.currentPhase === "Repository mapping") {
    return {
      value: `${numberValue(counters.mapping_artifacts_ready || counters.mapping_units_completed)}/${numberValue(counters.mapping_artifacts_total || counters.mapping_units_total)} artifacts ready`,
      note: "Repository structure, dependency markers, and review metadata are being prepared",
    };
  }
  if (session.session.currentPhase === "Segmentation") {
    return {
      value: `${numberValue(counters.files_segmented)}/${numberValue(counters.files_to_segment)} files segmented`,
      note: "The review queue is being narrowed to code blocks and high-risk path units",
    };
  }
  if (session.session.currentPhase === "Path tracing") {
    return {
      value: `${numberValue(counters.paths_prepared)}/${numberValue(counters.paths_total)} paths prepared`,
      note: `${numberValue(counters.review_items_prepared)}/${numberValue(counters.review_items_total)} review items are queued for review`,
    };
  }
  if (session.session.currentPhase === "Reviewing paths") {
    return {
      value: `${numberValue(counters.review_batches_completed)}/${numberValue(counters.review_batches_total)} batches completed`,
      note: "Active review is progressing through prioritized code paths",
    };
  }
  if (session.session.currentPhase === "Validation") {
    return {
      value: `${numberValue(counters.candidates_validated)}/${numberValue(counters.candidates_total)} candidates validated`,
      note: "Candidate findings are being confirmed before reporting",
    };
  }
  if (session.session.currentPhase === "Scoring") {
    return {
      value: `${numberValue(counters.artifacts_finalized)}/${numberValue(counters.artifacts_total)} score artifacts ready`,
      note: "Coverage and evidence summaries are being finalized",
    };
  }
  return {
    value: session.session.currentPhase,
    note: "Awaiting the next live work-unit update",
  };
}
