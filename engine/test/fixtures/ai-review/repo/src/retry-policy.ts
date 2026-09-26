export interface Sleep {
  (ms: number): Promise<void>;
}

/**
 * Retries an operation that the caller has declared safe to repeat.
 *
 * The contract is that this either returns the operation's value or throws the
 * last failure: callers decide whether to surface the error or fall back, and
 * none of them handle a silent `undefined`.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number,
  sleep: Sleep,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        return undefined as unknown as T;
      }
      await sleep(attempt * 100);
    }
  }

  throw lastError;
}
