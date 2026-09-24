import { motion } from "framer-motion";
import { FileStack, GitBranch, Layers3, ShieldCheck } from "lucide-react";
import { buildRepoHotspots, summarizeRepoHotspots } from "@/features/repo-overview/lib/repo-intelligence";
import { buildRepoIntelligenceLedger, summarizeRepoIntelligenceLedger } from "@/features/repo-overview/lib/repo-intelligence-ledger";
import type { ScanSessionDetail, WorkflowRepoHotspotItem, WorkflowRepoIntelligenceSummary } from "@/shared/api/security";

interface Props {
  session: ScanSessionDetail | null;
  repoSummary?: WorkflowRepoIntelligenceSummary | null;
  repoHotspotFeed?: WorkflowRepoHotspotItem[] | null;
}

export function RepoOverviewScreen({
  session,
  repoSummary = null,
  repoHotspotFeed = null,
}: Props) {
  if (!session) return null;

  const inventory = session.session.repositoryInventory;
  const framework = session.session.frameworkProfile;
  const graph = session.session.graphSummary;
  const segmentation = session.session.segmentationSummary;
  const registry = session.session.securityRegistry;
  const hotspots = buildRepoHotspots(session);
  const dedupedRepoHotspotFeed = dedupeRepoHotspotFeed(repoHotspotFeed);
  const localHotspotSummary = summarizeRepoHotspots(hotspots);
  const hotspotSummary = repoSummary
    ? {
        hotspotCount: repoSummary.hotspotCount,
        criticalHotspots: repoSummary.criticalHotspots,
        identityZones: repoSummary.identityZones,
        exposureZones: repoSummary.exposureZones,
        dataZones: repoSummary.dataZones,
        coverageZones: repoSummary.coverageZones,
        topHotspotLabel: repoSummary.topHotspotLabel,
      }
    : localHotspotSummary;
  const ledgerItems = buildRepoIntelligenceLedger(session);
  const ledgerSummary = summarizeRepoIntelligenceLedger(ledgerItems);

  return (
    <motion.div
      initial={{ opacity: 1, y: 0 }}
      className="hide-scrollbar flex-1 overflow-y-auto dotted-bg px-8 py-8"
    >
      <div className="mx-auto max-w-5xl space-y-4">
        <section
          className="rounded-2xl border bg-card px-5 py-5 shadow-card"
          style={{ borderColor: "hsl(var(--border-soft))" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-txt-tertiary">Repo overview</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-txt-primary">{session.session.repo}</h2>
              <p className="mt-2 text-sm leading-6 text-txt-secondary">
                {session.session.repositorySummary || "This surface summarizes repository structure, framework signals, graph hints, and security segmentation for the active security run"}
              </p>
            </div>
            <span className="shrink-0 whitespace-nowrap rounded-full bg-[#eeeeee] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-txt-secondary">
              {session.session.targetType} target
            </span>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OverviewCard
            icon={FileStack}
            label="Repository files"
            value={formatCount(getNumericValue(inventory, ["file_count", "files", "total_files"], session.session.reviewedFilesCount))}
            note={`${session.session.reviewedFilesCount}/${session.session.eligibleFilesCount || session.session.reviewedFilesCount} files reviewed`}
          />
          <OverviewCard
            icon={ShieldCheck}
            label="Security score"
            value={session.session.securityScore !== null ? `${session.session.securityScore}/100` : "Unavailable"}
            note={session.session.coverageSummary || `${session.session.coveragePercent}% reviewed coverage`}
          />
          <OverviewCard
            icon={Layers3}
            label="High-risk files"
            value={formatCount(session.session.highRiskFilesCount)}
            note={`${session.session.skippedFilesCount} skipped file(s) in current scope`}
          />
          <OverviewCard
            icon={GitBranch}
            label="Traced paths"
            value={`${session.session.tracedPathsCount}/${session.session.totalPathsCount || session.session.tracedPathsCount}`}
            note={`Elapsed ${formatElapsedSeconds(session.session.elapsedSeconds)}`}
          />
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OverviewCard
            icon={Layers3}
            label="Repo hotspots"
            value={`${hotspotSummary.hotspotCount} hotspot(s)`}
            note={hotspotSummary.topHotspotLabel}
          />
          <OverviewCard
            icon={ShieldCheck}
            label="Critical zones"
            value={`${hotspotSummary.criticalHotspots} hotspot(s)`}
            note={`${hotspotSummary.identityZones} identity / ${hotspotSummary.exposureZones} exposure`}
          />
          <OverviewCard
            icon={GitBranch}
            label="Data pressure"
            value={`${hotspotSummary.dataZones} hotspot(s)`}
            note="Input and sink pressure derived from the security registry"
          />
          <OverviewCard
            icon={FileStack}
            label="Coverage pressure"
            value={`${hotspotSummary.coverageZones} hotspot(s)`}
            note="Coverage gaps still affect repository-wide trust"
          />
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OverviewCard
            icon={Layers3}
            label="Repo intelligence ledger"
            value={`${ledgerSummary.itemCount} item(s)`}
            note={ledgerSummary.topItemLabel}
          />
          <OverviewCard
            icon={ShieldCheck}
            label="Critical ledger items"
            value={`${ledgerSummary.criticalItems} item(s)`}
            note={`${ledgerSummary.coverageItems} coverage and ${ledgerSummary.registryItems} registry item(s) active.`}
          />
          <OverviewCard
            icon={GitBranch}
            label="Graph + segmentation"
            value={`${ledgerSummary.graphItems + ledgerSummary.segmentationItems} item(s)`}
            note="Service graph and segmentation signals remain active"
          />
          <OverviewCard
            icon={FileStack}
            label="Framework footprint"
            value={`${ledgerSummary.frameworkItems} item(s)`}
            note="Framework signal inventory used to scope future remediation"
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <OverviewTable
            title="Framework profile"
            rows={buildRows(framework, [
              ["primary_framework", "Primary framework"],
              ["languages", "Languages"],
              ["runtimes", "Runtimes"],
              ["package_managers", "Package managers"],
            ])}
          />
          <OverviewTable
            title="Repository graph"
            rows={buildRows(graph, [
              ["entrypoints", "Entrypoints"],
              ["services", "Services"],
              ["trust_boundaries", "Trust boundaries"],
              ["external_surfaces", "External surfaces"],
            ])}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <OverviewTable
            title="Security segmentation"
            rows={buildRows(segmentation, [
              ["critical_zones", "Critical zones"],
              ["sensitive_files", "Sensitive files"],
              ["identity_surfaces", "Identity surfaces"],
              ["config_surfaces", "Config surfaces"],
            ])}
          />
          <OverviewTable
            title="Security registry"
            rows={buildRows(registry, [
              ["auth_components", "Auth components"],
              ["data_sinks", "Data sinks"],
              ["user_inputs", "User inputs"],
              ["network_boundaries", "Network boundaries"],
            ])}
          />
        </section>

        <section
          className="rounded-2xl border bg-card px-5 py-4 shadow-card"
          style={{ borderColor: "hsl(var(--border-soft))" }}
        >
          <p className="text-sm font-semibold text-txt-primary">Cross-session repo hotspot feed</p>
          <div className="mt-3 space-y-3">
            {dedupedRepoHotspotFeed?.map((item) => (
              <div
                key={`${item.sessionId}-${item.hotspotClass}-${item.label}`}
                className="rounded-2xl border bg-[#f7f7f7] px-4 py-4"
                style={{ borderColor: "hsl(var(--border-soft))" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-txt-primary">{item.repo}</p>
                    <p className="mt-1 text-xs text-txt-tertiary">
                      {item.priority} - {item.hotspotClass}
                    </p>
                  </div>
                  <span className="rounded-full bg-card px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-txt-secondary">
                    {item.label}
                  </span>
                </div>
              </div>
            ))}
            {dedupedRepoHotspotFeed?.length === 0 && (
              <p className="text-sm leading-6 text-txt-secondary">
                No cross-session repository hotspot remains active in the current workspace window
              </p>
            )}
            {dedupedRepoHotspotFeed === null && (
              <p className="text-sm leading-6 text-txt-secondary">
                Workspace hotspot feed is not available. Current-run repository hotspots remain visible below
              </p>
            )}
          </div>
        </section>

        <section
          className="rounded-2xl border bg-card px-5 py-4 shadow-card"
          style={{ borderColor: "hsl(var(--border-soft))" }}
        >
          <p className="text-sm font-semibold text-txt-primary">Repository hotspots</p>
          <div className="mt-3 space-y-3">
            {hotspots.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border bg-[#f7f7f7] px-4 py-4"
                style={{ borderColor: "hsl(var(--border-soft))" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-txt-primary">{item.label}</p>
                    <p className="mt-1 text-xs text-txt-tertiary">
                      {item.priority} - {item.hotspotClass}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <OverviewRow label="Evidence" value={item.evidence} />
                  <OverviewRow label="Next investigation" value={item.nextInvestigation} />
                </div>
              </div>
            ))}
            {hotspots.length === 0 && (
              <p className="text-sm leading-6 text-txt-secondary">
                No repository hotspot remains active for the current run
              </p>
            )}
          </div>
        </section>

        <section
          className="rounded-2xl border bg-card px-5 py-4 shadow-card"
          style={{ borderColor: "hsl(var(--border-soft))" }}
        >
          <p className="text-sm font-semibold text-txt-primary">Repo intelligence ledger</p>
          <div className="mt-3 space-y-3">
            {ledgerItems.map((item) => (
              <div
                key={`${item.ledgerClass}-${item.label}`}
                className="rounded-2xl border bg-[#f7f7f7] px-4 py-4"
                style={{ borderColor: "hsl(var(--border-soft))" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-txt-primary">{item.label}</p>
                    <p className="mt-1 text-xs text-txt-tertiary">
                      {item.priority} - {item.ledgerClass}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <OverviewRow label="Evidence" value={item.evidence} />
                  <OverviewRow label="Next action" value={item.nextAction} />
                </div>
              </div>
            ))}
            {ledgerItems.length === 0 && (
              <p className="text-sm leading-6 text-txt-secondary">
                No repo intelligence ledger entries are active for the current run
              </p>
            )}
          </div>
        </section>

      </div>
    </motion.div>
  );
}

function OverviewCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: React.ComponentType<{ size?: string | number; className?: string }>;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-4 shadow-card" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <div className="flex items-center gap-2 text-txt-secondary">
        <Icon size={15} />
        <p className="text-[11px] uppercase tracking-[0.16em] text-txt-tertiary">{label}</p>
      </div>
      <p className="mt-2 text-sm font-semibold text-txt-primary">{value}</p>
      <p className="mt-2 text-xs leading-5 text-txt-secondary">{note}</p>
    </div>
  );
}

function OverviewTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <section className="rounded-2xl border bg-card px-5 py-4 shadow-card" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <p className="text-sm font-semibold text-txt-primary">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-txt-secondary">No captured data for this section in the current run</p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 rounded-xl bg-[#f7f7f7] px-4 py-3">
              <span className="text-sm text-txt-secondary">{row.label}</span>
              <span className="text-right text-sm font-medium text-txt-primary">{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OverviewRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-4" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <p className="text-[11px] uppercase tracking-[0.16em] text-txt-tertiary">{label}</p>
      <p className="mt-2 text-sm leading-6 text-txt-secondary">{value}</p>
    </div>
  );
}

function buildRows(
  source: Record<string, unknown> | null,
  mappings: Array<[string, string]>,
): Array<{ label: string; value: string }> {
  return mappings
    .map(([key, label]) => ({
      label,
      value: formatUnknown(source?.[key]),
    }))
    .filter((row) => row.value !== "Not captured");
}

function formatUnknown(value: unknown): string {
  if (value === null || value === undefined) return "Not captured";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "Not captured";
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0 ? JSON.stringify(value) : "Not captured";
  const text = String(value).trim();
  return text.length > 0 ? text : "Not captured";
}

function getNumericValue(
  source: Record<string, unknown> | null,
  keys: string[],
  fallback: number,
) {
  for (const key of keys) {
    const raw = source?.[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return fallback;
}

function formatCount(value: number) {
  return `${value} item${value === 1 ? "" : "s"}`;
}

function formatElapsedSeconds(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}m ${seconds}s`;
}

function dedupeRepoHotspotFeed(feed: WorkflowRepoHotspotItem[] | null): WorkflowRepoHotspotItem[] | null {
  if (feed === null) {
    return null;
  }

  const seen = new Set<string>();
  const deduped: WorkflowRepoHotspotItem[] = [];

  for (const item of feed) {
    const key = [item.repo.trim().toLowerCase(), item.hotspotClass, item.priority, item.label.trim().toLowerCase()].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped.slice(0, 8);
}
