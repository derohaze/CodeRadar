import { request } from "@/shared/api/client";
import type { RuntimeSettings, RuntimeSettingsApiResponse, UpdateRuntimeSettingsPayload } from "@/shared/api/contract";
import { mapRuntimeSettings } from "@/shared/api/mappers/settings";

/** The engine's own defaults, which the Settings screen edits. */

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const data = await request<RuntimeSettingsApiResponse>("/settings/runtime");
  return mapRuntimeSettings(data);
}

export async function updateRuntimeSettings(payload: UpdateRuntimeSettingsPayload): Promise<RuntimeSettings> {
  const body: Record<string, unknown> = {};
  if (payload.defaultPreset !== undefined) body.default_preset = payload.defaultPreset;
  if (payload.defaultScanMode !== undefined) body.default_scan_mode = payload.defaultScanMode;
  if (payload.autoOpenResults !== undefined) body.auto_open_results = payload.autoOpenResults;
  if (payload.rememberSidebarState !== undefined) body.remember_sidebar_state = payload.rememberSidebarState;
  if (payload.motionProfile !== undefined) body.motion_profile = payload.motionProfile;
  if (payload.theme !== undefined) body.theme = payload.theme;
  if (payload.surfaceContrast !== undefined) body.surface_contrast = payload.surfaceContrast;
  if (payload.remediationMaxAttempts !== undefined) body.remediation_max_attempts = payload.remediationMaxAttempts;
  if (payload.remediationReuseExplanation !== undefined) body.remediation_reuse_explanation = payload.remediationReuseExplanation;
  if (payload.aiProvider !== undefined) body.ai_provider = payload.aiProvider;
  if (payload.aiApiKey !== undefined) body.ai_api_key = payload.aiApiKey;
  if (payload.aiBaseUrl !== undefined) body.ai_base_url = payload.aiBaseUrl;
  if (payload.aiModel !== undefined) body.ai_model = payload.aiModel;

  const data = await request<RuntimeSettingsApiResponse>("/settings/runtime", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return mapRuntimeSettings(data);
}
