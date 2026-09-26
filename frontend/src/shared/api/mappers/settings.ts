import type { RuntimeSettings, RuntimeSettingsApiResponse } from "@/shared/api/contract";

/** The engine's runtime defaults, wire shape to app shape. */

export function mapRuntimeSettings(data: RuntimeSettingsApiResponse): RuntimeSettings {
  return {
    defaultPreset: data.default_preset,
    defaultScanMode: data.default_scan_mode,
    autoOpenResults: data.auto_open_results,
    rememberSidebarState: data.remember_sidebar_state,
    motionProfile: data.motion_profile,
    theme: data.theme,
    surfaceContrast: data.surface_contrast,
    remediationMaxAttempts: data.remediation_max_attempts,
    remediationReuseExplanation: data.remediation_reuse_explanation,
    aiProvider: (data as unknown as Record<string, unknown>).ai_provider as string | null | undefined ?? null,
    aiModel: (data as unknown as Record<string, unknown>).ai_model as string | null | undefined ?? null,
    aiBaseUrl: (data as unknown as Record<string, unknown>).ai_base_url as string | null | undefined ?? null,
    aiApiKeyMasked: (data as unknown as Record<string, unknown>).ai_api_key_masked as string | null | undefined ?? null,
    aiHasKey: Boolean((data as unknown as Record<string, unknown>).ai_has_key),
    updatedAt: data.updated_at,
  };
}
