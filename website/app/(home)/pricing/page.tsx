import { createMetadata } from '@/lib/metadata';
import { StructuredData } from '@/components/structured-data';
import { siteConfig, repoUrl } from '@/lib/site';

export const metadata = createMetadata({
  title: 'Pricing',
  description: 'CodeRadar is free and open source. No plans, no seats, no tiers — clone the repo and run your first review.',
  path: '/pricing',
});

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${siteConfig.url}/pricing#faq`,
  mainEntity: [
    {
      '@type': 'Question',
      name: 'How much does CodeRadar cost?',
      acceptedAnswer: { '@type': 'Answer', text: 'Nothing. CodeRadar is free and open source — no plans, no seats, no tiers.' },
    },
    {
      '@type': 'Question',
      name: 'Do I need to pay for an AI provider?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Only if you want AI depth: you bring your own OpenAI-compatible endpoint and key, billed by that provider. Without one, the deterministic detectors still run.',
      },
    },
  ],
};

export default function PricingPage() {
  return (
    <main className="mx-auto w-full max-w-[860px] px-4 pb-12 pt-8 md:py-12">
      <StructuredData value={structuredData} />
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fd-muted-foreground">Pricing</p>
      <h1 className="mt-3 text-4xl font-medium tracking-tight">Free and open source. That&apos;s the whole pricing page.</h1>
      <p className="mt-4 max-w-2xl text-lg leading-8 text-fd-muted-foreground">
        No plans, no seats, no tiers. Clone the repository, run <code className="font-mono text-base">bun run dev:all</code>,
        and review your first folder. If you connect an AI provider, you pay that provider directly —
        CodeRadar itself costs nothing.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <a
          href={repoUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
        >
          Get CodeRadar on GitHub
        </a>
        <a
          href="/features"
          className="inline-flex rounded-full border bg-fd-secondary px-5 py-3 text-sm font-medium text-fd-secondary-foreground transition-colors hover:bg-fd-accent"
        >
          See what it does
        </a>
      </div>
    </main>
  );
}
