import { request } from "@/shared/api/client";
import type {
  ProviderInfo,
  ProviderModel,
  ProviderTestPayload,
  ProviderTestResult,
} from "@/shared/api/contract";
import type {
  ProviderInfoApiResponse,
  ProviderModelsApiResponse,
  ProviderTestApiResponse,
} from "@/shared/api/contract";

/** Which providers the app offers, and whether the configured one answers. */

export async function listProviders(): Promise<ProviderInfo[]> {
  const data = await request<ProviderInfoApiResponse[]>("/settings/providers");
  return data.map((p) => ({ id: p.id, name: p.name, defaultBaseUrl: p.default_base_url, docsUrl: p.docs_url }));
}

export async function testProvider(payload: ProviderTestPayload): Promise<ProviderTestResult> {
  const data = await request<ProviderTestApiResponse>("/settings/providers/test", {
    method: "POST",
    body: JSON.stringify({ provider: payload.provider, api_key: payload.apiKey ?? null, base_url: payload.baseUrl ?? null, model: payload.model ?? null }),
  });
  return { ok: data.ok, message: data.message, latencyMs: data.latency_ms };
}

export async function listProviderModels(payload: ProviderTestPayload): Promise<ProviderModel[]> {
  const data = await request<ProviderModelsApiResponse>("/settings/providers/models", {
    method: "POST",
    body: JSON.stringify({ provider: payload.provider, api_key: payload.apiKey ?? null, base_url: payload.baseUrl ?? null }),
  });
  return data.models.map((m) => ({ id: m.id, name: m.name, created: m.created ?? null }));
}
