/**
 * The engine's Node entry point.
 *
 * This is what the Electron main process loads, and it is the only module the
 * bundled `review-engine.cjs` re-exports. Wiring belongs here so the main
 * process never reaches into `src/core/**`: the core stays transport-agnostic,
 * and the surface the desktop app depends on is one file that can be reviewed.
 *
 * Nothing in this graph imports Electron. The API-key cipher is injected at
 * startup, which is what keeps the engine runnable as a CLI and under `bun test`
 * without an Electron runtime present.
 */

export { DEFAULT_PROVIDER_ID, PROVIDERS, chatCompletionsUrl, modelsUrl, providerById, requireCompatibleProvider } from "./provider-catalog.ts";
export type { ProviderDefinition } from "./provider-catalog.ts";

export { OutboundUrlError, assertAllowedOutboundUrl } from "./outbound-url.ts";
export type { KeyCipher, KeyProtection } from "./key-cipher.ts";

export { listModels, testProvider } from "./provider-client.ts";
export type { ProviderConnection, ProviderModel, ProviderTestResult } from "./provider-client.ts";

export {
  DEFAULT_REVIEW_DEFAULTS,
  createSettingsStore,
  defaultProviderConfig,
} from "./settings.ts";
export type {
  ProviderSettings,
  PublicProviderSettings,
  PublicSettings,
  ResolvedProvider,
  ReviewDefaults,
  SettingsPatch,
  SettingsStore,
  SettingsStoreOptions,
} from "./settings.ts";

export { SourceWindowError, readSourceWindow } from "./source-window.ts";
export type { SourceWindow, SourceWindowRequest } from "./source-window.ts";

export { ReviewCancelledError, createReviewService, resolvePromptsDir } from "./service.ts";
export type {
  ReviewService,
  ReviewServiceOptions,
  ReviewServiceRequest,
  ReviewServiceResult,
} from "./service.ts";

export { startReviewApiServer } from "./api/server.ts";
export type { ReviewApiServer, ReviewApiServerOptions } from "./api/server.ts";

export { buildWireScanDetail, buildWireSession, toWireFinding } from "./api-contract.ts";
export type { WireFinding, WireScanDetail, WireSession } from "./api-contract.ts";
