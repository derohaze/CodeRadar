'use client';

import { cn } from '@/lib/cn';
import { demoMutedText } from '../tokens';
import { Reveal, SectionCard, StatusPill } from '../shared';

/* Mirrors frontend HomeScreen: pick a source, choose a preset, run the review. */

export function SetupDemoPage({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3">
      <Reveal index={0}>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">Review setup</p>
        <h2 className="mt-1.5 text-[20px] font-semibold tracking-[-0.02em] text-white">Start a code review</h2>
        <p className={cn('mt-1 text-[12.5px] leading-5', 'text-white/55')}>Pick a folder or file, choose a preset, and run the review</p>
      </Reveal>

      <Reveal index={1}>
        <div className="rounded-[16px] border border-white/[0.06] bg-[#1e1e1e] p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-medium tracking-wide text-white/50">Workspace</p>
              <div className="mt-1.5 flex h-8 items-center rounded-lg border border-white/10 bg-[#232323] px-3 text-[12.5px] text-white/80">
                <span className="truncate">~/repos/coderadar-desktop</span>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-medium tracking-wide text-white/50">Preset</p>
              <div className="mt-1.5 flex h-8 items-center rounded-lg border border-white/10 bg-[#232323] px-3 text-[12.5px] text-white">
                Balanced
              </div>
              <p className="mt-1 text-[11px] leading-4 text-white/35">Evidence-gated findings, moderate depth</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-medium tracking-wide text-white/50">Review mode</p>
              <div className="mt-1.5 flex h-8 items-center rounded-full border border-white/10 bg-[#232323] px-3 text-[12.5px] text-white">
                Deep review
              </div>
            </div>
            <div>
              <p className="text-[11px] font-medium tracking-wide text-white/50">Target</p>
              <div className="relative mt-1.5 inline-flex rounded-full border border-white/10 bg-[#232323] p-0.5">
                <div aria-hidden="true" className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-white" />
                <span className="relative z-10 inline-flex min-w-[84px] items-center justify-center rounded-full px-4 py-1.5 text-[12px] font-medium text-black">Folder</span>
                <span className="relative z-10 inline-flex min-w-[84px] items-center justify-center rounded-full px-4 py-1.5 text-[12px] font-medium text-white/60">File</span>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#232323] px-3 py-2">
              <span className="text-[11px] font-medium tracking-wide text-white/40">PATH</span>
              <span className="truncate font-mono text-[11px] text-white/60">engine/src</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onStart}
            className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-white px-4 text-[13px] font-medium text-black hover:bg-white/90"
          >
            Run review
          </button>
        </div>
      </Reveal>

      <Reveal index={2}>
        <SectionCard title="Why this step matters">
          <p className={cn('text-xs leading-5', demoMutedText)}>
            Scope first, model second. The engine discovers the repository, indexes languages and hotspots,
            then reviews only what is in scope — the same pipeline serves the desktop app and the CLI.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusPill label="local-first" tone="neutral" />
            <StatusPill label="no code leaves disk by default" tone="success" />
          </div>
        </SectionCard>
      </Reveal>
    </div>
  );
}
