'use client';

import { ArrowLeft, FileStack, GitBranch, Layers3, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DEMO_REPO_OVERVIEW, type DemoSession } from '../data';
import { KeyValueRow, SectionLabel } from '../parts';
import { card, faint, mono, muted, tile } from '../tokens';

function OverviewCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className={cn(card, 'rounded-2xl px-3.5 py-3.5')}>
      <div className="flex items-center gap-2">
        <Icon className={cn('size-3.5', faint)} />
        <SectionLabel className="truncate">{label}</SectionLabel>
      </div>
      <p className="mt-2 truncate text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">{value}</p>
      <p className={cn('mt-1.5 line-clamp-2 text-[11px] leading-5', muted)}>{note}</p>
    </div>
  );
}

function OverviewTable({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  return (
    <section className={cn(card, 'rounded-2xl px-4 py-3.5')}>
      <p className="text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">{title}</p>
      {rows.length === 0 ? (
        <p className={cn('mt-2.5 text-[11.5px] leading-5', muted)}>
          No captured data for this section in the current run
        </p>
      ) : (
        <div className="mt-2.5 space-y-1.5">
          {rows.map((row) => (
            <KeyValueRow key={row.label} name={row.label} value={row.value} />
          ))}
        </div>
      )}
    </section>
  );
}

export function RepoOverviewScreen({ session, onBack }: { session: DemoSession; onBack: () => void }) {
  const overview = DEMO_REPO_OVERVIEW;
  const hotspots = overview.hotspots;

  return (
    <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <div className="mx-auto max-w-[720px] space-y-3">
        <button
          type="button"
          onClick={onBack}
          className={cn('inline-flex items-center gap-1.5 text-[11.5px]', muted, 'hover:text-[hsl(var(--cr-text-primary))]')}
        >
          <ArrowLeft className="size-3.5" />
          Back to results
        </button>

        <section className={cn(card, 'rounded-2xl px-4 py-4')}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <SectionLabel>Repo overview</SectionLabel>
              <h2 className="mt-2 text-[19px] font-semibold tracking-[-0.03em] text-[hsl(var(--cr-text-primary))]">
                {session.name}
              </h2>
              <p className={cn('mt-2 text-[11.5px] leading-5', muted)}>
                This surface summarizes repository structure, framework signals, graph hints, and security
                segmentation for the active run.
              </p>
            </div>
            <span className={cn(labelPill, 'shrink-0')}>folder target</span>
          </div>
        </section>

        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewCard
            icon={FileStack}
            label="Repository files"
            value={`${overview.files} items`}
            note={`${session.filesReviewed}/${session.filesEligible} files reviewed`}
          />
          <OverviewCard
            icon={ShieldCheck}
            label="Security score"
            value={session.score !== null ? `${session.score}/100` : 'Unavailable'}
            note={`${session.coveragePercent}% reviewed coverage`}
          />
          <OverviewCard
            icon={Layers3}
            label="High-risk files"
            value={`${overview.highRisk} items`}
            note="2 skipped file(s) in current scope"
          />
          <OverviewCard
            icon={GitBranch}
            label="Traced paths"
            value={`${session.pathsTraced}/${session.pathsTotal}`}
            note={`Elapsed ${session.time}`}
          />
        </section>

        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewCard
            icon={Layers3}
            label="Repo hotspots"
            value={`${hotspots.length} hotspots`}
            note={hotspots[0]?.label ?? 'No hotspot remains active'}
          />
          <OverviewCard
            icon={ShieldCheck}
            label="Critical zones"
            value={`${hotspots.filter((item) => item.priority === 'critical').length} hotspots`}
            note="2 identity / 1 exposure"
          />
          <OverviewCard
            icon={GitBranch}
            label="Data pressure"
            value="1 hotspot"
            note="Input and sink pressure derived from the security registry"
          />
          <OverviewCard
            icon={FileStack}
            label="Coverage pressure"
            value={session.coveragePercent === 100 ? '0 hotspots' : '1 hotspot'}
            note="Coverage gaps still affect repository-wide trust"
          />
        </section>

        <section className="grid gap-3 xl:grid-cols-2">
          <OverviewTable
            title="Framework profile"
            rows={[
              { label: 'Primary framework', value: overview.primaryFramework },
              { label: 'Languages', value: overview.languages },
              { label: 'Runtimes', value: overview.runtimes },
              { label: 'Package managers', value: overview.packageManagers },
            ]}
          />
          <OverviewTable
            title="Repository graph"
            rows={[
              { label: 'Entrypoints', value: '9 exported modules' },
              { label: 'Services', value: '0' },
              { label: 'Trust boundaries', value: '1' },
              { label: 'External surfaces', value: `${overview.importEdges} import edges` },
            ]}
          />
        </section>

        <section className="grid gap-3 xl:grid-cols-2">
          <OverviewTable
            title="Security segmentation"
            rows={[
              { label: 'Critical zones', value: '2 files' },
              { label: 'Sensitive files', value: '1 file' },
              { label: 'Identity surfaces', value: '1 file' },
              { label: 'Config surfaces', value: '1 file' },
            ]}
          />
          <OverviewTable
            title="Security registry"
            rows={[
              { label: 'Auth components', value: '1' },
              { label: 'Data sinks', value: '2' },
              { label: 'User inputs', value: '4' },
              { label: 'Network boundaries', value: '1' },
            ]}
          />
        </section>

        <section className={cn(card, 'rounded-2xl px-4 py-3.5')}>
          <p className="text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">Repository hotspots</p>
          <div className="mt-3 space-y-2.5">
            {hotspots.map((hotspot) => (
              <div key={hotspot.id} className={cn(tile, 'rounded-2xl px-3.5 py-3.5')}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={cn(mono, 'text-[hsl(var(--cr-text-primary))]')}>{hotspot.label}</p>
                    <p className={cn('mt-1 text-[10.5px]', faint)}>
                      {hotspot.priority} - {hotspot.hotspotClass}
                    </p>
                  </div>
                </div>
                <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                  <div>
                    <SectionLabel>Evidence</SectionLabel>
                    <p className={cn('mt-1.5 text-[11px] leading-5', muted)}>{hotspot.evidence}</p>
                  </div>
                  <div>
                    <SectionLabel>Next investigation</SectionLabel>
                    <p className={cn('mt-1.5 text-[11px] leading-5', muted)}>{hotspot.nextInvestigation}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

const labelPill =
  'rounded-full bg-[hsl(var(--cr-tile))] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--cr-text-secondary))]';
