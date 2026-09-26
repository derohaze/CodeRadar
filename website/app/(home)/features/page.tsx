import { createMetadata } from '@/lib/metadata';
import { StructuredData } from '@/components/structured-data';
import { siteConfig } from '@/lib/site';
import { cn } from '@/lib/cn';
import { cva } from 'class-variance-authority';

export const metadata = createMetadata({
  title: 'Features',
  description:
    'CodeRadar features: evidence-gated findings, deterministic detectors, opt-in AI review, dropped-candidate transparency, honest review states, CLI and local API, scoring and replay — in one open-source desktop app.',
  path: '/features',
});

const features = [
  {
    name: 'Evidence-gated findings',
    description:
      'Every finding quotes the exact code it came from, at a line that exists and shows the defect — plus severity, confidence, consequence if it ships, and a concrete fix. No quote, no finding.',
  },
  {
    name: 'Deterministic detectors, offline',
    description:
      'The review always runs its built-in checks with zero network and zero key. AI is an additive layer, never a requirement — an unavailable provider degrades the run instead of failing it.',
  },
  {
    name: 'Opt-in AI review, any provider',
    description:
      'Bring any OpenAI-compatible endpoint, key, and model. The key is live-tested before it is saved and encrypted with the OS keychain. The same prompt policy, parser, and validator serve every model.',
  },
  {
    name: 'Dropped candidates stay visible',
    description:
      'Claims the bar refuses — evidence mismatch, low confidence, policy rejection — are listed with their reason instead of vanishing. A review that reports nothing never looks like a review that found nothing.',
  },
  {
    name: 'Honest review states',
    description:
      'Complete, partial, degraded, failed: every report states what ran and what did not. Coverage, truncation, and provider outages are limitations with their own panel — never mixed into findings.',
  },
  {
    name: 'Live progress with six orb states',
    description:
      'Discovery, mapping, segmentation, path tracing, review, validation, scoring — each phase shows its own Thinking Orbs animation, so the indicator reflects the real work instead of a generic spinner.',
  },
  {
    name: 'File or folder, app or CLI',
    description:
      'Review one file or a whole repository from the Electron desktop app, the local API on 127.0.0.1, or a one-shot CLI command with --changed-only, --fail-on, and --json. Same engine everywhere.',
  },
  {
    name: 'Ground-truth scoring and replay',
    description:
      'Nine planted defects and ten negative controls pin accuracy; the scorer credits only file-plus-anchor overlaps. Record model answers once, replay them offline, benchmark every model on the same pipeline.',
  },
  {
    name: 'Agent-ready fix prompts',
    description:
      'Every run emits a copy-paste prompt for Codex, Claude, or Cursor: file:line locations, recommended fixes, minimal-change rules, and the typecheck-plus-tests gate — per finding, per run.',
  },
  {
    name: 'Locked-down by design',
    description:
      'Loopback-only API, per-launch token, Origin and Host validation, https-only provider URLs, encrypted keys, replay recordings kept local and gitignored. Security is enforced by the engine, not by convention.',
  },
] as const;

const faqItems = [
  {
    question: 'Do I need an AI provider to use CodeRadar?',
    answer:
      'No. Without an endpoint, key, and model the review runs the deterministic detectors only and says so on the progress stream. AI adds depth; it never gates the review.',
  },
  {
    question: 'How does CodeRadar avoid false positives?',
    answer:
      'Two layers: the evidence gate rejects any claim that cannot quote real source at a real line, and the confidence bar with dedupe drops the rest — listing each rejection with its reason so you can audit the bar itself.',
  },
  {
    question: 'Can I run CodeRadar in CI?',
    answer:
      'Yes. The CLI reviews any path with --changed-only against a base branch, --fail-on severities for gating, and --json for machine-readable output. The engine has no runtime dependencies beyond Node.',
  },
  {
    question: 'Is my code sent anywhere?',
    answer:
      'Only to a provider you explicitly configure, and only the files in scope. By default everything stays on disk: the app, the API, the replay store, and the settings all live on your machine.',
  },
] as const;

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebPage',
      '@id': `${siteConfig.url}/features#webpage`,
      url: `${siteConfig.url}/features`,
      name: 'CodeRadar Features',
      description:
        'Evidence-gated findings, deterministic detectors, opt-in AI review, dropped-candidate transparency, honest review states, CLI and local API, scoring and replay.',
      isPartOf: { '@id': `${siteConfig.url}/#website` },
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteConfig.url },
          { '@type': 'ListItem', position: 2, name: 'Features', item: `${siteConfig.url}/features` },
        ],
      },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteConfig.url}/#software`,
      name: siteConfig.name,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Windows, macOS, Linux',
      url: siteConfig.url,
      featureList: features.map((f) => f.name),
    },
    {
      '@type': 'FAQPage',
      '@id': `${siteConfig.url}/features#faq`,
      mainEntity: faqItems.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    },
  ],
};

const cardVariants = cva('rounded-2xl border bg-fd-card p-6 shadow-sm');

export default function FeaturesPage() {
  return (
    <main className="mx-auto w-full max-w-page px-4 pb-12 pt-8 md:py-12">
      <StructuredData value={structuredData} />
      <div className="mb-12 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight mb-4">
          Everything a serious code review needs. Nothing it can&apos;t prove.
        </h1>
        <p className="text-lg text-fd-muted-foreground leading-8">
          CodeRadar brings evidence-gated findings, offline detectors, opt-in AI depth, honest review
          states, and agent-ready fixes into one open-source, local-first desktop app.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-16">
        {features.map((feature) => (
          <div key={feature.name} className={cn(cardVariants())}>
            <h2 className="font-semibold mb-2">{feature.name}</h2>
            <p className="text-sm text-fd-muted-foreground leading-7">{feature.description}</p>
          </div>
        ))}
      </div>

      <section
        id="faq"
        aria-labelledby="features-faq-heading"
        className="rounded-2xl border bg-fd-card p-6 shadow-sm md:p-10"
      >
        <h2 id="features-faq-heading" className="text-2xl font-semibold tracking-tight mb-8">
          Common questions about CodeRadar features.
        </h2>
        <dl className="divide-y">
          {faqItems.map((faq) => (
            <div key={faq.question} className="py-5 first:pt-0 last:pb-0">
              <dt className="font-medium">{faq.question}</dt>
              <dd className="mt-2 leading-7 text-fd-muted-foreground">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
