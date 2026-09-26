import type { ScanSessionDetail } from "@/shared/api";

export interface RepoHotspot {
  id: string;
  label: string;
  hotspotClass: "identity-zone" | "exposure-zone" | "data-zone" | "coverage-zone";
  priority: "critical" | "high" | "normal";
  evidence: string;
  nextInvestigation: string;
}

export interface RepoIntelligenceSummary {
  hotspotCount: number;
  criticalHotspots: number;
  identityZones: number;
  exposureZones: number;
  dataZones: number;
  coverageZones: number;
  topHotspotLabel: string;
}

export function buildRepoHotspots(session: ScanSessionDetail): RepoHotspot[] {
  const hotspots: RepoHotspot[] = [];
  const segmentation = session.session.segmentationSummary;
  const registry = session.session.securityRegistry;
  const graph = session.session.graphSummary;

  const identityCount = countValue(segmentation?.identity_surfaces) + countValue(registry?.auth_components);
  if (identityCount > 0) {
    hotspots.push({
      id: "identity-zone",
      label: "Identity surfaces",
      hotspotClass: "identity-zone",
      priority: identityCount >= 3 ? "critical" : "high",
      evidence: `${identityCount} identity and auth signal(s) tracked in the current repository run`,
      nextInvestigation: "Review auth and session trust boundaries before expanding autonomous behavior"
    });
  }

  const exposureCount = countValue(graph?.external_surfaces) + countValue(graph?.trust_boundaries) + countValue(registry?.network_boundaries);
  if (exposureCount > 0) {
    hotspots.push({
      id: "exposure-zone",
      label: "Exposure boundaries",
      hotspotClass: "exposure-zone",
      priority: exposureCount >= 4 ? "critical" : "high",
      evidence: `${exposureCount} external or trust-boundary signal(s) are active in the repository graph`,
      nextInvestigation: "Validate the exposed service edges before treating current posture as stable"
    });
  }

  const dataCount = countValue(registry?.data_sinks) + countValue(registry?.user_inputs);
  if (dataCount > 0) {
    hotspots.push({
      id: "data-zone",
      label: "Input and sink pressure",
      hotspotClass: "data-zone",
      priority: dataCount >= 5 ? "high" : "normal",
      evidence: `${dataCount} input and sink signal(s) remain in the current security registry`,
      nextInvestigation: "Correlate high-pressure inputs with sinks and traced paths before reducing review depth"
    });
  }

  if (session.session.coveragePercent < 100 || session.session.skippedFilesCount > 0) {
    hotspots.push({
      id: "coverage-zone",
      label: "Coverage gaps",
      hotspotClass: "coverage-zone",
      priority: session.session.coveragePercent < 85 ? "high" : "normal",
      evidence: `${session.session.coveragePercent}% coverage with ${session.session.skippedFilesCount} skipped file(s) in the current run`,
      nextInvestigation: "Close repository coverage gaps before trusting repo-wide posture conclusions"
    });
  }

  return hotspots.sort((left, right) => {
    const priorityDelta = priorityWeight(right.priority) - priorityWeight(left.priority);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return left.label.localeCompare(right.label);
  });
}

export function summarizeRepoHotspots(hotspots: RepoHotspot[]): RepoIntelligenceSummary {
  const criticalHotspots = hotspots.filter((item) => item.priority === "critical").length;
  const identityZones = hotspots.filter((item) => item.hotspotClass === "identity-zone").length;
  const exposureZones = hotspots.filter((item) => item.hotspotClass === "exposure-zone").length;
  const dataZones = hotspots.filter((item) => item.hotspotClass === "data-zone").length;
  const coverageZones = hotspots.filter((item) => item.hotspotClass === "coverage-zone").length;
  const topHotspot = hotspots[0] ?? null;

  return {
    hotspotCount: hotspots.length,
    criticalHotspots,
    identityZones,
    exposureZones,
    dataZones,
    coverageZones,
    topHotspotLabel: topHotspot ? `${topHotspot.priority} - ${topHotspot.label}` : "No repository hotspot"
  };
}

function countValue(value: unknown) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  if (typeof value === "string" && value.trim().length > 0) return 1;
  return 0;
}

function priorityWeight(value: RepoHotspot["priority"]) {
  return {
    critical: 3,
    high: 2,
    normal: 1,
  }[value];
}
