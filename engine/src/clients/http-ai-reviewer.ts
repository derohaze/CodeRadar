/**
 * The outbound provider client: the one place in the engine that reaches the
 * network.
 *
 * It lives outside `core/` on purpose. The core's own rule is that everything
 * from the outside world arrives through a port, and a `fetch` inside it made
 * that rule a convention rather than a boundary. Here it implements the core's
 * `AiReviewerPort`, so the pipeline is unchanged: what a response must look like
 * is decided in `core/review/ai-reviewer.ts`, and how it is fetched is decided
 * here.
 *
 * Retries exist because a provider that is briefly rate limiting is not a review
 * outcome. Only statuses that can plausibly succeed on a repeat are retried, the
 * provider's own `Retry-After` wins over the computed backoff, and a
 * cancellation always beats a pending retry.
 */

import { AiReviewerError, isRecord, redactSecrets } from "../core/review/ai-reviewer.ts";
import type {
  AiReviewAttemptTelemetry,
  AiReviewExecution,
  AiReviewRequest,
  AiReviewTelemetry,
  AiReviewerPort,
} from "../core/ports.ts";
import { aiReviewFailure } from "../core/ports.ts";

export interface HttpAiReviewerOptions {
  /** Full chat-completions URL, for example `https://host/v1/chat/completions`. */
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  /** Aborts the in-flight request and stops any further attempts. */
  signal?: AbortSignal;
  /** Total attempts, including the first. Clamped to 1-6. */
  maxAttempts?: number;
  /** Base delay for exponential backoff between attempts. */
  retryDelayMs?: number;
  /** Called before a retry sleeps, so the UI can explain the wait. */
  onRetry?: (info: RetryInfo) => void;
}

/** What a caller is told when an attempt is about to be repeated. */
export interface RetryInfo {
  /** The attempt that just failed, 1-based. */
  attempt: number;
  /** Provider status, or null when the request never completed. */
  status: number | null;
  delayMs: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const MAX_ERROR_BODY_LENGTH = 400;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 20_000;
/**
 * A `Retry-After` beyond this is treated as "this key is blocked", not as a
 * wait to perform. Sleeping for a minute inside a review is worse for the user
 * than failing over to the deterministic findings.
 */
const MAX_HONOURED_RETRY_AFTER_MS = 30_000;

/** Statuses where repeating the same request can plausibly succeed. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

const UTF8 = new TextEncoder();

/** Response bodies are measured, never stored: a byte count is metadata. */
function utf8Bytes(text: string): number {
  return UTF8.encode(text).length;
}

/** Safe metadata a provider envelope carries about the call that produced it. */
interface ResponseMetadata {
  responseId: string | null;
  responseModel: string | null;
  finishReason: string | null;
  usage: AiReviewAttemptTelemetry["usage"];
}

/**
 * Reads only the envelope fields the telemetry contract declares, and only when
 * they have the type it claims. A response is untrusted input, so a field with
 * the wrong shape is reported as absent rather than coerced into something
 * plausible.
 */
function responseMetadata(payload: unknown): ResponseMetadata {
  if (!isRecord(payload)) {
    return { responseId: null, responseModel: null, finishReason: null, usage: null };
  }

  const choices = payload.choices;
  const first = Array.isArray(choices) && isRecord(choices[0]) ? choices[0] : null;
  const usage = isRecord(payload.usage) ? payload.usage : null;

  const optionalText = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };
  const optionalTokens = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  return {
    responseId: optionalText(payload.id),
    responseModel: optionalText(payload.model),
    finishReason: first === null ? null : optionalText(first.finish_reason),
    usage:
      usage === null
        ? null
        : {
            promptTokens: optionalTokens(usage.prompt_tokens),
            completionTokens: optionalTokens(usage.completion_tokens),
            totalTokens: optionalTokens(usage.total_tokens),
          },
  };
}

/** The facts of one attempt that are known before its response is read. */
interface AttemptFacts {
  attempt: number;
  startedAt: number;
  outcome: AiReviewAttemptTelemetry["outcome"];
  /** Provider status, or null when no response was received. */
  status: number | null;
  headers: { contentType: string | null; requestId: string | null } | null;
}

/**
 * A telemetry entry for one attempt, with everything unknown left null.
 *
 * It is built before the response is read so a failure still has a latency and an
 * outcome: an attempt that produced no answer is exactly the case the record
 * exists for.
 */
