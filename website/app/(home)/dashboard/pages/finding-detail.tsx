'use client';

import { cn } from '@/lib/cn';
import { demoFindings } from '../data';
import { demoMutedText } from '../tokens';
import { Reveal, SectionCard, SeverityBadge } from '../shared';

export function FindingDetailDemoPage({ findingId }: { findingId: string | null }) {
  const finding = demoFindings.find((item) => item.id === findingId) ?? demoFindings[0];

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3">
      <Reveal index={0}>
        <div className="rounded-xl border border-white/10 bg-[#1e1e1e] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <span className={cn('text-[11px]', demoMutedText)}>confidence {finding.confidence}%</span>
          </div>
          <h2 className="mt-2 text-[16px] font-semibold leading-snug text-white">{finding.title}</h2>
          <p className="mt-1 font-mono text-[11px] text-white/45">{finding.file}:{finding.range} · {finding.category}</p>
        </div>
      </Reveal>

      <Reveal index={1}>
        <SectionCard title="Evidence — quoted from source">
          <pre className="overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-5 text-white/80">
            {finding.evidence}
          </pre>
          <p className={cn('mt-2 text-[11px] leading-5', demoMutedText)}>
            Nothing reaches a report without passing validation: the quote must exist in the named file, at a line
            in range. No bypass — not for detectors, not for the model.
          </p>
        </SectionCard>
      </Reveal>

      <Reveal index={2}>
        <SectionCard title="Consequence if it ships">
          <p className="text-[12.5px] leading-6 text-white/80">{finding.impact}</p>
        </SectionCard>
      </Reveal>

      <Reveal index={3}>
        <SectionCard title="Concrete fix" action={<span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-black">Copy prompt</span>}>
          <p className="text-[12.5px] leading-6 text-white/80">{finding.fix}</p>
          <p className={cn('mt-2 font-mono text-[11px]', demoMutedText)}>What: {finding.summary}</p>
        </SectionCard>
      </Reveal>
    </div>
  );
}
