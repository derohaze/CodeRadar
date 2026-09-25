/**
 * Persisted desktop settings.
 *
 * One JSON file holds everything the app needs to run a review: which provider,
 * which model, how many findings to keep, and the API key. It is read once and
 * cached, because every review reads it and the file is on disk.
 *
 * Two rules are load-bearing:
 *
 * - Values are clamped on the way in, never on the way out. A settings file that
 *   was hand-edited or written by an older build cannot produce a 0 ms timeout or
 *   a 100,000-finding cap, because parsing is the only way a value enters the
 *   store.
 * - The API key is only persisted when the platform gave us something to encrypt
 *   it with. If the key store disappears (a different machine, a headless run),
 *   the stored key is dropped rather than decrypted into plaintext, and the
 *   review continues with the deterministic checks.
 *
 * The shape on disk is versioned so a future change can be migrated instead of
 * guessed at.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KeyCipher, KeyProtection } from "./key-cipher.ts";
import { DEFAULT_PROVIDER_ID, providerById } from "./provider-catalog.ts";
import { assertAllowedOutboundUrl } from "./outbound-url.ts";

export const SETTINGS_VERSION = 1;

const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
const MIN_MAX_OUTPUT_TOKENS = 256;
const MAX_MAX_OUTPUT_TOKENS = 32_768;
const DEFAULT_MAX_FINDINGS = 15;
const MAX_MAX_FINDINGS = 100;
const DEFAULT_MAX_AI_FILES = 40;
const MAX_MAX_AI_FILES = 500;

/** Owner-only, because the file may hold an encrypted API key. */
const SETTINGS_FILE_MODE = 0o600;

const NO_CIPHER: KeyProtection = { available: false, level: "none" };

export interface ProviderSettings {
  id: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface ReviewDefaults {
  useAi: boolean;
  changedOnly: boolean;
  maxFindings: number;
  maxAiFiles: number;
  baseBranch: string | null;
}

/**
 * Desktop preferences: the choices the Settings screen owns.
 *
 * They are persisted with the review settings rather than in the renderer's
 * `localStorage`, because a preference the user deliberately changed has to
 * survive a relaunch and a reinstall, and because a PATCH that is accepted and
 * then forgotten is worse than one that is refused.
 */
export interface DesktopPreferences {
  defaultPreset: "safe" | "balanced" | "aggressive";
  defaultScanMode: "fast" | "deep";
  autoOpenResults: boolean;
  rememberSidebarState: boolean;
  motionProfile: "fluid" | "reduced" | "instant";
  theme: "light" | "dark" | "system";
  surfaceContrast: "soft" | "standard";
  remediationMaxAttempts: number;
  remediationReuseExplanation: boolean;
}

export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  defaultPreset: "balanced",
  defaultScanMode: "deep",
  autoOpenResults: true,
  rememberSidebarState: true,
  motionProfile: "fluid",
  theme: "system",
  surfaceContrast: "soft",
  remediationMaxAttempts: 3,
  remediationReuseExplanation: true,
};

/** How the key is stored. `cipher` names the scheme so the format can change. */
interface StoredApiKey {
  cipher: "os" | "basic";
  payload: string;
}

interface StoredSettings {
  version: number;
  provider: ProviderSettings;
  apiKey: StoredApiKey | null;
  defaults: ReviewDefaults;
  desktop: DesktopPreferences;
}

/** The provider as the renderer may see it: never the key itself. */
export interface PublicProviderSettings extends ProviderSettings {
  hasApiKey: boolean;
  /** Last four characters, enough to tell two keys apart, useless on its own. */
  apiKeyHint: string | null;
}

export interface PublicSettings {
  provider: PublicProviderSettings;
  defaults: ReviewDefaults;
  desktop: DesktopPreferences;
  keyProtection: KeyProtection;
}

/** The provider as the review engine needs it: with the decrypted key. */
export interface ResolvedProvider extends ProviderSettings {
  apiKey: string;
  providerName: string;
}

export interface SettingsPatch {
  provider?: Partial<ProviderSettings>;
  defaults?: Partial<ReviewDefaults>;
  desktop?: Partial<DesktopPreferences>;
  /** `null` or an empty string clears the stored key. */
  apiKey?: string | null;
}

export interface SettingsStore {
  readonly filePath: string;
  read(): Promise<PublicSettings>;
  /** The provider with its key, or null when the configuration is unusable. */
  resolveProvider(): Promise<ResolvedProvider | null>;
  update(patch: SettingsPatch): Promise<PublicSettings>;
  /** Why no provider is usable, in a sentence for the settings screen. */
  explainUnusable(): Promise<string | null>;
}

export interface SettingsStoreOptions {
  filePath: string;
  /** Omitted in a headless run, which makes every key save an honest refusal. */
  cipher?: KeyCipher | undefined;
}

export const DEFAULT_REVIEW_DEFAULTS: ReviewDefaults = {
  useAi: true,
  changedOnly: false,
  maxFindings: DEFAULT_MAX_FINDINGS,
  maxAiFiles: DEFAULT_MAX_AI_FILES,
  baseBranch: null,
};

