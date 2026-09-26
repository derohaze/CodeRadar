/**
 * The local review API.
 *
 * Import from here, never from a file inside: the endpoints, the mappers and the
 * transport are one module with one public surface, and the shape of a request is
 * the contract in `./contract`.
 *
 * `shared/api/network` remains separate on purpose — it is the browser-level
 * startup probe, not part of the engine's contract.
 */

export { apiUrl, request, tokenQuery } from "./client";
export { subscribeToScanEvents } from "./events";

export {
  deleteAllScanSessions,
  deleteScanSession,
  getScanSession,
  listSessions,
  scanReportUrl,
  startScan,
} from "./endpoints/sessions";
export { listProviderModels, listProviders, testProvider } from "./endpoints/providers";
export { getRuntimeSettings, updateRuntimeSettings } from "./endpoints/settings";
export { explainFinding } from "./endpoints/findings";
export { getRepoHotspots, getRepoIntelligenceSummary } from "./endpoints/workflow";

export type {
  AiReviewSummary,
  ExplainFindingPayload,
  ProviderInfo,
  ProviderModel,
  ProviderTestPayload,
  ProviderTestResult,
  RejectedCandidateSummary,
  RejectionComparison,
  ReviewLimitationSummary,
  ReviewState,
  RuntimeSettings,
  ScanSessionDetail,
  StartScanPayload,
  UpdateRuntimeSettingsPayload,
  WorkflowRepoHotspotItem,
  WorkflowRepoIntelligenceSummary,
} from "./contract";
