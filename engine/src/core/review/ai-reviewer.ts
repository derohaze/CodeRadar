/**
 * Model output handling.
 *
 * This file is a trust boundary. Everything a model returns is `unknown` until
 * it has been narrowed here, and even then it is only a candidate: the validator
 * still has to prove the evidence exists before it becomes a finding.
 *
 * Two rules are enforced in this module and must not be relaxed:
 *
 * 1. No value from a response is used until its type has been checked. A model
 *    response is attacker-influenced input, because the reviewed code is.
 * 2. Credentials never appear in an error message. A provider error body is
 *    untrusted text that may echo the request, so it is redacted before it is
 *    ever allowed into a message or a log.
 */

import type { CandidateFinding } from "../findings/validate.ts";
import type { AiReviewRequest, AiReviewerPort } from "../ports.ts";

export interface ParsedReviewResponse {
  verdict: "approve" | "needs-attention" | null;
  /** Bounded, single-paragraph summary. Empty when the model omitted it. */
  summary: string;
  candidates: CandidateFinding[];
  /** Shape problems worth logging. Never contains raw model prose. */
  issues: string[];
}

/** A response larger than this is not worth parsing and is almost certainly noise. */
const MAX_SUMMARY_LENGTH = 2000;
const MAX_CANDIDATES = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a text field, accepting only strings and numbers. */
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function firstText(...values: readonly unknown[]): string {
  for (const value of values) {
    const candidate = text(value);
    if (candidate !== "") return candidate;
  }
  return "";
}

function number(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function firstNumber(...values: readonly unknown[]): number {
  for (const value of values) {
    const parsed = number(value);
    if (parsed !== 0) return parsed;
  }
  return 0;
}

/**
 * Extracts the JSON object from a model response. Models wrap JSON in code
 * fences and occasionally add a sentence before it, so the parse is attempted
 * on the whole string first and then on the outermost brace pair.
 */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  const withoutFence = trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
  const fenced = tryParse(withoutFence);
  if (fenced !== undefined) return fenced;

  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  const sliced = tryParse(withoutFence.slice(start, end + 1));
  return sliced === undefined ? null : sliced;
}

function tryParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

/** Normalises whatever the port returned into a string worth parsing. */
function toResponseText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!isRecord(raw)) return "";
  // OpenAI-compatible shape first, then the common alternatives.
  const choices = raw.choices;
  if (Array.isArray(choices)) {
    const first = choices[0];
    if (isRecord(first)) {
      const message = first.message;
      if (isRecord(message)) {
        const content = text(message.content);
        if (content !== "") return content;
      }
      const choiceText = text(first.text);
      if (choiceText !== "") return choiceText;
    }
  }
  const direct = firstText(raw.content, raw.text, raw.output);
  if (direct !== "") return direct;
  return JSON.stringify(raw);
}

function toCandidate(entry: unknown): CandidateFinding | null {
  if (!isRecord(entry)) return null;

  const file = text(entry.file ?? entry.path);
  if (file === "") return null;

  const line = firstNumber(entry.line, entry.line_number, entry.start_line, entry.startLine);
  if (line === 0) return null;

  return {
    file,
    line,
    lineEnd: firstNumber(entry.line_end, entry.end_line, entry.endLine, entry.endLineNumber) || line,
    severity: text(entry.severity),
    axis: firstText(entry.axis, entry.category, entry.type),
    title: text(entry.title),
    problem: firstText(entry.problem, entry.claim, entry.summary, entry.description),
    why: firstText(entry.why, entry.reason, entry.explanation, entry.rationale),
    impact: firstText(entry.impact, entry.consequence, entry.effect),
    evidence: firstText(entry.evidence, entry.proof),
    confidence: number(entry.confidence),
    fix: firstText(entry.fix, entry.recommendation, entry.suggestion, entry.suggested_fix),
    suggestedPatch: firstText(entry.suggested_patch, entry.patch, entry.diff) || null,
    suggestedTest: firstText(entry.suggested_test, entry.test, entry.test_case) || null,
  };
}

