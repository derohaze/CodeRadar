/**
 * The settings store, and the two rules that keep it safe.
 *
 * The settings file is hand-editable and is the only place an API key is held at
 * rest, so the interesting cases are the hostile ones: a value that was never
 * meant to be accepted, and a key on a machine that cannot encrypt it.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSettingsStore, type SettingsStore } from "../src/node/settings.ts";
import { createLocalKeyCipher } from "../src/node/local-cipher.ts";
import type { KeyCipher, KeyProtection } from "../src/node/key-cipher.ts";

let directory: string;

/** A stand-in keychain, so the key path can be tested without Electron. */
function stubCipher(protection: KeyProtection = { available: true, level: "os" }): KeyCipher {
  return {
    protection: () => protection,
    encrypt: (plaintext) => Buffer.from(plaintext, "utf8").toString("base64"),
    decrypt: (payload) => Buffer.from(payload, "base64").toString("utf8"),
  };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "coderadar-settings-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function storeWith(cipher?: KeyCipher): SettingsStore {
  return createSettingsStore({
    filePath: path.join(directory, "settings.json"),
    ...(cipher === undefined ? {} : { cipher }),
  });
}

describe("settings store", () => {
  it("starts from a usable default provider", async () => {
    const settings = await storeWith().read();

    expect(settings.provider.id).toBe("nvidia");
    expect(settings.provider.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(settings.provider.hasApiKey).toBe(false);
    expect(settings.defaults.maxFindings).toBe(15);
    expect(settings.desktop.theme).toBe("system");
  });

  it("clamps a hand-edited value instead of trusting it", async () => {
    await writeFile(
      path.join(directory, "settings.json"),
      JSON.stringify({
        provider: { id: "nvidia", baseUrl: "https://integrate.api.nvidia.com/v1", model: "m", timeoutMs: 1, maxOutputTokens: 10 ** 9 },
        defaults: { maxFindings: 0, maxAiFiles: 10 ** 6 },
        desktop: { remediationMaxAttempts: 999, theme: "chartreuse" },
      }),
      "utf8",
    );

    const settings = await storeWith().read();

    // A 1 ms timeout is not a configuration the app should ever attempt.
    expect(settings.provider.timeoutMs).toBe(5_000);
    expect(settings.provider.maxOutputTokens).toBe(32_768);
    expect(settings.defaults.maxFindings).toBe(1);
    expect(settings.defaults.maxAiFiles).toBe(500);
    expect(settings.desktop.remediationMaxAttempts).toBe(10);
    expect(settings.desktop.theme).toBe("system");
  });

  it("refuses to store a key when the platform cannot encrypt one", async () => {
    const store = storeWith();

    await expect(store.update({ apiKey: "sk-plaintext" })).rejects.toThrow("no secure key store");
    // Nothing was written, so no plaintext key is left behind.
    await expect(readFile(store.filePath, "utf8")).rejects.toThrow();
    expect(await store.resolveProvider()).toBeNull();
    expect(await store.explainUnusable()).toBe("This system has no secure key store available.");
  });

  it("stores a key encrypted and never returns it in plain text", async () => {
    const store = storeWith(stubCipher());
    const settings = await store.update({ apiKey: "sk-abcdefghijkl" });

    expect(settings.provider.hasApiKey).toBe(true);
    expect(settings.provider.apiKeyHint).toBe("ijkl");

    const onDisk = await readFile(store.filePath, "utf8");
    expect(onDisk).not.toContain("sk-abcdefghijkl");

    const resolved = await store.resolveProvider();
    expect(resolved?.apiKey).toBe("sk-abcdefghijkl");
    expect(resolved?.providerName).toBe("NVIDIA");
  });

  it("drops a key that this machine can no longer decrypt", async () => {
    const stored = await storeWith(stubCipher()).update({ apiKey: "sk-abcdefghijkl" });
    expect(stored.provider.hasApiKey).toBe(true);

    // Same file, no cipher: the key is unusable here, so it must not be reported
    // as present.
    const settings = await storeWith().read();
    expect(settings.provider.hasApiKey).toBe(false);
    expect(settings.provider.apiKeyHint).toBeNull();
  });

  it("carries the new provider's endpoint and model when the provider changes", async () => {
    const store = storeWith(stubCipher());
    await store.update({ provider: { id: "nvidia", model: "openai/gpt-oss-120b" } });

    const settings = await store.update({ provider: { id: "deepseek" } });

    // Keeping NVIDIA's model here would send a DeepSeek key to a model DeepSeek
    // has never heard of, so the switch replaces both.
    expect(settings.provider.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(settings.provider.model).toBe("");
  });

  it("keeps caller-supplied values when the provider changes with them", async () => {
    const store = storeWith(stubCipher());

    const settings = await store.update({ provider: { id: "custom", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3" } });

    expect(settings.provider.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(settings.provider.model).toBe("llama3");
  });

  it("refuses a base URL that would leak the key over plain http", async () => {
    const store = storeWith(stubCipher());

    await expect(store.update({ provider: { id: "custom", baseUrl: "http://api.example.com/v1", model: "m" } })).rejects.toThrow(
      "must use https",
    );
  });

  it("refuses a base URL pointed at a cloud metadata address", async () => {
    const store = storeWith(stubCipher());

    await expect(
      store.update({ provider: { id: "custom", baseUrl: "http://169.254.169.254/v1", model: "m" } }),
    ).rejects.toThrow();
  });

  it("allows a local model server over plain http", async () => {
    const store = storeWith(stubCipher());

    const settings = await store.update({ provider: { id: "custom", baseUrl: "http://localhost:11434/v1", model: "llama3" } });

    expect(settings.provider.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("refuses a provider id it does not know", async () => {
    const store = storeWith(stubCipher());

    await expect(store.update({ provider: { id: "not-a-provider" } })).rejects.toThrow("Unknown provider");
  });

  it("persists desktop preferences across a reload", async () => {
    const store = storeWith(stubCipher());
    await store.update({ desktop: { theme: "dark", motionProfile: "reduced", autoOpenResults: false } });

    const reloaded = await storeWith(stubCipher()).read();

    expect(reloaded.desktop.theme).toBe("dark");
    expect(reloaded.desktop.motionProfile).toBe("reduced");
    expect(reloaded.desktop.autoOpenResults).toBe(false);
    // Fields the caller did not send keep their previous value.
    expect(reloaded.desktop.rememberSidebarState).toBe(true);
  });

  it("clears a stored key when the patch asks for it", async () => {
    const store = storeWith(stubCipher());
    await store.update({ apiKey: "sk-abcdefghijkl" });

    const cleared = await store.update({ apiKey: null });

    expect(cleared.provider.hasApiKey).toBe(false);
  });

  it("round-trips a key through the standalone cipher", async () => {
    // The standalone server has no OS keychain, so this is the only thing
    // standing between the key and a plaintext file on disk.
    const cipher = createLocalKeyCipher({ keyPath: path.join(directory, "local-key") });
    expect(cipher.protection()).toEqual({ available: true, level: "basic" });

    const payload = cipher.encrypt("sk-abcdefghijkl");
    expect(payload).not.toContain("sk-abcdefghijkl");
    expect(cipher.decrypt(payload)).toBe("sk-abcdefghijkl");

    // Two encryptions of the same key must differ, or the format leaks that the
    // key did not change.
    expect(cipher.encrypt("sk-abcdefghijkl")).not.toBe(payload);

    const store = storeWith(cipher);
    await store.update({ apiKey: "sk-abcdefghijkl" });
    expect((await storeWith(createLocalKeyCipher({ keyPath: path.join(directory, "local-key") })).resolveProvider())?.apiKey).toBe(
      "sk-abcdefghijkl",
    );
  });

  it("refuses to decrypt a payload that was tampered with", async () => {
    const cipher = createLocalKeyCipher({ keyPath: path.join(directory, "local-key") });
    const raw = Buffer.from(cipher.encrypt("sk-abcdefghijkl"), "base64");
    // Flip a ciphertext bit: GCM must notice rather than return garbage.
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 0x01;

    expect(() => cipher.decrypt(raw.toString("base64"))).toThrow();
  });

  it("reports no protection when the key cannot be written", async () => {
    // A directory occupying the key path makes both reading and writing it fail,
    // which is the closest portable stand-in for a home directory that cannot
    // hold the key. The cipher must report `none` so the settings store refuses
    // to save, rather than falling back to plaintext.
    const keyPath = path.join(directory, "occupied");
    await mkdir(keyPath);

    const cipher = createLocalKeyCipher({ keyPath });
    expect(cipher.protection()).toEqual({ available: false, level: "none" });
    await expect(storeWith(cipher).update({ apiKey: "sk-abcdefghijkl" })).rejects.toThrow("no secure key store");
  });

  it("writes the settings file with owner-only permissions", async () => {
    const store = storeWith(stubCipher());
    await store.update({ apiKey: "sk-abcdefghijkl" });

    const { mode } = await import("node:fs/promises").then((fs) => fs.stat(store.filePath));
    // Windows does not model POSIX permission bits; the mode is enforced by the
    // write call there. Assert it only where the platform reports it.
    if (process.platform !== "win32") {
      expect(mode & 0o077).toBe(0);
    }
  });
});
