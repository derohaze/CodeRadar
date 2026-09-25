/**
 * The API-key cipher port.
 *
 * Storing an API key at rest is the one place the desktop app holds a secret,
 * and the platform decides how that can be done: Electron exposes `safeStorage`
 * (an OS keychain-backed key), while a headless run of the engine may have
 * nothing at all.
 *
 * The engine cannot import Electron — it is also the CLI and the test suite —
 * so the capability is injected. `protection()` is queried before anything is
 * written, which is what makes "no key store" an honest refusal at save time
 * rather than a plaintext key on disk.
 */

export interface KeyProtection {
  available: boolean;
  /** `os` for a keychain-backed cipher, `basic` for a weaker local one. */
  level: "os" | "basic" | "none";
}

export interface KeyCipher {
  protection(): KeyProtection;
  /** Encrypts a plaintext key into the string that gets persisted. */
  encrypt(plaintext: string): string;
  /** Decrypts a stored payload. Throws when the payload is not readable here. */
  decrypt(payload: string): string;
}
