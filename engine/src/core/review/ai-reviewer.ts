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
 *
 * The request side is not here. Fetching a model's answer is an outbound adapter,
 * so it lives in `src/clients/http-ai-reviewer.ts`, where the network belongs.
 */

import type { AiReviewOutcome } from "../findings/model.ts";
import type { CandidateFinding } from "../findings/validate.ts";
import type { AiReviewerPort } from "../ports.ts";

/**
 * The shape a response actually had, recorded independently of the wording of
 * `issues`. Sorting a response by its shape rather than by message text is what
 * keeps the outcome stable when a message is reworded.
 */
export type ReviewResponseShape = "review" | "no-findings-array" | "findings-not-array" | "not-an-object";

export interface ParsedReviewResponse {
  verdict: "approve" | "needs-attention" | null;
  /** Bounded, single-paragraph summary. Empty when the model omitted it. */
  summary: string;
  candidates: CandidateFinding[];
  /** Shape problems worth logging. Never contains raw model prose. */
  issues: string[];
  shape: ReviewResponseShape;
  /** Entries the parser saw but could not turn into a candidate. */
  entriesDropped: number;
  /** Which response field the text that was parsed came from. */
  answerField: ReviewAnswerField;
}

/** Where the text worth parsing was found. */
export type ReviewAnswerField = "content" | "reasoning-content" | "none";

/** A response larger than this is not worth parsing and is almost certainly noise. */
const MAX_SUMMARY_LENGTH = 2000;
const MAX_CANDIDATES = 200;

export function isRecord(value: unknown): value is Record<string, unknown> {
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

interface ResponseText {
  text: string;
  field: ReviewAnswerField;
}

/**
 * Normalises whatever the port returned into a string worth parsing, and says
 * which field it came from.
 *
 * The preference order is fixed and load-bearing: an answer the provider labelled
 * `content` always wins, so a chain of thought can never displace a real answer.
 * `reasoning_content` is read only when `content` is absent, because a provider
 * route used live delivers the whole review in that field with `content: null`;
 * refusing to read it would report a parse failure for an answer that is there.
 * Which field was read is recorded, so a trace never implies the wrong one.
 */
function toResponseText(raw: unknown): ResponseText {
  if (typeof raw === "string") return { text: raw, field: "content" };
  if (!isRecord(raw)) return { text: "", field: "none" };

  // OpenAI-compatible shape first, then the common alternatives.
  const choices = raw.choices;
  if (Array.isArray(choices)) {
    const first = choices[0];
    if (isRecord(first)) {
      const message = first.message;
      if (isRecord(message)) {
        const content = text(message.content);
        if (content !== "") return { text: content, field: "content" };

        const reasoning = text(message.reasoning_content);
        if (reasoning !== "") return { text: reasoning, field: "reasoning-content" };
      }
      const choiceText = text(first.text);
      if (choiceText !== "") return { text: choiceText, field: "content" };
    }
  }
  const direct = firstText(raw.content, raw.text, raw.output);
  if (direct !== "") return { text: direct, field: "content" };
  return { text: JSON.stringify(raw), field: "none" };
}

/** The answer text and where it was found, or nothing readable in the response. */
function extractAnswer(raw: unknown): { direct: unknown; field: ReviewAnswerField } {
  if (typeof raw === "string") return { direct: extractJsonObject(raw), field: "content" };

  if (isRecord(raw)) {
    // A response that is already the review object is taken as it is.
    if (raw.findings !== undefined) return { direct: raw, field: "content" };
    const fromResponse = toResponseText(raw);
    return { direct: extractJsonObject(fromResponse.text), field: fromResponse.field };
  }

  if (raw !== null && raw !== undefined) {
    const fromResponse = toResponseText(raw);
    return { direct: extractJsonObject(fromResponse.text), field: fromResponse.field };
  }

  return { direct: null, field: "none" };
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
  const { direct, field } = extractAnswer(raw);
  if (field === "reasoning-content") {
    issues.push("the answer arrived in reasoning_content because content was absent");
  }

  if (!isRecord(direct)) {
    return {
      verdict: null,
      summary: "",
      candidates: [],
      issues: [...issues, "response was not a JSON object"],
      shape: "not-an-object",
      entriesDropped: 0,
      answerField: field,
    };
  }

  const rawFindings = direct.findings;
  const candidates: CandidateFinding[] = [];
  let entriesDropped = 0;
  let shape: ReviewResponseShape = "review";

  if (rawFindings === undefined) {
    shape = "no-findings-array";
    issues.push("response had no findings array");
  } else if (!Array.isArray(rawFindings)) {
    shape = "findings-not-array";
    issues.push("findings was not an array");
  } else {
    if (rawFindings.length > MAX_CANDIDATES) {
      issues.push(`findings was truncated from ${rawFindings.length} to ${MAX_CANDIDATES}`);
    }
    for (const entry of rawFindings.slice(0, MAX_CANDIDATES)) {
      const mapped = toCandidate(entry);
      if (mapped === null) {
        entriesDropped += 1;
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

  return { verdict, summary, candidates, issues, shape, entriesDropped, answerField: field };
}

/**
 * Reads a parsed response as an outcome.
 *
 * The distinction that matters is between `{"findings": []}` and a response with
 * nothing readable in it. The first is the model reporting clean code, which is
 * a real answer. The second is a response that could not be read, and treating
 * it as clean code is exactly how a broken model call becomes a false all-clear.
 */
export function classifyReviewResponse(parsed: ParsedReviewResponse): AiReviewOutcome {
  if (parsed.shape !== "review") return "invalid";
  if (parsed.entriesDropped > 0) return "partial";
  if (parsed.candidates.length === 0) return "empty";
  return "valid";
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

/** A reviewer that returns a fixed response. Used by tests and offline runs. */
export function createStaticAiReviewer(response: unknown, name = "static"): AiReviewerPort {
  return {
    name,
    review: async () => response,
  };
}
