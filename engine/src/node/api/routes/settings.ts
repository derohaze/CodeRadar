/**
 * Runtime settings and provider access, in the renderer's `snake_case` wire format.
 *
 * The renderer owns this wire format and is not being changed, so the
 * translation lives at the edge, next to the routes that receive it. Only fields
 * the engine can act on are forwarded: a key the store does not know is dropped
 * rather than silently persisted, which is why an accepted PATCH is read back in
 * the response.
 */

import type { ProviderOverrides, ReviewService } from "../../service.ts";
import type { DesktopPreferences, ProviderSettings, PublicSettings, SettingsPatch } from "../../settings.ts";
import { isRecord } from "../body.ts";
import type { RouteHandler, RouteRequest } from "../context.ts";

/**
 * The provider the Settings screen is showing, from its `snake_case` body.
 *
 * Every field is optional on purpose: an empty body means "what is stored".
 */
function toProviderOverrides(body: unknown): ProviderOverrides {
  if (!isRecord(body)) return {};
  const overrides: ProviderOverrides = {};
  if (typeof body["provider"] === "string") overrides.provider = body["provider"];
  if (typeof body["api_key"] === "string") overrides.apiKey = body["api_key"];
  if (typeof body["base_url"] === "string") overrides.baseUrl = body["base_url"];
  if (typeof body["model"] === "string") overrides.model = body["model"];
  return overrides;
}

function settingsPayload(settings: PublicSettings): Record<string, unknown> {
  return {
    default_preset: settings.desktop.defaultPreset,
    default_scan_mode: settings.desktop.defaultScanMode,
    auto_open_results: settings.desktop.autoOpenResults,
    remember_sidebar_state: settings.desktop.rememberSidebarState,
    motion_profile: settings.desktop.motionProfile,
    theme: settings.desktop.theme,
    surface_contrast: settings.desktop.surfaceContrast,
    remediation_max_attempts: settings.desktop.remediationMaxAttempts,
    remediation_reuse_explanation: settings.desktop.remediationReuseExplanation,
    ai_provider: settings.provider.id,
    ai_model: settings.provider.model === "" ? null : settings.provider.model,
    ai_base_url: settings.provider.baseUrl === "" ? null : settings.provider.baseUrl,
    // A hint, never the key. The key stays in the main process.
    ai_api_key_masked: settings.provider.apiKeyHint === null ? null : `••••${settings.provider.apiKeyHint}`,
    ai_has_key: settings.provider.hasApiKey,
    updated_at: new Date().toISOString(),
  };
}

function toSettingsPatch(body: Record<string, unknown>): SettingsPatch {
  const patch: SettingsPatch = {};

  const provider: Partial<ProviderSettings> = {};
  if (typeof body["ai_provider"] === "string") provider.id = body["ai_provider"];
  if (typeof body["ai_base_url"] === "string") provider.baseUrl = body["ai_base_url"];
  if (typeof body["ai_model"] === "string") provider.model = body["ai_model"];
  if (Object.keys(provider).length > 0) patch.provider = provider;

  if (body["ai_api_key"] !== undefined) {
    patch.apiKey = typeof body["ai_api_key"] === "string" ? body["ai_api_key"] : null;
  }

  const desktop: Partial<DesktopPreferences> = {};
  const enumFields = [
    ["default_preset", "defaultPreset"],
    ["default_scan_mode", "defaultScanMode"],
    ["motion_profile", "motionProfile"],
    ["surface_contrast", "surfaceContrast"],
    ["theme", "theme"],
  ] as const;
  for (const [wire, field] of enumFields) {
    const value = body[wire];
    if (typeof value === "string") Object.assign(desktop, { [field]: value });
  }
  const booleanFields = [
    ["auto_open_results", "autoOpenResults"],
    ["remember_sidebar_state", "rememberSidebarState"],
    ["remediation_reuse_explanation", "remediationReuseExplanation"],
  ] as const;
  for (const [wire, field] of booleanFields) {
    const value = body[wire];
    if (typeof value === "boolean") Object.assign(desktop, { [field]: value });
  }
  if (typeof body["remediation_max_attempts"] === "number") {
    desktop.remediationMaxAttempts = body["remediation_max_attempts"];
  }
  if (Object.keys(desktop).length > 0) patch.desktop = desktop;

  return patch;
}

/** Applies a PATCH body and answers with what was actually stored. */
function applySettingsPatch({ request, response, service, security }: RouteRequest, body: unknown): void {
  void service
    .updateSettings(isRecord(body) ? toSettingsPatch(body) : {})
    .then((settings) => {
      // The renderer's settings screen reads these snake_case fields.
      security.sendJson(request, response, 200, settingsPayload(settings));
    })
    .catch((error: unknown) => security.sendFailure(request, response, 400, error));
}

function testProviderRoute(route: RouteRequest, body: unknown): void {
  const { request, response, service, security } = route;
  void service
    .testProvider(toProviderOverrides(body))
    .then((result) => security.sendJson(request, response, 200, { ok: result.ok, message: result.message, latency_ms: result.latencyMs }))
    .catch((error: unknown) => security.sendFailure(request, response, 400, error));
}

function listModelsRoute(route: RouteRequest, body: unknown): void {
  const { request, response, service, security } = route;
  void service
    .listModels(toProviderOverrides(body))
    .then((models) =>
      security.sendJson(request, response, 200, {
        models: models.map((model) => ({ id: model.id, name: model.id, created: model.createdAt })),
      }),
    )
    .catch((error: unknown) => security.sendFailure(request, response, 400, error));
}

/** Reads a body, then hands it to one of the provider routes. Never rejects. */
function withBody(route: RouteRequest, handle: (route: RouteRequest, body: unknown) => void): void {
  void route.security.readJsonBody(route.request).then(
    (body) => handle(route, body),
    (error: unknown) => route.security.sendFailure(route.request, route.response, 400, error),
  );
}

function providersPayload(service: ReviewService): Array<Record<string, unknown>> {
  return service.providers().map((provider) => ({
    id: provider.id,
    name: provider.name,
    default_base_url: provider.defaultBaseUrl,
    docs_url: provider.docsUrl,
  }));
}

export const settingsRoutes: RouteHandler = (route) => {
  const { request, response, method, suffix, service, security } = route;

  if (suffix === "/settings/runtime" && method === "GET") {
    void service
      .settings()
      .then((settings) => security.sendJson(request, response, 200, settingsPayload(settings)))
      .catch((error: unknown) => security.sendFailure(request, response, 500, error));
    return true;
  }
  if (suffix === "/settings/runtime" && method === "PATCH") {
    withBody(route, applySettingsPatch);
    return true;
  }
  if (suffix === "/settings/providers" && method === "GET") {
    security.sendJson(request, response, 200, providersPayload(service));
    return true;
  }
  if (suffix === "/settings/providers/test" && method === "POST") {
    withBody(route, testProviderRoute);
    return true;
  }
  if (suffix === "/settings/providers/models" && method === "POST") {
    withBody(route, listModelsRoute);
    return true;
  }

  return false;
};
