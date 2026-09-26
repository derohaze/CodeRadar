'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import { ThinkingOrb } from '@/components/thinking-orb';
import type { ThinkingOrbState } from '@/lib/thinking-orbs';
import { DEMO_PHASES } from '../data';
import { InfoCard } from '../parts';
import { card, faint, label, mono, muted } from '../tokens';

export function LiveReviewScreen({
  orbState,
  phaseIndex,
  phaseProgress,
  overallProgress,
  counters,
  visibleLog,
  currentLine,
  elapsedSeconds,
  onStop,
}: {
  orbState: ThinkingOrbState;
  phaseIndex: number;
  phaseProgress: number;
  overallProgress: number;
  counters: string;
  visibleLog: string[];
  currentLine: string;
  elapsedSeconds: number;
  onStop: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const phase = DEMO_PHASES[Math.min(phaseIndex, DEMO_PHASES.length - 1)];

  useEffect(() => {
    const container = logRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [visibleLog.length]);

  const elapsed = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`;

  return (
    <div className="hide-scrollbar flex min-h-0 flex-1 justify-center overflow-y-auto px-5 py-5">
      <div className="mx-auto flex w-full max-w-[640px] flex-col items-center">
        <ThinkingOrb state={orbState} size={64} decorative />

        <p className={cn(label, 'mt-3 text-center')}>Live codebase review</p>
        <h2 className="mt-2 text-center text-[22px] font-semibold tracking-[-0.03em] text-[hsl(var(--cr-text-primary))]">
          Reviewing your codebase for issues
        </h2>
        <p className={cn('mt-2 max-w-[440px] text-center text-[12.5px] leading-5', muted)}>
          Inspecting repository structure, data flow, and active review signals
        </p>

        <button
          type="button"
          onClick={onStop}
          className="mt-3 rounded-full border border-[hsl(var(--cr-border))] px-3.5 py-1.5 text-[11.5px] font-medium text-[hsl(var(--cr-text-secondary))] transition-colors hover:bg-[hsl(var(--cr-muted))]"
        >
          Stop review
        </button>

        {/* Main progress bar */}
        <div className="mt-6 w-full">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-[12px] font-medium text-[hsl(var(--cr-text-primary))]">
              <ThinkingOrb state={orbState} size={20} decorative />
              codebase review in progress
            </span>
            <span className="font-mono text-[12px] tabular-nums text-[hsl(var(--cr-text-secondary))]">
              {Math.round(overallProgress)}%
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--cr-tile))]">
            <div
              className="h-full rounded-full bg-[hsl(var(--cr-primary))] transition-[width] duration-200 ease-linear"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
          <p className={cn('mt-2 h-5 truncate text-[11.5px]', muted)}>{currentLine}</p>
        </div>

        {/* Current phase progress */}
        <div className={cn(card, 'mt-3 w-full px-3.5 py-3')}>
          <div className="flex items-center justify-between gap-3">
            <p className={label}>Current phase progress</p>
            <p className={cn('text-[11px]', muted)}>
              {Math.round(phaseProgress)}% of {phase.label.toLowerCase()}
            </p>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-md bg-[hsl(var(--cr-tile))]">
            <div
              className="h-full rounded-md bg-[hsl(var(--cr-primary))] transition-[width] duration-200 ease-linear"
              style={{ width: `${phaseProgress}%` }}
            />
          </div>
          <p className={cn('mt-2.5 text-[11px] leading-5', muted)}>{counters}</p>
        </div>

        {/* Live inventory cards */}
        <div className="mt-3 grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <InfoCard label="Mode and phase" value="Deep review" note={`${phase.label} · ${elapsed}`} />
          <InfoCard
            label="Coverage progress"
            value={overallProgress > 55 ? '100% coverage' : 'Coverage pending'}
            note={
              overallProgress > 55
                ? '9/9 files, 12/12 blocks'
                : 'Coverage metrics will appear once prioritized files enter active review'
            }
          />
          <InfoCard
            label="Path review"
            value={phaseIndex >= 3 ? '14/14 paths' : 'Path review pending'}
            note={
              phaseIndex >= 3
                ? 'Candidate source-to-sink paths are being reviewed'
                : 'Review starts after path inventory is available'
            }
          />
          <InfoCard
            label="Live inventory"
            value={counters}
            note="Active review is progressing through prioritized code paths"
          />
        </div>

        {/* Live log */}
        <div className={cn(card, 'mt-3 w-full overflow-hidden rounded-2xl')}>
          <div ref={logRef} className="hide-scrollbar max-h-[132px] min-h-[104px] overflow-y-auto px-4 py-3">
            <div className="space-y-1.5">
              {visibleLog.map((line, index) => {
                const isActive = index === visibleLog.length - 1;
                return (
                  <div key={`${line}-${index}`} className="flex items-start gap-2.5 text-[11.5px] leading-5">
                    {isActive ? (
                      <ThinkingOrb state={orbState} size={20} className="mt-0.5 shrink-0" decorative />
                    ) : (
                      <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[hsl(var(--cr-text-tertiary))]" />
                    )}
                    <span className={cn('min-w-0 break-words', isActive ? 'text-[hsl(var(--cr-text-primary))]' : muted)}>
                      {line}
                    </span>
                  </div>
                );
              })}
              {visibleLog.length === 0 && <p className={cn(mono, faint)}>Waiting for review to start…</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
