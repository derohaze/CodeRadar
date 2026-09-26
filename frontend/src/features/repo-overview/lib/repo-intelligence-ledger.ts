import type { ScanSessionDetail } from "@/shared/api";

export interface RepoIntelligenceLedgerItem {
  ledgerClass: "framework-footprint" | "service-graph" | "segmentation" | "registry" | "coverage";
  priority: "critical" | "high" | "normal";
  label: string;
  evidence: string;
  nextAction: string;
}

export interface RepoIntelligenceLedgerSummary {
  itemCount: number;
  criticalItems: number;
  frameworkItems: number;
  graphItems: number;
  segmentationItems: number;
  registryItems: number;
  coverageItems: number;
  topItemLabel: string;
}

export function buildRepoIntelligenceLedger(session: ScanSessionDetail): RepoIntelligenceLedgerItem[] {
  const inventory = session.session.repositoryInventory;
  const framework = session.session.frameworkProfile;
  const graph = session.session.graphSummary;
  const segmentation = session.session.segmentationSummary;
  const registry = session.session.securityRegistry;

  const items: RepoIntelligenceLedgerItem[] = [];

  const frameworkCount = countValue(framework?.languages) + countValue(framework?.runtimes) + countValue(framework?.package_managers);
  if (frameworkCount > 0) {
    items.push({
      ledgerClass: "framework-footprint",
      priority: frameworkCount >= 4 ? "high" : "normal",
      label: "Framework footprint mapped",
      evidence: `${frameworkCount} framework signal(s) captured across languages, runtimes, and package managers`,
      nextAction: "Confirm the framework edges before expanding autonomous coverage"
    });
  }

  const graphCount = countValue(graph?.services) + countValue(graph?.trust_boundaries) + countValue(graph?.external_surfaces);
  if (graphCount > 0) {
    items.push({
      ledgerClass: "service-graph",
      priority: graphCount >= 4 ? "high" : "normal",
      label: "Service graph pressure recorded",
      evidence: `${graphCount} service and boundary signal(s) are tracked in the repo graph`,
      nextAction: "Validate trust boundaries and external surfaces before relying on autonomous remediation"
    });
  }

  const segmentationCount = countValue(segmentation?.critical_zones)
    + countValue(segmentation?.sensitive_files)
    + countValue(segmentation?.identity_surfaces)
    + countValue(segmentation?.config_surfaces);
  if (segmentationCount > 0) {
    items.push({
      ledgerClass: "segmentation",
      priority: segmentationCount >= 4 ? "high" : "normal",
      label: "Segmentation signals captured",
      evidence: `${segmentationCount} segmentation signal(s) identified across critical and sensitive zones`,
      nextAction: "Keep segmentation boundaries in the approval path before broadening auto-apply"
    });
  }

  const registryCount = countValue(registry?.auth_components)
    + countValue(registry?.data_sinks)
    + countValue(registry?.user_inputs)
    + countValue(registry?.network_boundaries);
  if (registryCount > 0) {
    items.push({
      ledgerClass: "registry",
      priority: registryCount >= 5 ? "high" : "normal",
      label: "Security registry pressure tracked",
      evidence: `${registryCount} registry signal(s) remain active in the repo inventory`,
      nextAction: "Correlate inputs and sinks before relaxing verification gates"
    });
  }

  if (session.session.coveragePercent < 100 || session.session.skippedFilesCount > 0) {
    items.push({
      ledgerClass: "coverage",
      priority: session.session.coveragePercent < 85 ? "critical" : "high",
      label: "Coverage gaps remain",
      evidence: `${session.session.coveragePercent}% coverage with ${session.session.skippedFilesCount} skipped file(s) recorded`,
      nextAction: "Close coverage gaps before trusting repo-wide risk posture"
    });
  }

  if (countValue(inventory?.file_count ?? inventory?.files ?? inventory?.total_files) === 0) {
    items.push({
      ledgerClass: "coverage",
      priority: "critical",
      label: "Repository inventory missing",
      evidence: "File inventory is not available for the current session",
      nextAction: "Rebuild repository inventory before relying on repo-wide metrics"
    });
  }

  return items.sort((left, right) => {
    const priorityDelta = priorityWeight(right.priority) - priorityWeight(left.priority);
    if (priorityDelta !== 0) return priorityDelta;
    return left.label.localeCompare(right.label);
  });
}

export function summarizeRepoIntelligenceLedger(items: RepoIntelligenceLedgerItem[]): RepoIntelligenceLedgerSummary {
  const criticalItems = items.filter((item) => item.priority === "critical").length;
  const frameworkItems = items.filter((item) => item.ledgerClass === "framework-footprint").length;
  const graphItems = items.filter((item) => item.ledgerClass === "service-graph").length;
  const segmentationItems = items.filter((item) => item.ledgerClass === "segmentation").length;
  const registryItems = items.filter((item) => item.ledgerClass === "registry").length;
  const coverageItems = items.filter((item) => item.ledgerClass === "coverage").length;
  const topItem = items[0] ?? null;

  return {
    itemCount: items.length,
    criticalItems,
    frameworkItems,
    graphItems,
    segmentationItems,
    registryItems,
    coverageItems,
    topItemLabel: topItem ? `${topItem.priority} - ${topItem.label}` : "No repo intelligence ledger entries"
  };
}

function countValue(value: unknown) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  if (typeof value === "string" && value.trim().length > 0) return 1;
  return 0;
}

function priorityWeight(value: RepoIntelligenceLedgerItem["priority"]) {
  return {
    critical: 3,
    high: 2,
    normal: 1,
  }[value];
}
