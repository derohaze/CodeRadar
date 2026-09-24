/**
 * Fixture: correct code, and the exact shapes that produced false positives
 * while the engine was being built.
 *
 * Both functions handle their failure. A catch line that begins with the closing
 * brace of the `try` block, and a catch that falls back to a defined value, are
 * both handled failures rather than swallowed ones.
 */

export interface RetryOptions {
  attempts: number;
  shouldRetry: boolean;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T | null> {
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!options.shouldRetry || attempt === options.attempts - 1) {
        throw error;
      }
    }
  }
  return null;
}

export function readStoredValue(read: () => string | null): string | null {
  try {
    return read();
  } catch {
    return null;
  }
}
