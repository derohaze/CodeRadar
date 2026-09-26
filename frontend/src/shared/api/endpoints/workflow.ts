import { request } from "@/shared/api/client";
import type {
  WorkflowRepoHotspotFeedApiResponse,
  WorkflowRepoHotspotItem,
  WorkflowRepoIntelligenceSummary,
  WorkflowRepoIntelligenceSummaryApiResponse,
} from "@/shared/api/contract";
import { mapWorkflowRepoHotspotItem, mapWorkflowRepoIntelligenceSummary } from "@/shared/api/mappers/workflow";

/** Cross-session feeds: repository intelligence and its hotspot list. */

export async function getRepoIntelligenceSummary(limit = 25): Promise<WorkflowRepoIntelligenceSummary> {
  const data = await request<WorkflowRepoIntelligenceSummaryApiResponse>(`/sessions/repo-intelligence-summary?limit=${limit}`);
  return mapWorkflowRepoIntelligenceSummary(data);
}

export async function getRepoHotspots(limit = 25): Promise<WorkflowRepoHotspotItem[]> {
  const data = await request<WorkflowRepoHotspotFeedApiResponse>(`/sessions/repo-hotspots?limit=${limit}`);
  return data.items.map(mapWorkflowRepoHotspotItem);
}
