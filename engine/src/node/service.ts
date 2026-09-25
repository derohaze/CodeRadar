/**
 * The review service: one review at a time, driven by the persisted settings.
 *
 * This is the seam between the transport (IPC or HTTP) and the engine. It owns
 * the three pieces of state a transport must not own itself:
 *
 * - Which review is in flight, so a second request is refused instead of
 *   running two reviews over the same folder.
 * - The cancellation signal, so "Stop" aborts the model call rather than only
 *   hiding the progress screen.
 * - The path base of the last review, so opening a finding's source cannot be
 *   pointed at an arbitrary directory by a crafted request.
 *
 * A missing or unusable provider degrades the review to the deterministic
 * detectors and reports why. It never fails the review, because "no API key" is
 * a configuration state, not a review outcome.
 */

import path from "node:path";
import { createNodeFileSystem } from "../adapters/node-fs.ts";
import { createNodeGit } from "../adapters/node-git.ts";
import { AiReviewerError, createHttpAiReviewer } from "../core/review/ai-reviewer.ts";
import { ReviewEngine } from "../core/review/engine.ts";
import type { ReviewReport } from "../core/findings/model.ts";
import type { AiReviewerPort, FileSystemPort, GitPort, ReviewEvent, ReviewEventSink } from "../core/ports.ts";
import { chatCompletionsUrl, providerById, PROVIDERS, requireCompatibleProvider } from "./provider-catalog.ts";
import { listModels, testProvider } from "./provider-client.ts";
import type { ProviderConnection, ProviderModel, ProviderTestResult } from "./provider-client.ts";
import { readSourceWindow } from "./source-window.ts";
import type { SourceWindow } from "./source-window.ts";
import type { PublicSettings, SettingsPatch, SettingsStore } from "./settings.ts";

/** How many times a review retries a provider that is briefly unavailable. */
const REVIEW_MAX_ATTEMPTS = 3;
const REVIEW_RETRY_DELAY_MS = 1_000;

export class ReviewCancelledError extends Error {
  constructor() {
    super("The review was cancelled.");
    this.name = "ReviewCancelledError";
  }
}

/**
 * A provider as the Settings screen currently has it, before it is saved.
 *
 * The screen asks the user to paste a key, test it, and only then save, so a
 * test that could only ever see the stored configuration would be testing the
 * wrong thing.
 */
export interface ProviderOverrides {
  provider?: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
  model?: string | null;
}

/** Either a connection to try, or the reason there is nothing to try. */
type ProviderTarget = { ok: true; connection: ProviderConnection } | { ok: false; reason: string };

export interface ReviewServiceRequest {
  /** Absolute path to the file or folder to review. */
  target: string;
  useAi?: boolean;
  changedOnly?: boolean;
  baseBranch?: string | null;
  maxFindings?: number;
}

export interface ReviewServiceResult {
  report: ReviewReport;
  /** True when the deterministic checks ran alone. */
  aiSkipped: boolean;
}

export interface SourceWindowRequest {
  file: string;
  line: number;
  lineEnd: number;
  context?: number;
}

export interface ReviewService {
  providers(): typeof PROVIDERS;
  settings(): Promise<PublicSettings>;
  updateSettings(patch: SettingsPatch): Promise<PublicSettings>;
  listModels(overrides?: ProviderOverrides): Promise<ProviderModel[]>;
  testProvider(overrides?: ProviderOverrides): Promise<ProviderTestResult>;
  startReview(request: ReviewServiceRequest, onEvent?: ReviewEventSink): Promise<ReviewServiceResult>;
  cancelReview(): void;
  isRunning(): boolean;
  readSource(request: SourceWindowRequest): Promise<SourceWindow>;
}

export interface ReviewServiceOptions {
  settingsStore: SettingsStore;
  /** Absolute path of the directory holding the prompt markdown. */
  promptsDir: string;
  fs?: FileSystemPort | undefined;
  git?: GitPort | undefined;
}

/** The prompt markdown ships beside the bundle that loads it. */
export function resolvePromptsDir(bundleDirectory: string): string {
  return path.join(bundleDirectory, "prompts");
}

