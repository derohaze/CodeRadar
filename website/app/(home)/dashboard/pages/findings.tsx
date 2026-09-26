'use client';

import { cn } from '@/lib/cn';
import { demoFindings, droppedCandidates } from '../data';
import { demoMutedText } from '../tokens';
import { Reveal, SectionCard, SeverityBadge, StatusPill } from '../shared';

export function FindingsDemoPage({ onSelect }: { onSelect: (id: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3">
      <Reveal index={0}>
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#1e1e1e] px-4 py-3.5">
          <div>
            <p className="text-sm font-semibold text-white">engine/src</p>
            <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-white/40">Deep review · just now</p>
          </div>
          <StatusPill label="Completed" tone="neutral" />
        </div>
      </Reveal>

      <Reveal index={1}>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-white/10 bg-[#1e1e1e] px-3 py-3 text-center">
            <p className={cn('text-[9px] font-medium uppercase tracking-[0.14em]', 'text-white/40')}>Score</p>
            <p className="mt-1 font-mono text-[22px] font-semibold text-white">82<span className="text-xs text-white/40">/100</span></p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#1e1e1e] px-3 py-3 text-center">
            <p className={cn('text-[9px] font-medium uppercase tracking-[0.14em]', 'text-white/40')}>Validated</p>
            <p className="mt-1 font-mono text-[22px] font-semibold text-white">{demoFindings.length}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#1e1e1e] px-3 py-3 text-center">
            <p className={cn('text-[9px] font-medium uppercase tracking-[0.14em]', 'text-white/40')}>Dropped</p>
            <p className="mt-1 font-mono text-[22px] font-semibold text-white">{droppedCandidates.length}</p>
          </div>
        </div>
      </Reveal>

      <Reveal index={2}>
        <SectionCard
          title="Validated findings"
          action={<span className={cn('text-[11px]', demoMutedText)}>evidence-gated</span>}
        >
          <div className="space-y-2">
            {demoFindings.map((finding) => (
              <button
                key={finding.id}
                type="button"
                onClick={() => onSelect(finding.id)}
                className="flex w-full items-start gap-3 rounded-xl border border-white/10 bg-[#232323] px-3.5 py-3 text-left transition-colors hover:bg-[#2a2a2a]"
              >
                <div className="mt-0.5">
                  <SeverityBadge severity={finding.severity} />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-snug text-white">{finding.title}</p>
                  <p className="mt-1 font-mono text-[11px] text-white/45">{finding.file}:{finding.range} · {finding.category}</p>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      </Reveal>

      <Reveal index={3}>
        <SectionCard title="Dropped candidates stay visible">
          <div className="space-y-2">
            {droppedCandidates.map((candidate) => (
              <div key={candidate.title} className="rounded-xl border border-white/10 bg-[#1e1e1e] px-3.5 py-2.5">
                <p className="text-[12px] font-medium text-white/80">{candidate.title}</p>
                <p className="mt-0.5 font-mono text-[11px] text-white/40">{candidate.reason}</p>
              </div>
            ))}
          </div>
          <p className={cn('mt-3 text-[11px] leading-5', demoMutedText)}>
            A dropped claim stays visible as a count with its reason — never silently disappearing.
          </p>
        </SectionCard>
      </Reveal>
    </div>
  );
}
