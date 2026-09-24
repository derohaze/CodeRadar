/**
 * Bounded concurrency.
 *
 * A review reads many files and makes many model calls. Unbounded parallelism
 * on either one exhausts file descriptors or trips provider rate limits, and a
 * sequential loop wastes the whole run. A fixed window is the boring answer that
 * works, and it keeps the event order predictable for the UI.
 */

export interface MapWithConcurrencyOptions {
  /** Called after each item settles. Index is the input index. */
  onSettled?: ((index: number) => void) | undefined;
  /** Called before each item starts, for cancellation checks. */
  shouldContinue?: (() => boolean) | undefined;
}

/**
 * Runs `worker` over `items` with at most `limit` in flight, preserving the
 * input order in the result. A rejected item rejects the whole call, because a
 * silently dropped file is a review that claims coverage it does not have.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  options: MapWithConcurrencyOptions = {},
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const window = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    for (;;) {
      if (options.shouldContinue !== undefined && !options.shouldContinue()) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;

      const item = items[index];
      if (item === undefined) return;

      results[index] = await worker(item, index);
      options.onSettled?.(index);
    }
  }

  await Promise.all(Array.from({ length: window }, () => runWorker()));
  return results;
}
