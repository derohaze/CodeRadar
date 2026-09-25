/**
 * Provider diagnostics: listing models and testing a key.
 *
 * These are the two operations that exist to answer "is this configuration
 * usable?" before a review is started, and both are written to fail with a
 * sentence a user can act on. A raw status code plus a provider error body is
 * not an answer.
 *
 * Every message is stripped of the API key first. Provider errors routinely echo
 * the request, and the request carries the key in its `authorization` header.
 */

import { AiReviewerError, redactSecrets } from "../core/review/ai-reviewer.ts";
import { chatCompletionsUrl, modelsUrl, providerById } from "./provider-catalog.ts";
import { assertAllowedOutboundUrl } from "./outbound-url.ts";

/** The minimum a request needs. A resolved provider satisfies it structurally. */
export interface ProviderConnection {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ProviderModel {
  id: string;
  createdAt: number | null;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
}

/** Listing is capped: some gateways return thousands of models. */
const MAX_MODELS = 400;
const LIST_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY_LENGTH = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeErrorText(body: string, apiKey: string): string {
  return redactSecrets(body, [apiKey]).replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_BODY_LENGTH);
}

/**
 * Turns a status code into something to do about it. The provider's own text is
 * only appended when the status is not one of the well-known cases, because for
 * those the body is noise ("invalid_api_key") next to the real instruction.
 */
function describeFailure(status: number, body: string, apiKey: string): string {
  const detail = safeErrorText(body, apiKey);

  if (status === 401 || status === 403) return "The provider rejected the API key.";
  if (status === 404) return "The provider has no such endpoint. Check the base URL and the model name.";
  if (status === 429) return "The provider is rate limiting this key. Try again shortly.";
  if (status >= 500) return `The provider reported a server error (${status}).`;
  return detail === "" ? `The provider returned ${status}.` : `The provider returned ${status}: ${detail}`;
}

/** Models the provider will accept, sorted for a stable dropdown. */
export async function listModels(provider: ProviderConnection): Promise<ProviderModel[]> {
  const { url } = assertAllowedOutboundUrl(provider.baseUrl);

  let response: Response;
  try {
    response = await fetch(modelsUrl(url), {
      method: "GET",
      headers: { authorization: `Bearer ${provider.apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AiReviewerError(
      error instanceof Error && error.name === "TimeoutError"
        ? "The provider did not answer in time."
        : "The provider could not be reached.",
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AiReviewerError(describeFailure(response.status, body, provider.apiKey), response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AiReviewerError("The provider's model list was not valid JSON.");
  }

  const data = isRecord(payload) ? payload["data"] : undefined;
  if (!Array.isArray(data)) throw new AiReviewerError("The provider did not return a model list.");

  const models: ProviderModel[] = [];
  for (const entry of data.slice(0, MAX_MODELS)) {
    if (!isRecord(entry)) continue;
    const id = entry["id"];
    if (typeof id !== "string" || id === "") continue;

    const created = entry["created"];
    models.push({ id, createdAt: typeof created === "number" ? created : null });
  }

  models.sort((left, right) => left.id.localeCompare(right.id));
  return models;
}

/**
 * Sends the smallest possible completion to prove the key, the base URL, and the
 * model all work together. The latency is reported because a provider that
 * answers in 30 seconds is a different problem from one that does not answer.
 */
export async function testProvider(provider: ProviderConnection): Promise<ProviderTestResult> {
  const { url } = assertAllowedOutboundUrl(provider.baseUrl);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(chatCompletionsUrl(url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: "Reply with the single word: ok" },
          { role: "user", content: "ping" },
        ],
        temperature: 0,
        max_tokens: 8,
      }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      ok: false,
      message:
        error instanceof Error && error.name === "TimeoutError"
          ? "The provider did not answer in time."
          : "The provider could not be reached.",
      latencyMs,
    };
  }

  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, message: describeFailure(response.status, body, provider.apiKey), latencyMs };
  }

  const name = providerById(provider.id)?.name ?? provider.id;
  return { ok: true, message: `${name} answered with ${provider.model}.`, latencyMs };
}
