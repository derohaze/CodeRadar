import { HugeiconsIcon } from '@hugeicons/react';
import { Plug01Icon, SecurityCheckIcon } from '@hugeicons/core-free-icons';
import { createMetadata } from '@/lib/metadata';
import { repoUrl } from '@/lib/site';

export const metadata = createMetadata({
  title: 'Providers',
  description:
    'CodeRadar connects to any OpenAI-compatible provider — plus deterministic offline detectors, so reviews run with or without AI.',
  path: '/sponsors',
});

const providerCards = [
  {
    name: 'Any OpenAI-compatible provider',
    status: 'Bring your key',
    description:
      'Set an endpoint, key, and model. The key is tested with a live call before it is saved, listed back masked once active, and encrypted with the OS keychain.',
  },
  {
    name: 'Deterministic detectors',
    status: 'Always on',
    description:
      'Built-in checks run offline with no key and no network. An unavailable provider degrades the run to these checks and says so on the progress stream.',
  },
  {
    name: 'Offline replay',
    status: 'Local only',
    description:
      'Record model answers once, replay them without a provider or a key. Recordings stay in .coderadar/, gitignored, owner-only permissions.',
  },
  {
    name: 'Local API on 127.0.0.1',
    status: 'Token-guarded',
    description:
      'Loopback-only, per-launch token, Origin and Host validation. The desktop app and the CLI use the same engine through the same contract.',
  },
];

export default function Page() {
  return (
    <main className="relative z-2 mx-auto w-full max-w-page px-4 pb-12 md:py-12">
      <section className="relative dark mb-6 min-h-[320px] overflow-hidden rounded-[2rem] border border-white/10 bg-[#070707] p-6 shadow-2xl md:p-12">
        <div className="absolute inset-0 -z-1 bg-[linear-gradient(135deg,rgba(255,243,131,.24),transparent_32%),radial-gradient(circle_at_84%_18%,rgba(252,119,68,.32),transparent_30%),linear-gradient(180deg,rgba(255,255,255,.08),transparent)]" />
        <div className="flex max-w-3xl flex-col justify-end">
          <h1 className="text-4xl font-semibold tracking-normal text-white md:text-6xl">
            Providers that plug into the same fixed pipeline
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-white/68 md:text-lg">
            Only the provider is interchangeable — prompt policy, context builder, parser, evidence
            gate, validator, dedupe, and scorer stay fixed, so every model is judged by the same bar.
          </p>
          <div className="mt-8">
            <a
              href={repoUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex rounded-full bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition-colors hover:bg-neutral-200"
            >
              Star on GitHub
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-5 md:grid-cols-2">
        {providerCards.map((card) => (
          <article
            key={card.name}
            className="group flex min-h-52 flex-col justify-between rounded-2xl border bg-fd-card p-5 shadow-sm transition-colors hover:bg-fd-accent/40"
          >
            <div className="flex items-start justify-between gap-4">
              <HugeiconsIcon icon={Plug01Icon} size={28} strokeWidth={1.8} className="text-fd-foreground" />
              <span className="rounded-full bg-fd-background/80 px-3 py-1 text-xs font-medium text-fd-muted-foreground">
                {card.status}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={SecurityCheckIcon} size={16} strokeWidth={2} className="text-fd-muted-foreground" />
                <h3 className="text-xl font-semibold">{card.name}</h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">{card.description}</p>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
