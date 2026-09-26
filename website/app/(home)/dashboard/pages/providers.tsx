'use client';

import { cn } from '@/lib/cn';
import { demoMutedText } from '../tokens';
import { Reveal, SectionCard, StatusPill } from '../shared';

const providers = [
  { name: 'OpenAI-compatible', detail: 'Any chat-completions endpoint', status: 'Active · key masked ••••9f2c', tone: 'success' as const },
  { name: 'Deterministic detectors', detail: 'Always on · no key needed', status: 'Built in', tone: 'neutral' as const },
  { name: 'Replay (offline)', detail: 'Record once, replay without network', status: 'Local only', tone: 'neutral' as const },
];

export function ProvidersDemoPage() {
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3">
      <Reveal index={0}>
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-white">Connect a provider</h2>
        <p className={cn('mt-1 text-[12.5px] leading-5', 'text-white/55')}>
          The key is tested with a live call before it is saved. AI is opt-in — without it, the deterministic
          checks still run.
        </p>
      </Reveal>

      {providers.map((provider, index) => (
        <Reveal key={provider.name} index={index + 1}>
          <SectionCard
            title={provider.name}
            action={<StatusPill label={provider.status} tone={provider.tone} />}
          >
            <p className={cn('text-xs leading-5', demoMutedText)}>{provider.detail}</p>
            {index === 0 && (
              <div className="mt-3 grid gap-2">
                <div className="flex h-9 items-center rounded-lg border border-white/10 bg-[#232323] px-3 font-mono text-[11px] text-white/60">
                  https://api.provider.example/v1/chat/completions
                </div>
                <div className="flex gap-2">
                  <div className="flex h-9 flex-1 items-center rounded-lg border border-white/10 bg-[#232323] px-3 font-mono text-[11px] text-white/60">
                    gpt-5-codex · live-tested
                  </div>
                  <span className="inline-flex h-9 items-center rounded-lg bg-white px-4 text-[12.5px] font-medium text-black">
                    Save
                  </span>
                </div>
              </div>
            )}
          </SectionCard>
        </Reveal>
      ))}

      <Reveal index={4}>
        <p className={cn('text-[11px] leading-5', demoMutedText)}>
          The key is encrypted with the OS keychain. On a machine with no key store the app refuses to save one
          rather than writing it in clear.
        </p>
      </Reveal>
    </div>
  );
}
