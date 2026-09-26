'use client';

import { type CSSProperties } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Activity01Icon,
  ChartBarBigIcon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';
import {
  demoCard,
  demoEase,
  demoMutedText,
  demoSoftTile,
  type PillTone,
} from '../tokens';
import {
  demoSearchAudits,
  demoSeoChecks,
  demoAeoChecks,
  demoGeoChecks,
} from '../data';
import { Reveal, SectionCard, StatusPill } from '../shared';

function SearchOptimizationDemoPage({
  title,
  description,
  analyzeTitle,
  scoreLabel,
  score,
  summary,
  checks,
  recommendations,
}: {
  title: string;
  description: string;
  analyzeTitle: string;
  scoreLabel: string;
  score: number;
  summary: string;
  checks: Array<{ label: string; value: string; tone: PillTone }>;
  recommendations: string[];
}) {
  return (
    <div className="mx-auto w-full max-w-5xl min-w-0 space-y-5 overflow-hidden">
      <Reveal index={0} className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold md:text-2xl">{title}</h2>
          <p className={cn('mt-1 max-w-2xl text-xs leading-5', demoMutedText)}>{description}</p>
        </div>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#f2f2f2] px-3 text-xs font-semibold transition-colors hover:bg-[#e8e8e8] dark:bg-[#242424] dark:hover:bg-[#303030]"
        >
          <HugeiconsIcon icon={Activity01Icon} size={15} strokeWidth={1.8} />
          Recent audits
          <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-[#303030]">3</span>
        </button>
      </Reveal>

      <Reveal index={1}>
        <section className={cn('w-full max-w-full min-w-0 overflow-hidden rounded-2xl p-4 sm:p-6', demoCard)}>
          <div className="mb-2 flex items-center gap-2">
            <HugeiconsIcon icon={ChartBarBigIcon} size={18} strokeWidth={1.8} />
            <h3 className="text-base font-semibold">{analyzeTitle}</h3>
          </div>
          <p className={cn('mb-5 text-xs leading-5', demoMutedText)}>
            Run a mock analysis against a public page. Demo target is intentionally fake.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className={cn('flex min-h-12 min-w-0 flex-1 items-center overflow-hidden rounded-xl px-3 text-xs tabular-nums sm:text-sm', demoSoftTile)}>
              <span className="truncate">https://example.com/products/leather-crossbody-bag</span>
            </div>
            <button type="button" className="h-12 rounded-xl bg-neutral-900 px-5 text-sm font-semibold text-white">
              Analyze
            </button>
          </div>
        </section>
      </Reveal>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
        <Reveal index={2}>
          <SectionCard title={scoreLabel}>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="relative flex h-32 w-32 shrink-0 items-center justify-center rounded-full bg-[conic-gradient(#111_0_var(--score),#f2f2f2_var(--score)_100%)] dark:bg-[conic-gradient(#f5f5f5_0_var(--score),#303030_var(--score)_100%)]" style={{ '--score': `${score}%` } as CSSProperties}>
                <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white dark:bg-[#101010]">
                  <span className="text-3xl font-semibold tabular-nums">{score}</span>
                  <span className={cn('text-[10px] font-semibold uppercase tracking-[0.08em]', demoMutedText)}>Score</span>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-6">{summary}</p>
                <div className="mt-4 grid w-full max-w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                  {checks.slice(0, 4).map((check) => (
                    <div key={check.label} className={cn('rounded-xl px-3 py-2.5', demoSoftTile)}>
                      <p className={cn('truncate text-[10px] font-semibold uppercase tracking-[0.08em]', demoMutedText)}>{check.label}</p>
                      <p className="mt-1 truncate text-xs font-semibold">{check.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
        </Reveal>

        <Reveal index={3}>
          <SectionCard title="Recent Audits">
            <div className="space-y-2">
              {demoSearchAudits.map((audit) => (
                <div key={audit.url} className={cn('rounded-xl px-3 py-2.5', demoSoftTile)}>
                  <p className="truncate text-xs font-medium tabular-nums">{audit.url}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className={cn('text-[11px]', demoMutedText)}>{audit.time}</span>
                    <span className="text-xs font-semibold tabular-nums">{audit.score}</span>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </Reveal>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Reveal index={4}>
          <SectionCard title="Analysis Details">
            <div className="space-y-2">
              {checks.map((check) => (
                <div key={check.label} className={cn('flex items-center justify-between gap-3 rounded-xl px-3 py-2.5', demoSoftTile)}>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{check.label}</p>
                    <p className={cn('truncate text-[11px]', demoMutedText)}>{check.value}</p>
                  </div>
                  <StatusPill label={check.tone === 'success' ? 'Pass' : check.tone === 'warning' ? 'Review' : 'Info'} tone={check.tone} />
                </div>
              ))}
            </div>
          </SectionCard>
        </Reveal>
        <Reveal index={5}>
          <SectionCard title="Recommendations">
            <div className="space-y-2">
              {recommendations.map((recommendation, index) => (
                <div key={recommendation} className={cn('flex items-start gap-3 rounded-xl px-3 py-2.5', demoSoftTile)}>
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-semibold text-white">
                    {index + 1}
                  </span>
                  <p className="text-xs leading-5">{recommendation}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </Reveal>
      </div>
    </div>
  );
}

export function SeoDemoPage() {
  return (
    <SearchOptimizationDemoPage
      title="SEO Analysis"
      description="Technical and on-page search audit for a storefront URL."
      analyzeTitle="Analyze SEO readiness"
      scoreLabel="SEO Health Score"
      score={86}
      summary="example.com has a strong page title, crawlable content, and indexable product structure. The main opportunity is compressing media and tightening internal anchor text."
      checks={demoSeoChecks}
      recommendations={[
        'Compress the hero image and defer non-critical product gallery media.',
        'Add descriptive internal links from category pages to this product URL.',
        'Expand the meta description with shipping and returns context.',
      ]}
    />
  );
}

export function AeoDemoPage() {
  return (
    <SearchOptimizationDemoPage
      title="AEO Analysis"
      description="Answer-engine optimization audit for AI summaries and question responses."
      analyzeTitle="Analyze answer readiness"
      scoreLabel="AEO Answer Score"
      score={78}
      summary="example.com can answer direct product questions, but FAQ structure and aggregate rating markup need more complete JSON-LD coverage."
      checks={demoAeoChecks}
      recommendations={[
        'Add FAQ JSON-LD for shipping time, materials, dimensions, and warranty questions.',
        'Move the concise product answer above long editorial copy.',
        'Add aggregateRating once review data is available in the product feed.',
      ]}
    />
  );
}

export function GeoDemoPage() {
  return (
    <SearchOptimizationDemoPage
      title="GEO Analysis"
      description="Generative-engine optimization audit for claims, definitions, and citation snippets."
      analyzeTitle="Analyze generative visibility"
      scoreLabel="GEO Readiness Score"
      score={82}
      summary="example.com is easy to summarize and cite for product intent. Clarifying claims and adding tighter definitions will improve generated answer reliability."
      checks={demoGeoChecks}
      recommendations={[
        'Turn product material claims into short, sourceable statements.',
        'Add a compact definition block for the collection and target use case.',
        'Include care instructions as standalone snippets that AI systems can cite.',
      ]}
    />
  );
}