export function parseReviewResponse(raw: unknown): ParsedReviewResponse {
  const issues: string[] = [];

  // A provider envelope such as `{ choices: [{ message: { content } }] }` has to
  // be unwrapped before the response is judged malformed. Without this, a
  // perfectly good review is discarded for the crime of being wrapped.
  let direct: unknown = null;
  if (typeof raw === "string") {
    direct = extractJsonObject(raw);
  } else if (isRecord(raw)) {
    direct = raw.findings !== undefined ? raw : extractJsonObject(toResponseText(raw));
  } else if (raw !== null && raw !== undefined) {
    direct = extractJsonObject(toResponseText(raw));
  }

  if (!isRecord(direct)) {
    return { verdict: null, summary: "", candidates: [], issues: ["response was not a JSON object"] };
  }

  const rawFindings = direct.findings;
  const candidates: CandidateFinding[] = [];

  if (rawFindings === undefined) {
    issues.push("response had no findings array");
  } else if (!Array.isArray(rawFindings)) {
    issues.push("findings was not an array");
  } else {
    if (rawFindings.length > MAX_CANDIDATES) {
      issues.push(`findings was truncated from ${rawFindings.length} to ${MAX_CANDIDATES}`);
    }
    for (const entry of rawFindings.slice(0, MAX_CANDIDATES)) {
      const mapped = toCandidate(entry);
      if (mapped === null) {
        issues.push("a finding entry was dropped because it had no usable file or line");
        continue;
      }
      candidates.push(mapped);
    }
  }

  const verdictText = text(direct.verdict).trim().toLowerCase();
  const verdict =
    verdictText === "approve" || verdictText === "needs-attention"
      ? (verdictText as ParsedReviewResponse["verdict"])
      : null;

  const summary = text(direct.summary).trim().slice(0, MAX_SUMMARY_LENGTH);

  return { verdict, summary, candidates, issues };
}

/** Removes any supplied secret from text before it can reach a log or a message. */
export function redactSecrets(input: string, secrets: readonly string[]): string {
  let output = input;
  for (const secret of secrets) {
    if (secret.length < 6) continue;
    output = output.split(secret).join("[redacted]");
  }
  return output;
}

export class AiReviewerError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "AiReviewerError";
    this.status = status;
  }
}

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
 * A chat-completions reviewer.
 *
 * Low temperature is not a stylistic choice: reviewing the same file twice and
 * getting different findings makes the output untrustworthy, and determinism is
 * what lets fixtures assert on results.
 *
 * Retries exist because a provider that is briefly rate limiting is not a
 * review outcome. Only statuses that can plausibly succeed on a repeat are
 * retried, the provider's own `Retry-After` wins over the computed backoff, and
 * a cancellation always beats a pending retry.
 */
export function createHttpAiReviewer(options: HttpAiReviewerOptions): AiReviewerPort {
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

  async function attempt(request: AiReviewRequest): Promise<unknown> {
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
      if (options.signal?.aborted === true) throw new AiReviewerError("provider request was cancelled");

      const detail = error instanceof Error ? error.name : "unknown error";
      throw new AttemptFailure(`provider request failed: ${detail}`, null, true);
    } finally {
      link.dispose();
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const safeBody = redactSecrets(body, [options.apiKey]).replace(/\s+/g, " ").slice(0, MAX_ERROR_BODY_LENGTH);
      const status = response.status;
      throw new AttemptFailure(
        `provider returned ${status}: ${safeBody}`,
        status,
        RETRYABLE_STATUSES.has(status),
        retryAfterMs(response),
      );
    }

    try {
      return await response.json();
    } catch {
      throw new AiReviewerError("provider response was not valid JSON");
    }
  }

  return {
    name: `http:${parsed.host}`,
    async review(request: AiReviewRequest): Promise<unknown> {
      let lastFailure: AttemptFailure | null = null;

      for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
        if (options.signal?.aborted === true) throw new AiReviewerError("provider request was cancelled");

        try {
          return await attempt(request);
        } catch (error) {
          // Anything that is not a marked attempt failure is a decision, not a
          // transport hiccup: an unparseable body and a cancellation both pass
          // straight through.
          if (!(error instanceof AttemptFailure) || !error.retryable || attemptNumber === maxAttempts) throw error;

          lastFailure = error;
          const backoff = Math.min(MAX_RETRY_DELAY_MS, retryDelayMs * 2 ** (attemptNumber - 1));
          const delayMs = error.retryAfterMs ?? backoff;
          options.onRetry?.({ attempt: attemptNumber, status: error.status, delayMs });
          await sleep(delayMs, options.signal ?? new AbortController().signal);
        }
      }

      throw lastFailure ?? new AiReviewerError("provider request failed");
    },
  };
}

/** A reviewer that returns a fixed response. Used by tests and offline runs. */
export function createStaticAiReviewer(response: unknown, name = "static"): AiReviewerPort {
  return {
    name,
    review: async () => response,
  };
}
