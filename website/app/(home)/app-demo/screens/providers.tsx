'use client';

import { CheckCircle2, KeyRound, Plug, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DEMO_PROVIDERS } from '../data';
import { SectionLabel } from '../parts';
import { card, faint, label, mono, muted, tile } from '../tokens';

const STATE_COPY = {
  active: { text: 'Active', tone: 'text-[hsl(var(--cr-success))]' },
  ready: { text: 'Tested', tone: 'text-[hsl(var(--cr-text-secondary))]' },
  unset: { text: 'No key', tone: 'text-[hsl(var(--cr-text-tertiary))]' },
} as const;

export function ProvidersScreen() {
  return (
    <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <div className="mx-auto max-w-[620px] space-y-3">
        <div>
          <SectionLabel>Settings</SectionLabel>
          <h2 className="mt-2 text-[19px] font-semibold tracking-[-0.02em] text-[hsl(var(--cr-text-primary))]">
            Providers
          </h2>
          <p className={cn('mt-1.5 text-[12px] leading-5', muted)}>
            CodeRadar talks to any OpenAI-compatible chat-completions endpoint. A key is tested with a live call
            before it is saved, then listed back masked once it is active.
          </p>
        </div>

        <div className="space-y-2">
          {DEMO_PROVIDERS.map((provider) => {
            const state = STATE_COPY[provider.state];
            return (
              <div key={provider.id} className={cn(card, 'px-4 py-3.5')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Plug className={cn('size-3.5 shrink-0', faint)} />
                    <p className="truncate text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">
                      {provider.name}
                    </p>
                  </div>
                  <span className={cn('shrink-0 text-[10.5px] font-medium uppercase tracking-[0.14em]', state.tone)}>
                    {state.text}
                  </span>
                </div>

                <div className={cn(tile, 'mt-2.5 space-y-1.5 px-3 py-2.5')}>
                  <div className="flex items-center gap-2">
                    <span className={cn(label, 'w-[58px] shrink-0 text-[9.5px]')}>Endpoint</span>
                    <span className={cn(mono, 'truncate text-[hsl(var(--cr-text-secondary))]')} title={provider.endpoint}>
                      {provider.endpoint}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(label, 'w-[58px] shrink-0 text-[9.5px]')}>Model</span>
                    <span className={cn(mono, 'truncate text-[hsl(var(--cr-text-secondary))]')}>{provider.model}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(label, 'w-[58px] shrink-0 text-[9.5px]')}>Key</span>
                    <span className={cn(mono, 'inline-flex items-center gap-1.5 text-[hsl(var(--cr-text-secondary))]')}>
                      <KeyRound className="size-3" />
                      {provider.maskedKey ?? 'Not set'}
                    </span>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <span className={cn('inline-flex items-center gap-1.5 text-[10.5px]', faint)}>
                    {provider.lastTested ? (
                      <>
                        <CheckCircle2 className="size-3" />
                        Connection tested {provider.lastTested}
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="size-3" />
                        A key is required before this provider can be used
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    className="rounded-lg border border-[hsl(var(--cr-border))] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--cr-text-secondary))] transition-colors hover:bg-[hsl(var(--cr-tile))]"
                  >
                    {provider.state === 'unset' ? 'Add key' : 'Test connection'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className={cn(tile, 'rounded-2xl px-4 py-3.5')}>
          <SectionLabel>Where the key lives</SectionLabel>
          <p className={cn('mt-2 text-[11.5px] leading-5', muted)}>
            The key is encrypted with the OS keychain before it is written. On a machine with no key store, the app
            refuses to save one rather than writing it in clear. The review itself runs locally; the only network
            call is the one this screen configures.
          </p>
        </div>
      </div>
    </div>
  );
}