export function defaultProviderConfig(providerId: string = DEFAULT_PROVIDER_ID): ProviderSettings {
  const provider = providerById(providerId);
  return {
    id: provider?.id ?? DEFAULT_PROVIDER_ID,
    baseUrl: provider?.defaultBaseUrl ?? "",
    model: provider?.defaultModel ?? "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** An enum read from disk or a request body, falling back to the default. */
function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function parseDesktop(value: unknown): DesktopPreferences {
  if (!isRecord(value)) return { ...DEFAULT_DESKTOP_PREFERENCES };
  const base = DEFAULT_DESKTOP_PREFERENCES;

  return {
    defaultPreset: readEnum(value["defaultPreset"], ["safe", "balanced", "aggressive"] as const, base.defaultPreset),
    defaultScanMode: readEnum(value["defaultScanMode"], ["fast", "deep"] as const, base.defaultScanMode),
    autoOpenResults: readBoolean(value["autoOpenResults"], base.autoOpenResults),
    rememberSidebarState: readBoolean(value["rememberSidebarState"], base.rememberSidebarState),
    motionProfile: readEnum(value["motionProfile"], ["fluid", "reduced", "instant"] as const, base.motionProfile),
    theme: readEnum(value["theme"], ["light", "dark", "system"] as const, base.theme),
    surfaceContrast: readEnum(value["surfaceContrast"], ["soft", "standard"] as const, base.surfaceContrast),
    remediationMaxAttempts: readInteger(value["remediationMaxAttempts"], base.remediationMaxAttempts, 1, 10),
    remediationReuseExplanation: readBoolean(value["remediationReuseExplanation"], base.remediationReuseExplanation),
  };
}

function parseProvider(value: unknown): ProviderSettings {
  if (!isRecord(value)) return defaultProviderConfig();

  const id = providerById(readString(value["id"], DEFAULT_PROVIDER_ID))?.id ?? DEFAULT_PROVIDER_ID;
  const base = defaultProviderConfig(id);
  return {
    id,
    baseUrl: readString(value["baseUrl"], base.baseUrl),
    model: readString(value["model"], base.model),
    timeoutMs: readInteger(value["timeoutMs"], DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxOutputTokens: readInteger(
      value["maxOutputTokens"],
      DEFAULT_MAX_OUTPUT_TOKENS,
      MIN_MAX_OUTPUT_TOKENS,
      MAX_MAX_OUTPUT_TOKENS,
    ),
  };
}

function parseDefaults(value: unknown): ReviewDefaults {
  if (!isRecord(value)) return { ...DEFAULT_REVIEW_DEFAULTS };
  return {
    useAi: readBoolean(value["useAi"], DEFAULT_REVIEW_DEFAULTS.useAi),
    changedOnly: readBoolean(value["changedOnly"], DEFAULT_REVIEW_DEFAULTS.changedOnly),
    maxFindings: readInteger(value["maxFindings"], DEFAULT_MAX_FINDINGS, 1, MAX_MAX_FINDINGS),
    maxAiFiles: readInteger(value["maxAiFiles"], DEFAULT_MAX_AI_FILES, 0, MAX_MAX_AI_FILES),
    baseBranch: readNullableString(value["baseBranch"]),
  };
}

function parseApiKey(value: unknown): StoredApiKey | null {
  if (!isRecord(value)) return null;
  const cipher = value["cipher"];
  const payload = value["payload"];
  if (cipher !== "os" && cipher !== "basic") return null;
  if (typeof payload !== "string" || payload === "") return null;
  return { cipher, payload };
}

/** A four-character hint, or nothing when the key is too short to hint at. */
function hintFor(apiKey: string): string | null {
  if (apiKey.length < 8) return null;
  return apiKey.slice(-4);
}

function validateProviderConfig(config: ProviderSettings): void {
  const provider = providerById(config.id);
  if (provider === null) throw new Error(`Unknown provider "${config.id}".`);
  assertAllowedOutboundUrl(config.baseUrl);
}

function validatePatch(patch: SettingsPatch): void {
  const provider = patch.provider;
  if (provider === undefined) return;

  if (provider.id !== undefined && providerById(provider.id) === null) {
    throw new Error(`Unknown provider "${provider.id}".`);
  }
  if (provider.baseUrl !== undefined) assertAllowedOutboundUrl(provider.baseUrl);
  if (provider.model !== undefined && provider.model.trim() === "") {
    throw new Error("A model name is required.");
  }
  if (provider.timeoutMs !== undefined && (provider.timeoutMs < MIN_TIMEOUT_MS || provider.timeoutMs > MAX_TIMEOUT_MS)) {
    throw new Error(`Timeout must be between ${MIN_TIMEOUT_MS / 1000} and ${MAX_TIMEOUT_MS / 1000} seconds.`);
  }
}

export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  const { filePath } = options;
  const cipher = options.cipher;
  let cached: StoredSettings | null = null;

  const protection = (): KeyProtection => cipher?.protection() ?? NO_CIPHER;

  async function load(): Promise<StoredSettings> {
    if (cached !== null) return cached;

    let raw: unknown = null;
    try {
      raw = JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      // A missing or unreadable file is the first-run case, not an error.
      raw = null;
    }

    const record = isRecord(raw) ? raw : {};
    const stored: StoredSettings = {
      version: SETTINGS_VERSION,
      provider: parseProvider(record["provider"]),
      apiKey: parseApiKey(record["apiKey"]),
      defaults: parseDefaults(record["defaults"]),
      desktop: parseDesktop(record["desktop"]),
    };

    // A key that cannot be decrypted on this machine is not a key. Dropping it
    // here keeps the rest of the code free of "maybe encrypted" branches.
    if (stored.apiKey !== null && (cipher === undefined || !protection().available)) {
      stored.apiKey = null;
    }

    cached = stored;
    return stored;
  }

  async function persist(stored: StoredSettings): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    // Write-then-rename: a crash mid-write leaves the previous file intact
    // rather than a half-written one that fails to parse on next launch.
    await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", mode: SETTINGS_FILE_MODE });
    await rename(temporary, filePath);
  }

  function readApiKey(stored: StoredSettings): string | null {
    let apiKey: string | null = null;
    if (stored.apiKey !== null && cipher !== undefined) {
      try {
        apiKey = cipher.decrypt(stored.apiKey.payload);
      } catch {
        apiKey = null;
      }
    }
    return apiKey === "" ? null : apiKey;
  }

  function resolve(stored: StoredSettings): ResolvedProvider | null {
    if (stored.apiKey === null || cipher === undefined) return null;
    if (stored.provider.model.trim() === "") return null;

    const apiKey = readApiKey(stored);
    if (apiKey === null) return null;

    return {
      ...stored.provider,
      apiKey,
      providerName: providerById(stored.provider.id)?.name ?? stored.provider.id,
    };
  }

  function toPublic(stored: StoredSettings): PublicSettings {
    const apiKey = readApiKey(stored);
    return {
      provider: {
        ...stored.provider,
        hasApiKey: apiKey !== null,
        apiKeyHint: apiKey === null ? null : hintFor(apiKey),
      },
      defaults: stored.defaults,
      desktop: stored.desktop,
      keyProtection: protection(),
    };
  }

  return {
    filePath,

    async read(): Promise<PublicSettings> {
      return toPublic(await load());
    },

    async resolveProvider(): Promise<ResolvedProvider | null> {
      return resolve(await load());
    },

    async update(patch: SettingsPatch): Promise<PublicSettings> {
      validatePatch(patch);
      const stored = await load();

      if (patch.provider !== undefined) {
        const previous = stored.provider;
        const next: ProviderSettings = {
          id: patch.provider.id ?? previous.id,
          baseUrl: patch.provider.baseUrl ?? previous.baseUrl,
          model: patch.provider.model ?? previous.model,
          timeoutMs: patch.provider.timeoutMs ?? previous.timeoutMs,
          maxOutputTokens: patch.provider.maxOutputTokens ?? previous.maxOutputTokens,
        };

        // Switching provider carries the new provider's endpoint and model with
        // it, unless the caller set them explicitly. Keeping the old URL would
        // send one provider's key to another provider's host.
        if (patch.provider.id !== undefined && patch.provider.id !== previous.id) {
          const target = defaultProviderConfig(patch.provider.id);
          if (patch.provider.baseUrl === undefined) next.baseUrl = target.baseUrl;
          if (patch.provider.model === undefined) next.model = target.model;
        }

        validateProviderConfig(next);
        stored.provider = next;
      }

      if (patch.defaults !== undefined) {
        stored.defaults = parseDefaults({ ...stored.defaults, ...patch.defaults });
      }

      if (patch.desktop !== undefined) {
        stored.desktop = parseDesktop({ ...stored.desktop, ...patch.desktop });
      }

      if (patch.apiKey !== undefined) {
        if (patch.apiKey === null || patch.apiKey.trim() === "") {
          stored.apiKey = null;
        } else if (cipher === undefined || !protection().available) {
          throw new Error(
            "This system has no secure key store available, so the API key was not saved. The review still runs with the deterministic checks.",
          );
        } else {
          const trimmed = patch.apiKey.trim();
          stored.apiKey = {
            cipher: protection().level === "basic" ? "basic" : "os",
            payload: cipher.encrypt(trimmed),
          };
        }
      }

      await persist(stored);
      cached = stored;
      return toPublic(stored);
    },

    async explainUnusable(): Promise<string | null> {
      const stored = await load();
      if (stored.provider.model.trim() === "") return "No model is selected in Settings.";
      if (cipher === undefined || !protection().available) return "This system has no secure key store available.";
      if (stored.apiKey === null) return "No API key is saved in Settings.";
      try {
        return resolve(stored) === null ? "The saved API key could not be read." : null;
      } catch (error) {
        return error instanceof Error ? error.message : "The provider configuration is unusable.";
      }
    },
  };
}
