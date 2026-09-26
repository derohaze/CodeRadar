import Image from 'next/image';
import { cn } from '@/lib/cn';
import { cva } from 'class-variance-authority';
import { AppDemo } from '@/app/(home)/app-demo';
import { ThinkingOrb, type ThinkingOrbState } from '@/components/thinking-orb';
import { siteConfig, repoUrl } from '@/lib/site';
import { createMetadata } from '@/lib/metadata';
import { StructuredData } from '@/components/structured-data';

export const metadata = createMetadata({
  title: 'Local-first code review that proves every finding',
  description: siteConfig.description,
  path: '/',
});

const homepageFaqItems = [
  {
    question: 'What is CodeRadar?',
    answer:
      'CodeRadar is an open-source, local-first code review desktop app. You point it at a file or a folder, it reads the code, and it reports the defects it can prove — each with the quoted evidence it came from, the consequence if it ships, and a concrete fix.',
  },
  {
    question: 'Does my code leave my machine?',
    answer:
      'By default, no. Everything runs locally on Electron + Node.js + TypeScript. AI review is opt-in: without an endpoint, key, and model, the review runs the deterministic detectors only. When you do connect a provider, the key is tested with a live call before it is saved and stored encrypted in the OS keychain.',
  },
  {
    question: 'What makes a CodeRadar finding trustworthy?',
    answer:
      'The evidence gate. A finding must quote code that is actually in the file it names, at a line that is actually in range. Claims the system cannot prove are rejected and listed as dropped candidates with the reason — never silently deleted, never relaxed to make a report look stronger.',
  },
  {
    question: 'Is CodeRadar really open source?',
    answer:
      'Yes. The engine, the desktop app, and this site live in one public repository under an open-source license. Star it, fork it, run the 261 engine tests and 74 frontend tests yourself — the review contract is pinned by fixtures with planted defects, not by marketing.',
  },
] as const;

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${siteConfig.url}/#organization`,
      name: siteConfig.name,
      url: siteConfig.url,
      logo: `${siteConfig.url}/whitelogo.svg`,
    },
    {
      '@type': 'WebSite',
      '@id': `${siteConfig.url}/#website`,
      name: siteConfig.name,
      url: siteConfig.url,
      publisher: { '@id': `${siteConfig.url}/#organization` },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteConfig.url}/#software`,
      name: siteConfig.name,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Windows, macOS, Linux',
      url: siteConfig.url,
      description: siteConfig.description,
      publisher: { '@id': `${siteConfig.url}/#organization` },
      featureList: [
        'Local-first file and folder reviews',
        'Evidence-gated findings with quoted source',
        'Deterministic detectors that run offline',
        'Opt-in OpenAI-compatible AI review',
        'Dropped-candidate transparency',
        'Review states: complete, partial, degraded, failed',
        'CLI one-shot reviews and local API',
        'Ground-truth scoring and replay harness',
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': `${siteConfig.url}/#faq`,
      mainEntity: homepageFaqItems.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    },
  ],
};

const headingVariants = cva('font-medium tracking-tight', {
  variants: {
    variant: {
      h2: 'text-3xl lg:text-4xl',
      h3: 'text-xl lg:text-2xl',
    },
  },
});

