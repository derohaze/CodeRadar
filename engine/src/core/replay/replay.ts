/**
 * Recording and replaying model interactions.
 *
 * A review is only reproducible if the model's answers are. Recording them turns
 * a live run into durable evidence: the same prompts can be replayed later, with
 * no provider, no key, and no network, and the parser, validator, policy and
 * scorer are exercised against exactly the answers a real model gave.
 *
 * Three rules are enforced here:
 *
 * 1. A replay that has no recording fails loudly. Returning nothing would turn a
 *    missing recording into a clean review, which is the failure this harness
 *    exists to make impossible.
 * 2. Only a successful call is recorded. A provider that failed produced no
 *    answer, and recording the absence as an answer would fabricate one.
 * 3. The key is derived from the request. A recording is valid for the prompt
 *    that produced it and for nothing else, so a changed prompt or a changed file
 *    does not silently reuse an answer about different code.
 */

import { emptyAiReviewTelemetry } from "../ports.ts";
import type { AiReviewExecution, AiReviewRequest, AiReviewerPort } from "../ports.ts";

/** Everything a recording is keyed by. Contains no credentials, by construction. */
export interface ReplayKeyInput {
  /** The reviewer's own name, so two providers never share a recording. */
  reviewer: string;
  /** Provider model id, or null when the reviewer does not expose one. */
  model: string | null;
  /**
   * The output cap the request was made with, or null when the caller states none.
   *
   * It is part of the key because it decides how much of an answer exists at all: a
   * response the provider cut off at one cap must not be replayed as the answer to
   * a request that asked for more room.
   */
  maxOutputTokens?: number | null | undefined;
  systemPrompt: string;
  userPrompt: string;
}

export type ReplayKeyFn = (input: ReplayKeyInput) => string;

export interface ReplayArtifact {
  key: string;
  reviewer: string;
  model: string | null;
  /** The raw provider response, exactly as it was received. */
  response: unknown;
  recordedAt: string;
}

export interface ReplayStore {
  read(key: string): Promise<ReplayArtifact | null>;
  write(artifact: ReplayArtifact): Promise<void>;
}

/** Raised when a run asks for a recording that does not exist. */
export class ReplayMissError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(
      `no recorded model response for this request (key ${key}). Record it first, or run without replay: an unrecorded request must not be reported as a review.`,
    );
    this.name = "ReplayMissError";
    this.key = key;
  }
}

/** An in-memory store. Used by tests and by a single-process benchmark run. */
export function createMemoryReplayStore(seed: readonly ReplayArtifact[] = []): ReplayStore {
  const byKey = new Map(seed.map((artifact) => [artifact.key, artifact]));

  return {
    read: async (key) => byKey.get(key) ?? null,
    write: async (artifact) => {
      byKey.set(artifact.key, artifact);
    },
  };
}

interface ReplayReviewerOptions {
  store: ReplayStore;
  keyOf: ReplayKeyFn;
  /**
   * The identity a recording is keyed under.
   *
   * It is explicit rather than inferred so a recording made by one reviewer can
   * be replayed by another object that is configured to answer for it — and so a
   * mismatch is a startup error rather than a run that silently misses.
   */
  reviewerName: string;
  /** Provider model id, recorded with the artifact. */
  model: string | null;
  /** Output cap the recorded requests were made with, when the caller sets one. */
  maxOutputTokens?: number | null | undefined;
}

/**
 * A reviewer that records every answer it receives.
 *
 * The recording is written before the response is returned, so an answer that
 * reached the parser is always on disk for the next replay. A failed call writes
 * nothing at all: a recording is the model's output, not an attempt to obtain it.
 *
 * The telemetry path is forwarded, so a benchmark run that records keeps the call
 * record of the run it recorded. Losing it here would leave exactly the runs that
 * matter most — the recorded live ones — with no trace of what the provider did.
 */
export function createRecordingReviewer(options: ReplayReviewerOptions & { inner: AiReviewerPort }): AiReviewerPort {
  if (options.reviewerName !== options.inner.name) {
    throw new Error(
      `reviewerName (${options.reviewerName}) does not match the inner reviewer (${options.inner.name}); a recording under a different name could never be replayed`,
    );
  }

  async function write(request: AiReviewRequest, response: unknown): Promise<void> {
    await options.store.write({
      key: options.keyOf(keyInputOf(options, request)),
      reviewer: options.reviewerName,
      model: options.model,
      response,
      recordedAt: new Date().toISOString(),
    });
  }

  const withTelemetry = options.inner.reviewWithTelemetry;
  if (withTelemetry === undefined) {
    return {
      name: `record:${options.inner.name}`,
      async review(request: AiReviewRequest): Promise<unknown> {
        const response = await options.inner.review(request);
        await write(request, response);
        return response;
      },
    };
  }

  return {
    name: `record:${options.inner.name}`,
    async review(request: AiReviewRequest): Promise<unknown> {
      const response = await options.inner.review(request);
      await write(request, response);
      return response;
    },
    async reviewWithTelemetry(request: AiReviewRequest): Promise<AiReviewExecution> {
      const execution = await withTelemetry.call(options.inner, request);
      // A failure is not an answer, and writing one would fabricate a recording.
      if (execution.status === "response") await write(request, execution.response);
      return execution;
    },
  };
}

/**
 * A reviewer that answers from recordings only.
 *
 * It holds no provider and never falls back to one: a "replay" that quietly makes
 * live calls is not reproducible, and would hide a missing recording. Its
 * telemetry says so: the model is the one the recording was made under, the
 * provider is unknown because no provider was contacted, and there are no
 * attempts because no call was made.
 */
export function createReplayReviewer(options: ReplayReviewerOptions): AiReviewerPort {
  async function fromRecording(request: AiReviewRequest): Promise<unknown> {
    const key = options.keyOf(keyInputOf(options, request));

    const artifact = await options.store.read(key);
    if (artifact === null) throw new ReplayMissError(key);

    return artifact.response;
  }

  return {
    name: `replay:${options.reviewerName}`,
    review: fromRecording,
    async reviewWithTelemetry(request: AiReviewRequest): Promise<AiReviewExecution> {
      const response = await fromRecording(request);
      return { status: "response", response, telemetry: emptyAiReviewTelemetry(null, options.model) };
    },
  };
}

function keyInputOf(options: ReplayReviewerOptions, request: AiReviewRequest): ReplayKeyInput {
  return {
    reviewer: options.reviewerName,
    model: options.model,
    maxOutputTokens: options.maxOutputTokens ?? null,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
  };
}