export function createReviewService(options: ReviewServiceOptions): ReviewService {
  const fs = options.fs ?? createNodeFileSystem();
  const git = options.git ?? createNodeGit();

  let running = false;
  let controller: AbortController | null = null;
  let lastPathBase: string | null = null;

  /**
   * Builds the model reviewer, or explains on the event stream why the review is
   * running without one. Returning null is a supported outcome, not a failure.
   */
  async function resolveProviderOrExplain(onEvent: ReviewEventSink | undefined): Promise<AiReviewerPort | null> {
    const provider = await options.settingsStore.resolveProvider();
    if (provider === null) {
      const explanation = await options.settingsStore.explainUnusable();
      onEvent?.({
        type: "ai:failed",
        message: `AI review unavailable${explanation === null ? "" : `: ${explanation}`} — running the deterministic checks only`,
      });
      return null;
    }

    let compatible;
    try {
      compatible = requireCompatibleProvider(provider.id);
    } catch (error) {
      onEvent?.({
        type: "ai:failed",
        message: `${error instanceof Error ? error.message : "The provider is not usable"} — running the deterministic checks only`,
      });
      return null;
    }

    return createHttpAiReviewer({
      endpoint: chatCompletionsUrl(provider.baseUrl),
      apiKey: provider.apiKey,
      model: provider.model,
      timeoutMs: provider.timeoutMs,
      maxOutputTokens: provider.maxOutputTokens,
      ...(controller !== null ? { signal: controller.signal } : {}),
      maxAttempts: REVIEW_MAX_ATTEMPTS,
      retryDelayMs: REVIEW_RETRY_DELAY_MS,
      onRetry: (info) => {
        const seconds = Math.max(1, Math.round(info.delayMs / 1000));
        onEvent?.({
          type: "ai:retry",
          message:
            info.status === 429
              ? `${compatible.name} rate limited this key; retrying in ${seconds}s`
              : `${compatible.name} did not answer cleanly; retrying in ${seconds}s`,
          counts: { attempt: info.attempt, ...(info.status === null ? {} : { status: info.status }) },
        });
      },
    });
  }

  /**
   * What the caller sent wins over what is stored, so Settings can test a key it
   * has not saved yet. An omitted field falls back to the stored configuration
   * only when it belongs to the same provider: another provider's endpoint or
   * model would send the key somewhere it was never meant to go.
   */
  async function resolveProviderTarget(overrides: ProviderOverrides | undefined): Promise<ProviderTarget> {
    const stored = await options.settingsStore.resolveProvider();
    const requestedId = overrides?.provider ?? stored?.id ?? null;

    if (requestedId === null) {
      return {
        ok: false,
        reason: (await options.settingsStore.explainUnusable()) ?? "No provider is selected in Settings.",
      };
    }

    const definition = providerById(requestedId);
    if (definition === null) {
      return { ok: false, reason: `Unknown provider "${requestedId}". Pick one in Settings.` };
    }
    if (!definition.openAiCompatible) {
      return {
        ok: false,
        reason: `${definition.name} is not wired into the review engine yet. Configure NVIDIA or another OpenAI-compatible provider in Settings.`,
      };
    }

    const sameProviderStored = stored !== null && stored.id === definition.id;
    const apiKey = overrides?.apiKey ?? (sameProviderStored ? stored.apiKey : null);
    if (apiKey === null || apiKey.trim() === "") {
      return { ok: false, reason: "No API key is saved in Settings." };
    }

    const baseUrl = overrides?.baseUrl ?? (sameProviderStored ? stored.baseUrl : "");
    if (baseUrl.trim() === "") {
      return { ok: false, reason: `${definition.name} needs a base URL before it can be used.` };
    }

    return {
      ok: true,
      connection: {
        id: definition.id,
        baseUrl,
        model: overrides?.model ?? (sameProviderStored ? stored.model : ""),
        apiKey: apiKey.trim(),
      },
    };
  }

  return {
    providers: () => PROVIDERS,

    settings: () => options.settingsStore.read(),

    updateSettings: (patch) => options.settingsStore.update(patch),

    async listModels(overrides?: ProviderOverrides): Promise<ProviderModel[]> {
      const target = await resolveProviderTarget(overrides);
      if (!target.ok) throw new AiReviewerError(target.reason);
      return listModels(target.connection);
    },

    async testProvider(overrides?: ProviderOverrides): Promise<ProviderTestResult> {
      const target = await resolveProviderTarget(overrides);
      if (!target.ok) return { ok: false, message: target.reason, latencyMs: 0 };
      return testProvider(target.connection);
    },

    async startReview(request: ReviewServiceRequest, onEvent?: ReviewEventSink): Promise<ReviewServiceResult> {
      if (running) throw new Error("A review is already running.");

      controller = new AbortController();

      try {
        // Taken after the guard but before anything can fail. A lock taken before
        // the settings read would be stranded by a read that rejects, and every
        // later review would be refused with 409 for the life of the process.
        running = true;
        const settings = await options.settingsStore.read();
        const wantsAi = request.useAi ?? settings.defaults.useAi;
        const reviewer = wantsAi ? await resolveProviderOrExplain(onEvent) : null;

        const engine = new ReviewEngine({
          fs,
          git,
          promptsDir: options.promptsDir,
          ...(reviewer === null ? {} : { aiReviewer: reviewer }),
          changedOnly: request.changedOnly ?? settings.defaults.changedOnly,
          baseBranch: request.baseBranch ?? settings.defaults.baseBranch ?? undefined,
          maxFindings: request.maxFindings ?? settings.defaults.maxFindings,
          maxAiFiles: settings.defaults.maxAiFiles,
          ...(onEvent === undefined ? {} : { onEvent }),
        });

        const report = await engine.review({ target: request.target });

        // The engine returns normally even when the caller cancelled, so the
        // cancellation is only observable here before the report is published.
        if (controller.signal.aborted) throw new ReviewCancelledError();

        lastPathBase = report.scope.pathBase;
        return { report, aiSkipped: reviewer === null };
      } finally {
        running = false;
        controller = null;
      }
    },

    cancelReview(): void {
      controller?.abort();
    },

    isRunning: () => running,

    async readSource(request: SourceWindowRequest): Promise<SourceWindow> {
      if (lastPathBase === null) {
        throw new Error("No review has run yet, so there is nothing to open.");
      }
      return readSourceWindow(fs, { ...request, pathBase: lastPathBase });
    },
  };
}

export type { ReviewEvent };