function attemptEntry(facts: AttemptFacts): AiReviewAttemptTelemetry {
  return {
    attempt: facts.attempt,
    latencyMs: Date.now() - facts.startedAt,
    outcome: facts.outcome,
    status: facts.status,
    contentType: facts.headers?.contentType ?? null,
    requestId: facts.headers?.requestId ?? null,
    responseBytes: null,
    responseId: null,
    responseModel: null,
    finishReason: null,
    usage: null,
  };
}

/**
 * A failed attempt together with whether repeating it is worth doing.
 *
 * `retryable` is carried on the error rather than inferred at the call site:
 * only the code that saw the response can tell a rate limit from a bad API key.
 */
class AttemptFailure extends AiReviewerError {
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number | null, retryable: boolean, retryAfterMs: number | null = null) {
    super(message, status);
    this.name = "AttemptFailure";
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/** The provider's own backoff hint, bounded, or null when there is none. */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header === null) return null;

  const seconds = Number.parseFloat(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;

  const milliseconds = Math.round(seconds * 1_000);
  return milliseconds > MAX_HONOURED_RETRY_AFTER_MS ? null : milliseconds;
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);

    function onAbort(): void {
      clearTimeout(timer);
      reject(new AiReviewerError("provider request was cancelled"));
    }

    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * One attempt's abort signal: the caller's cancellation and the timeout, merged.
 *
 * The listener is removed by `dispose` because a long review makes many calls,
 * and listeners left on a caller-owned signal accumulate for the whole run.
 */
