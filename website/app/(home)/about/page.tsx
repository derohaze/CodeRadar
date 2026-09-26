import { createMetadata } from '@/lib/metadata';
import { StructuredData } from '@/components/structured-data';
import { siteConfig, repoUrl } from '@/lib/site';

export const metadata = createMetadata({
  title: 'About CodeRadar',
  description:
    'CodeRadar is an open-source, local-first code review app: point it at a file or folder and get defects it can prove, with evidence, consequence, and fix.',
  path: '/about',
});

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'AboutPage',
      '@id': `${siteConfig.url}/about#webpage`,
      url: `${siteConfig.url}/about`,
      name: 'About CodeRadar',
      description: siteConfig.description,
      isPartOf: { '@id': `${siteConfig.url}/#website` },
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteConfig.url },
          { '@type': 'ListItem', position: 2, name: 'About', item: `${siteConfig.url}/about` },
        ],
      },
    },
    {
      '@type': 'Organization',
      '@id': `${siteConfig.url}/#organization`,
      name: siteConfig.name,
      url: siteConfig.url,
      logo: `${siteConfig.url}/whitelogo.svg`,
      description: siteConfig.description,
      sameAs: [repoUrl, `${siteConfig.url}/features`],
    },
  ],
};

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-[860px] px-4 pb-12 pt-8 md:py-12">
      <StructuredData value={structuredData} />
      <h1 className="text-3xl font-semibold tracking-tight mb-6">About CodeRadar</h1>

      <div className="space-y-6 text-lg leading-9 text-fd-foreground">
        <p>
          CodeRadar is an <strong>open-source, local-first code review app</strong>. You point it at
          a file or a folder, it reads the code, and it reports the defects it can prove — each with
          the quoted evidence it came from, the consequence if it ships, and a concrete fix.
        </p>
        <p>
          Everything runs on your machine. One runtime — <strong>Electron + Node.js + TypeScript</strong> —
          serves the desktop app, the local API on 127.0.0.1, and the one-shot CLI. No Python and no
          Rust are required, installed, or invoked at runtime.
        </p>
        <p>
          CodeRadar&apos;s authority is the code, not the model. A model proposes a candidate; the
          system decides whether it is a finding. The evidence gate is load-bearing and enforced by
          the engine, not by convention: a finding must quote code that is actually in the file it
          names, at a line that is actually in range.
        </p>
        <p>
          A failed model call is not a failed review — an unavailable provider degrades the run to
          the deterministic checks and says so on the progress stream. AI is opt-in; the detectors
          always run.
        </p>
      </div>

      <div className="mt-12 rounded-2xl border bg-fd-card p-6 shadow-sm md:p-10">
        <h2 className="text-xl font-semibold tracking-tight mb-6">What CodeRadar covers</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            ['File & folder reviews', 'Fast or deep, safe / balanced / aggressive presets.'],
            ['Evidence-gated findings', 'Quoted source, severity, confidence, fix.'],
            ['Dropped candidates', 'Rejected claims listed with reasons, never hidden.'],
            ['Honest states', 'Complete, partial, degraded, failed — never fake-clean.'],
            ['CLI & local API', 'One-shot reviews, changed-only gates, JSON output.'],
            ['Scoring & replay', 'Planted-defect fixtures, offline answer replay.'],
          ].map(([term, detail]) => (
            <div key={term} className="py-3">
              <dt className="font-medium">{term}</dt>
              <dd className="mt-1 text-sm text-fd-muted-foreground leading-6">{detail}</dd>
            </div>
          ))}
        </dl>
        <a
          href={repoUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-6 inline-flex rounded-full bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
        >
          View the repository
        </a>
      </div>
    </main>
  );
}