const buttonVariants = cva(
  'inline-flex justify-center px-5 py-3 rounded-full font-medium tracking-tight transition-colors',
  {
    variants: {
      variant: {
        primary: 'bg-[#fff383] text-black hover:bg-[#fff7c8]',
        secondary: 'border bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-accent',
        dark: 'bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
);

const cardVariants = cva('rounded-2xl text-sm p-6 bg-origin-border shadow-lg', {
  variants: {
    variant: {
      secondary: 'bg-brand-secondary text-brand-secondary-foreground',
      default: 'border bg-fd-card',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

const orbGallery: { state: ThinkingOrbState; phase: string; detail: string }[] = [
  { state: 'working', phase: 'Discovery', detail: 'Indexing files, languages, manifests' },
  { state: 'searching', phase: 'Repository mapping', detail: 'Tracing imports and export surfaces' },
  { state: 'shaping', phase: 'Segmentation', detail: 'Narrowing to review blocks' },
  { state: 'composing', phase: 'Path tracing', detail: 'Building source-to-sink paths' },
  { state: 'solving', phase: 'Reviewing + Validation', detail: 'Checking claims against source' },
  { state: 'listening', phase: 'Scoring', detail: 'Finalizing coverage and score' },
];

export default function Page() {
  return (
    <main className="overflow-x-hidden text-landing-foreground pt-4 pb-6 dark:text-landing-foreground-dark md:pb-12">
      <StructuredData value={structuredData} />
      <div className="relative mx-auto flex w-full max-w-[1400px] min-w-0 flex-col items-center overflow-hidden rounded-2xl border bg-origin-border">
        <Image
          src="/cover.svg"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="100vw"
          className="pointer-events-none absolute inset-0 object-cover"
        />
        <div className="z-2 flex w-full max-w-full min-w-0 flex-col items-center px-3 py-4 text-center sm:px-8 sm:py-5 md:px-10 md:py-6 lg:py-5">
          <h1 className="sr-only">
            CodeRadar — open-source local-first code review that proves every finding
          </h1>
          <div className="w-full max-w-full min-w-0 text-start">
            <AppDemo />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-10 mt-12 px-6 mx-auto w-full max-w-[1400px] md:px-12 lg:grid-cols-2 lg:mt-20">
        <p className="text-2xl tracking-tight leading-snug font-light col-span-full md:text-3xl xl:text-4xl">
          CodeRadar is a <span className="text-brand font-medium">local-first, open-source</span> code
          review app for <span className="text-brand font-medium">files, folders, diffs, and CI
          gates</span>. The model proposes candidates — the system decides what becomes a finding, and
          only <span className="text-brand font-medium">evidence that quotes your source</span> survives.
        </p>
        <HowItRuns />
        <OrbGallery />
        <ReviewContract />
        <OpenSource />
        <HomepageFaq />
      </div>
    </main>
  );
}

function HomepageFaq() {
  return (
    <section
      id="faq"
      aria-labelledby="homepage-faq-heading"
      className="col-span-full grid gap-8 rounded-2xl border bg-fd-card p-6 shadow-sm md:p-10 lg:grid-cols-[0.8fr_1.2fr]"
    >
      <div>
        <h2 id="homepage-faq-heading" className={cn(headingVariants({ variant: 'h2' }))}>
          CodeRadar, answered clearly.
        </h2>
        <p className="mt-4 max-w-md text-fd-muted-foreground">
          Direct answers about the app, your code&apos;s privacy, and what makes a finding trustworthy.
        </p>
      </div>
      <dl className="divide-y">
        {homepageFaqItems.map((faq) => (
          <div key={faq.question} className="py-5 first:pt-0 last:pb-0">
            <dt className="font-medium">{faq.question}</dt>
            <dd className="mt-2 leading-7 text-fd-muted-foreground">{faq.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function HowItRuns() {
  const steps = [
    {
      title: '1. Pick a source, choose a preset',
      body: 'A file or a folder, fast or deep review, safe / balanced / aggressive presets. The engine discovers the repository — languages, manifests, hotspots — before any model is involved.',
    },
    {
      title: '2. Watch the review run live',
      body: 'Progress streams as the engine walks the repository: discovery, mapping, segmentation, path tracing, review, validation, scoring. A failed model call degrades to deterministic checks — never to a failed review.',
    },
    {
      title: '3. Read findings with proof',
      body: 'Every finding carries severity, confidence, quoted evidence at a real line, the consequence of shipping it, and a concrete fix. Dropped candidates stay listed with their rejection reason.',
    },
    {
      title: '4. Copy the fix prompt to your agent',
      body: 'One Greptile-style prompt per run: file:line locations plus recommended fixes, ready to paste into Codex, Claude, or Cursor. Minimal, behavior-preserving changes only.',
    },
  ];
  return (
    <>
      <h2 className={cn(headingVariants({ variant: 'h2', className: 'text-brand text-center mb-4 col-span-full' }))}>
        From source to proven finding in four steps.
      </h2>
      {steps.map((step) => (
        <div key={step.title} className={cn(cardVariants())}>
          <h3 className={cn(headingVariants({ variant: 'h3', className: 'mb-4' }))}>{step.title}</h3>
          <p className="leading-7 text-fd-muted-foreground">{step.body}</p>
        </div>
      ))}
    </>
  );
}

function OrbGallery() {
  return (
    <div className={cn(cardVariants(), 'col-span-full')}>
      <h3 className={cn(headingVariants({ variant: 'h3', className: 'mb-2' }))}>
        One orb per kind of work — never a generic spinner.
      </h3>
      <p className="mb-6 max-w-3xl leading-7 text-fd-muted-foreground">
        While a review runs, the indicator shows the actual activity in flight. Each of the six Thinking
        Orbs states maps to a review phase — the same mapping the desktop app uses, rendered here live
        with the same dependency-free canvas renderer.
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {orbGallery.map((item) => (
          <div key={item.state} className="flex flex-col items-center rounded-2xl border bg-fd-secondary/40 p-4 text-center">
            <ThinkingOrb state={item.state} size={64} label={`${item.phase} — ${item.state}`} />
            <p className="mt-3 font-mono text-xs font-semibold">{item.state}</p>
            <p className="mt-1 text-xs font-medium">{item.phase}</p>
            <p className="mt-1 text-[11px] leading-5 text-fd-muted-foreground">{item.detail}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-6 text-fd-muted-foreground">
        Vanilla Canvas 2D, no animation packages — MIT-licensed Thinking Orbs by Jakub Antalik, adapted
        with the full license notice kept in the bundle.
      </p>
    </div>
  );
}

function ReviewContract() {
  const cards = [
    {
      title: 'Evidence gate — no proof, no finding',
      body: 'A finding must quote code that really appears in the file it names, at a line that really exists and really shows the defect. Detectors, the model, and future adapters all pass the same gate with no bypass.',
    },
    {
      title: 'Honest review states',
      body: 'Every report carries its own state: complete means clean is clean; partial means the scope narrowed; degraded means a stage did not run; failed means no result exists. An incomplete review is never presented as a clean one.',
    },
    {
      title: 'Scored against planted defects',
      body: 'Eleven files hold nine planted defects and ten look-wrong-but-correct controls. A finding scores only when it names the right file and its range overlaps the defect anchor — file-right-line-wrong is a miss.',
    },
    {
      title: 'Locked-down local API',
      body: 'The only socket in the system binds to 127.0.0.1, requires a per-launch token, checks Origin against the app, refuses DNS rebinding via Host validation, and only allows https provider URLs — unless loopback.',
    },
  ];
  return (
    <>
      <h2 className={cn(headingVariants({ variant: 'h2', className: 'text-brand text-center mb-4 col-span-full' }))}>
        The review contract: authority is the code, not the model.
      </h2>
      {cards.map((card) => (
        <div key={card.title} className={cn(cardVariants())}>
          <h3 className={cn(headingVariants({ variant: 'h3', className: 'mb-4' }))}>{card.title}</h3>
          <p className="leading-7 text-fd-muted-foreground">{card.body}</p>
        </div>
      ))}
    </>
  );
}

function OpenSource() {
  return (
    <div className={cn(cardVariants(), 'col-span-full grid gap-6 lg:grid-cols-[1.2fr_0.8fr]')}>
      <div>
        <h3 className={cn(headingVariants({ variant: 'h3', className: 'mb-4' }))}>
          Open source, local-first, one runtime.
        </h3>
        <p className="leading-7 text-fd-muted-foreground">
          One runtime — <span className="text-brand">Electron + Node.js + TypeScript</span>. No Python,
          no Rust at runtime. The same engine serves the desktop app, the local API on 127.0.0.1, and
          the one-shot CLI. Record a run once, replay it offline; benchmark every model through the same
          fixed pipeline.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={repoUrl} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants({ variant: 'dark', className: 'py-2 text-sm' }))}>
            View repository
          </a>
          <a href="/docs" className={cn(buttonVariants({ variant: 'secondary', className: 'py-2 text-sm' }))}>
            Read the docs
          </a>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fd-muted-foreground">Run it yourself</p>
        <pre className="overflow-x-auto rounded-xl bg-neutral-950 p-4 font-mono text-xs leading-6 text-neutral-100 dark:bg-black">
{`# desktop app
cd frontend && bun install
bun run dev:all

# engine only — local API
cd engine && bun run serve

# one-shot CLI review
bun run review ../frontend/src --json`}
        </pre>
      </div>
    </div>
  );
}