function linkAbort(external: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = (): void => controller.abort();

  external?.addEventListener("abort", onExternalAbort);

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

/**
 * The HTTP reviewer, which always reports per-call telemetry.
 *
 * The narrower return type is deliberate: the port keeps `reviewWithTelemetry`
 * optional so a reviewer may be minimal, while this implementation must never be
 * one of those — a caller of this function can rely on the call record existing.
 */
export interface HttpAiReviewer extends AiReviewerPort {
  reviewWithTelemetry(request: AiReviewRequest): Promise<AiReviewExecution>;
}

/**
 * A chat-completions reviewer.
 *
 * Low temperature is not a stylistic choice: reviewing the same file twice and
 * getting different findings makes the output untrustworthy, and determinism is
 * what lets fixtures assert on results.
 */
export function createHttpAiReviewer(options: HttpAiReviewerOptions): HttpAiReviewer {
  const parsed = new URL(options.endpoint);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AiReviewerError(`unsupported endpoint protocol: ${parsed.protocol}`);
  }
  // Credentials in a URL end up in logs and in proxy history.
  if (parsed.username !== "" || parsed.password !== "") {
    throw new AiReviewerError("endpoint must not embed credentials");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const maxAttempts = Math.min(6, Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);

  /**
   * The identity a recording of this reviewer is keyed under, and the provider a
   * telemetry record names. It is the endpoint that was configured, not a guess.
   */
  const provider = parsed.host;

  const telemetryOf = (attempts: AiReviewAttemptTelemetry[]): AiReviewTelemetry => ({
    provider,
    // The configured model, not a value read back from the response: what was
    // asked for and what answered are two facts, and the response's own claim is
    // kept per attempt as `responseModel`.
    model: options.model,
    attempts,
  });

  /**
   * One provider attempt, with what the transport saw.
   *
   * Every branch records exactly one entry before it returns or throws, so an
   * attempt can never be silently missing from the record it belongs to. Nothing
   * recorded here comes from the response body except its size and the envelope
   * metadata the contract declares; prompts and content never enter it.
   */
  async function attempt(
    request: AiReviewRequest,
    attemptNumber: number,
    record: (entry: AiReviewAttemptTelemetry) => void,
  ): Promise<unknown> {
    const startedAt = Date.now();
    const link = linkAbort(options.signal, timeoutMs);
    let response: Response;
    try {
      response = await fetch(parsed, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt },
          ],
          temperature: 0.1,
          max_tokens: maxOutputTokens,
          response_format: { type: "json_object" },
        }),
        signal: link.signal,
      });
    } catch (error) {
      // A cancelled run is not a provider problem, and the caller must be able
      // to tell the two apart: one aborts the review, the other degrades it.
      if (options.signal?.aborted === true) {
        record(attemptEntry({ attempt: attemptNumber, startedAt, outcome: "cancelled", status: null, headers: null }));
        throw new AiReviewerError("provider request was cancelled");
      }

      const detail = error instanceof Error ? error.name : "unknown error";
      record(
        attemptEntry({ attempt: attemptNumber, startedAt, outcome: "transport-error", status: null, headers: null }),
      );
      throw new AttemptFailure(`provider request failed: ${detail}`, null, true);
    } finally {
      link.dispose();
    }

    const headers = {
      contentType: response.headers.get("content-type"),
      requestId: response.headers.get("x-request-id") ?? response.headers.get("request-id"),
    };

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const safeBody = redactSecrets(body, [options.apiKey]).replace(/\s+/g, " ").slice(0, MAX_ERROR_BODY_LENGTH);
      const status = response.status;
      record({
        ...attemptEntry({ attempt: attemptNumber, startedAt, outcome: "http-error", status, headers }),
        responseBytes: utf8Bytes(body),
      });
      throw new AttemptFailure(
        `provider returned ${status}: ${safeBody}`,
        status,
        RETRYABLE_STATUSES.has(status),
        retryAfterMs(response),
      );
    }

    // Read as text first so an unparseable body can be measured rather than only
    // rejected: the size is what separates "empty response" from "wrong shape".
    const body = await response.text().catch(() => "");
    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      record({
        ...attemptEntry({ attempt: attemptNumber, startedAt, outcome: "invalid-json", status: response.status, headers }),
        responseBytes: utf8Bytes(body),
      });
      throw new AiReviewerError("provider response was not valid JSON");
    }

    const metadata = responseMetadata(payload);
    record({
      ...attemptEntry({ attempt: attemptNumber, startedAt, outcome: "response", status: response.status, headers }),
      responseBytes: utf8Bytes(body),
      responseId: metadata.responseId,
      responseModel: metadata.responseModel,
      finishReason: metadata.finishReason,
      usage: metadata.usage,
    });

    return payload;
  }

  /**
   * The retry loop, returning its outcome instead of throwing it.
   *
   * The telemetry of a failed call is the whole point: it has to survive the
   * failure, and a thrown error cannot carry it. `review()` turns the returned
   * outcome back into the exact error it always threw, so a caller that does not
   * ask for telemetry sees no change at all.
   */
  async function execute(request: AiReviewRequest): Promise<
    | { ok: true; response: unknown; telemetry: AiReviewTelemetry }
    | { ok: false; error: unknown; telemetry: AiReviewTelemetry }
  > {
    const attempts: AiReviewAttemptTelemetry[] = [];
    const record = (entry: AiReviewAttemptTelemetry): void => {
      attempts.push(entry);
    };
    let lastFailure: AttemptFailure | null = null;

    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
      if (options.signal?.aborted === true) {
        // No attempt was started, so nothing is recorded: an empty attempt list
        // and a cancelled attempt are different facts about the same run.
        return { ok: false, error: new AiReviewerError("provider request was cancelled"), telemetry: telemetryOf(attempts) };
      }

      try {
        return {
          ok: true,
          response: await attempt(request, attemptNumber, record),
          telemetry: telemetryOf(attempts),
        };
      } catch (error) {
        // Anything that is not a marked attempt failure is a decision, not a
        // transport hiccup: an unparseable body and a cancellation both pass
        // straight through.
        if (!(error instanceof AttemptFailure) || !error.retryable || attemptNumber === maxAttempts) {
          return { ok: false, error, telemetry: telemetryOf(attempts) };
        }

        lastFailure = error;
        const backoff = Math.min(MAX_RETRY_DELAY_MS, retryDelayMs * 2 ** (attemptNumber - 1));
        const delayMs = error.retryAfterMs ?? backoff;
        options.onRetry?.({ attempt: attemptNumber, status: error.status, delayMs });
        try {
          await sleep(delayMs, options.signal ?? new AbortController().signal);
        } catch (cancelled) {
          return { ok: false, error: cancelled, telemetry: telemetryOf(attempts) };
        }
      }
    }

    return {
      ok: false,
      error: lastFailure ?? new AiReviewerError("provider request failed"),
      telemetry: telemetryOf(attempts),
    };
  }

  return {
    name: `http:${provider}`,
    async review(request: AiReviewRequest): Promise<unknown> {
      const call = await execute(request);
      if (call.ok) return call.response;
      throw call.error;
    },
    /**
     * The same call, with the transport record attached.
     *
     * The failure message is deliberately content-free: `aiReviewFailure` keeps
     * only the exception class, because a provider message can echo the source it
     * was shown. Everything a diagnosis needs — provider, model, attempt outcomes,
     * status codes, byte counts, token usage — is in the telemetry instead.
     */
    async reviewWithTelemetry(request: AiReviewRequest): Promise<AiReviewExecution> {
      const call = await execute(request);
      return call.ok
        ? { status: "response", response: call.response, telemetry: call.telemetry }
        : aiReviewFailure(call.error, call.telemetry);
    },
  };
}
