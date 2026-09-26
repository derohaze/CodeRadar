'use client';

import { useEffect, useState } from 'react';
import { ThinkingOrb } from '@/components/thinking-orb';
import { cn } from '@/lib/cn';
import { demoPhases } from '../data';
import { demoMutedText } from '../tokens';
import { Reveal } from '../shared';

/* Mirrors frontend ScanProgressScreen: the orb state follows the live phase. */

const logLines = [
  'Indexed 52 files · TypeScript, TSX, JSON',
  'Mapped 12 boundary artifacts · auth + routes',
  'Segmented 34 files into review blocks',
  'Prepared 11 candidate source-to-sink paths',
  'Reviewing block 14/18 · adapters/fs.ts',
  'Validated 4/5 candidates against source evidence',
];

export function ReviewDemoPage() {
  const [phaseIndex, setPhaseIndex] = useState(4);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhaseIndex((index) => (index + 1) % demoPhases.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, []);

  const phase = demoPhases[phaseIndex];
  const progress = Math.round(((phaseIndex + 1) / demoPhases.length) * 100);

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col items-center">
      <ThinkingOrb state={phase.orb} size={64} label={`Review ${phase.name}`} />
      <p className="mt-3 text-center text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">
        Live codebase review
      </p>
      <h2 className="mt-1.5 text-center text-[22px] font-semibold tracking-[-0.02em] text-white">
        Reviewing your codebase for issues
      </h2>
      <p className={cn('mt-1.5 max-w-[440px] text-center text-[12.5px] leading-5', 'text-white/55')}>
        {phase.name} · {phase.detail}
      </p>

      <Reveal index={1} className="mt-5 w-full">
        <div className="w-full rounded-xl border border-white/10 bg-[#1e1e1e] px-4 py-3.5">
          <div className="flex items-center justify-between gap-4">
            <p className="inline-flex items-center gap-2 text-[12px] font-medium text-white">
              <ThinkingOrb state={phase.orb} size={20} decorative />
              codebase review in progress
            </p>
            <p className="text-xs tabular-nums text-white/60">{progress}%</p>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-md bg-white/10">
            <div className="h-full rounded-md bg-white transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 h-5 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-white/60">
            {logLines[phaseIndex % logLines.length]}
          </p>
        </div>
      </Reveal>

      <Reveal index={2} className="mt-3 w-full">
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
          {demoPhases.slice(0, 4).map((item) => {
            const active = item.name === phase.name;
            return (
              <div
                key={item.name}
                className={cn(
                  'flex min-h-[72px] flex-col rounded-xl border px-3 py-2.5',
                  active ? 'border-white/25 bg-[#232323]' : 'border-white/10 bg-[#1e1e1e]',
                )}
              >
                <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/40">{item.name}</span>
                <span className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-white/80">
                  <ThinkingOrb state={item.orb} size={20} decorative />
                  {active ? 'active' : item.orb}
                </span>
              </div>
            );
          })}
        </div>
      </Reveal>

      <p className={cn('mt-3 text-center text-[11px]', demoMutedText)}>
        Each phase shows its own orb — the indicator reflects the actual work, never a generic spinner.
      </p>
    </div>
  );
}
