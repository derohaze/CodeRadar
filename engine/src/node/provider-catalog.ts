/**
 * The providers the desktop app can talk to.
 *
 * This table is the single source of truth for the settings screen, the model
 * list, and the review service, so a provider is added in one place. Only
 * OpenAI-compatible providers are wired into the review engine today: the
 * request shape of the others differs, and pretending otherwise would mean
 * shipping a provider that fails on the first review rather than one that says
 * it is not ready.
 */

import { AiReviewerError } from "../core/review/ai-reviewer.ts";

export interface ProviderDefinition {
  id: string;
  name: string;
  /** Null when the provider has no usable default and the user must supply one. */
  defaultBaseUrl: string | null;
  docsUrl: string | null;
  /** Preselected model, when the provider has an obvious sensible default. */
  defaultModel: string | null;
  openAiCompatible: boolean;
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: "nvidia",
    name: "NVIDIA",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    docsUrl: "https://docs.api.nvidia.com",
    defaultModel: "nvidia/nemotron-3-super-120b-a12b",
    openAiCompatible: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    docsUrl: "https://platform.openai.com/docs",
    defaultModel: null,
    openAiCompatible: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    docsUrl: "https://api-docs.deepseek.com",
    defaultModel: null,
    openAiCompatible: true,
  },
  {
    id: "grok",
    name: "Grok (xAI)",
    defaultBaseUrl: "https://api.x.ai/v1",
    docsUrl: "https://docs.x.ai",
    defaultModel: null,
    openAiCompatible: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    docsUrl: "https://docs.anthropic.com",
    defaultModel: null,
    openAiCompatible: false,
  },
  {
    id: "gemini",
    name: "Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    defaultModel: null,
    openAiCompatible: false,
  },
  {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    defaultBaseUrl: null,
    docsUrl: null,
    defaultModel: null,
    openAiCompatible: true,
  },
];

export const DEFAULT_PROVIDER_ID = "nvidia";

export function providerById(id: string): ProviderDefinition | null {
  const normalised = id.trim().toLowerCase();
  return PROVIDERS.find((provider) => provider.id === normalised) ?? null;
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export function modelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

/**
 * Resolves a provider for a real request, or explains why it cannot be used.
 * The message is written for the settings screen, not for a log.
 */
export function requireCompatibleProvider(id: string): ProviderDefinition {
  const provider = providerById(id);
  if (provider === null) {
    throw new AiReviewerError(`Unknown provider "${id}". Pick one in Settings.`);
  }
  if (!provider.openAiCompatible) {
    throw new AiReviewerError(
      `${provider.name} is not wired into the review engine yet. Configure NVIDIA or another OpenAI-compatible provider in Settings.`,
    );
  }
  return provider;
}
