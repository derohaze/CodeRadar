import type {
  WorkflowRepoHotspotItem,
  WorkflowRepoHotspotItemApiResponse,
  WorkflowRepoIntelligenceSummary,
  WorkflowRepoIntelligenceSummaryApiResponse,
} from "@/shared/api/contract";

/** The cross-session repository feeds, wire shape to app shape. */

export function mapWorkflowRepoIntelligenceSummary(
  data: WorkflowRepoIntelligenceSummaryApiResponse,
): WorkflowRepoIntelligenceSummary {
  return {
    sessionCount: data.session_count,
    hotspotCount: data.hotspot_count,
    criticalHotspots: data.critical_hotspots,
    identityZones: data.identity_zones,
    exposureZones: data.exposure_zones,
    dataZones: data.data_zones,
    coverageZones: data.coverage_zones,
    topHotspotLabel: data.top_hotspot_label,
    topRepositories: data.top_repositories,
  };
}

export function mapWorkflowRepoHotspotItem(data: WorkflowRepoHotspotItemApiResponse): WorkflowRepoHotspotItem {
  return {
    sessionId: data.session_id,
    repo: data.repo,
    hotspotClass: data.hotspot_class,
    priority: data.priority,
    label: data.label,
  };
}
