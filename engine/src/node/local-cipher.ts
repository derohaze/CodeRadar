/**
 * A local AES-256-GCM cipher for runs with no OS keychain.
 *
 * The packaged app encrypts the API key with Electron's `safeStorage`, which is
 * backed by the OS keychain. A standalone run — the dev server, CI, the CLI — has
 * no such thing, and the alternative to this file is writing the key to disk in
 * clear.
 *
 * So: a 32-byte random key is generated once next to the settings file and kept
 * owner-readable only. It is honestly weaker than an OS keychain — the key sits
 * on the same disk as the ciphertext, so it protects against a stray copy of the
 * settings file, not against someone with read access to the user's home
 * directory. That is why `protection()` reports `level: "basic"` and not `"os"`:
 * the settings store reports which of the two it got, and the UI can say so.
 *
 * If the directory cannot be written, `protection()` reports `available: false`
 * and the store refuses to save a key. A refusal is better than plaintext.
 *
 * The port's methods are synchronous, so this reads the key with `readFileSync`:
 * one small file, read once, before any review starts.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { KeyCipher, KeyProtection } from "./key-cipher.ts";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Owner-only: this is the one file that makes the settings file readable. */
const KEY_FILE_MODE = 0o600;

export interface LocalKeyCipherOptions {
  /** Where the machine-local key lives. Created on first use. */
  keyPath: string;
}

function readOrCreateKey(keyPath: string): Buffer | null {
  try {
    const existing = readFileSync(keyPath);
    if (existing.length === KEY_BYTES) return existing;
    // A key of the wrong size is not repairable: overwriting it would make every
    // stored key undecryptable, and there is no older copy to fall back to.
  } catch {
    // Missing file is the first-run case.
  }

  try {
    const generated = randomBytes(KEY_BYTES);
    mkdirSync(path.dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, generated, { mode: KEY_FILE_MODE });
    return generated;
  } catch {
    return null;
  }
}

export function createLocalKeyCipher(options: LocalKeyCipherOptions): KeyCipher {
  const key = readOrCreateKey(options.keyPath);
  const protection: KeyProtection = key === null ? { available: false, level: "none" } : { available: true, level: "basic" };

  return {
    protection: () => protection,

    encrypt(plaintext: string): string {
      if (key === null) throw new Error("No local key is available for encryption.");
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      // The GCM tag is prepended rather than appended so tampering is detected
      // before any ciphertext is handed to a decoder.
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
    },

    decrypt(payload: string): string {
      if (key === null) throw new Error("No local key is available for decryption.");
      const raw = Buffer.from(payload, "base64");
      if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("The stored key is not readable.");

      const iv = raw.subarray(0, IV_BYTES);
      const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      // Throws on a wrong key or a modified payload, which the settings store
      // turns into "the key could not be read" rather than into a bad request.
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    },
  };
}
