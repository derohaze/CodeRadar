'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

const visibilityChannels = [
  {
    key: 'seo' as const,
    label: 'SEO',
    signal: 'Ranking #3 · 42 keywords indexed',
  },
  {
    key: 'aeo' as const,
    label: 'AEO',
    signal: 'Featured answer · 12 questions owned',
  },
  {
    key: 'geo' as const,
    label: 'GEO',
    signal: 'Cited by 4 AI engines this week',
  },
];

const demoMutedText = 'text-neutral-500 dark:text-neutral-400';
const demoSoftTile = 'bg-[#f2f2f2] text-neutral-900 dark:bg-[#242424] dark:text-neutral-100';

export function SearchVisibilityDemo() {
  const [channel, setChannel] = useState<'seo' | 'aeo' | 'geo'>('seo');
  const active = visibilityChannels.find((item) => item.key === channel)!;

  return (
    <div className="mt-auto flex flex-col rounded-xl border bg-fd-popover text-fd-popover-foreground">
      <div className="flex h-11 items-center justify-between gap-2 border-b px-3">
        <div className="flex shrink-0 gap-1.5">
          {visibilityChannels.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setChannel(item.key)}
              className={cn(
                'cursor-pointer rounded-full px-3 py-1 text-[11px] font-semibold ring-1 transition-colors',
                channel === item.key
                  ? 'bg-neutral-900 text-white ring-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:ring-neutral-100'
                  : cn('ring-black/10 hover:bg-black/5 dark:ring-white/15 dark:hover:bg-white/10', demoMutedText),
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span
          className={cn(
            'hidden min-w-0 truncate text-[10px] font-semibold tabular-nums sm:block',
            demoMutedText,
          )}
        >
          {active.signal}
        </span>
      </div>
      <div key={channel} className="h-[168px] overflow-hidden p-3">
        {channel === 'seo' && (
          <div className="fill-mode-both animate-in fade-in slide-in-from-bottom-2 duration-500">
            <p className={cn('text-[10px]', demoMutedText)}>yourstore.com › ceramic-mug-set</p>
            <p className="mt-0.5 text-sm font-medium text-blue-700 dark:text-blue-400">
              Ceramic Mug Set (4pc) — Handmade &amp; Dishwasher Safe
            </p>
            <p className={cn('mt-0.5 text-xs leading-relaxed', demoMutedText)}>
              Product pages ship with structured data, canonical URLs, and sitemaps generated
              from your catalog — no plugins.
            </p>
            <div className="mt-2.5 flex gap-1.5">
              {['Product schema', 'Sitemap', 'Meta tags'].map((tag, index) => (
                <span
                  key={tag}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-[10px] font-semibold fill-mode-both animate-in fade-in slide-in-from-bottom-1 duration-500',
                    demoSoftTile,
                  )}
                  style={{ animationDelay: `${150 + index * 75}ms` }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
        {channel === 'aeo' && (
          <div className="fill-mode-both animate-in fade-in slide-in-from-bottom-2 duration-500">
            <p className="text-xs font-semibold">&ldquo;Is the ceramic mug set dishwasher safe?&rdquo;</p>
            <div className={cn('mt-2 rounded-lg p-2.5', demoSoftTile)}>
              <p className="text-xs leading-relaxed">
                Yes — the 4-piece set is dishwasher and microwave safe. Free shipping on orders
                over 500 EGP.
              </p>
              <p className={cn('mt-1.5 text-[10px] font-semibold', demoMutedText)}>
                Pulled from your FAQ schema · shown as a featured answer
              </p>
            </div>
          </div>
        )}
        {channel === 'geo' && (
          <div className="fill-mode-both animate-in fade-in slide-in-from-bottom-2 duration-500">
            <p className={cn('text-[10px] font-semibold uppercase tracking-[0.08em]', demoMutedText)}>
              AI engine response
            </p>
            <p className="mt-1.5 text-xs leading-relaxed">
              For handmade ceramic mugs in Egypt, <span className="font-semibold">yourstore.com</span>{' '}
              is a strong option — verified stock, clear return policy, and 4.8★ reviews.
              <span
                className={cn(
                  'ms-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold align-middle',
                  demoSoftTile,
                )}
              >
                Source: yourstore.com
              </span>
            </p>
            <p className={cn('mt-2 text-[10px] font-semibold', demoMutedText)}>
              CodeRadar keeps review facts machine-readable so your team cites evidence.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
