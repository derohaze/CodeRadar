/**
 * The line a review waits in.
 *
 * The engine reviews one target at a time: two reviews would double the work over
 * the same disk, and two writers would interleave on one session's event stream.
 * Refusing the second request with 409 kept that guarantee but made "start another
 * review" a dead end for anyone who had one in flight, so the second one waits here
 * instead — it is accepted, it says it is queued, and it starts when the slot frees.
 *
 * A queued review is cancellable before it ever starts, which is what `signal` is
 * for: a session stopped while it waits gives up its place rather than running
 * later, after the user asked for it to stop.
 */

/** Reviews that may wait behind the running one before a start is refused. */
export const MAX_QUEUED_REVIEWS = 10;

export interface ReviewTurn {
  /** Gives the slot to the next review. Safe to call more than once. */
  release(): void;
}

export interface ReviewQueue {
  /**
   * Waits for a free slot.
   *
   * Resolves null when `signal` aborted while waiting, in which case no slot is
   * held and the review must not start.
   */
  acquire(signal: AbortSignal): Promise<ReviewTurn | null>;
  /** Reviews waiting for a turn, not counting the one running. */
  waiting(): number;
}

export function createReviewQueue(): ReviewQueue {
  /** Resolves when the running review hands the slot on. Chained, so turns are FIFO. */
  let slot: Promise<void> = Promise.resolve();
  let waiting = 0;

  return {
    waiting: () => waiting,

    acquire(signal: AbortSignal): Promise<ReviewTurn | null> {
      if (signal.aborted) return Promise.resolve(null);

      const previous = slot;
      let handOver: () => void = () => undefined;
      slot = new Promise<void>((resolve) => {
        handOver = resolve;
      });

      let released = false;
      const turn: ReviewTurn = {
        release: () => {
          if (released) return;
          released = true;
          handOver();
        },
      };

      waiting += 1;

      return new Promise<ReviewTurn | null>((resolve) => {
        /** Answers exactly once: the turn, or nothing because the wait was cancelled. */
        const finish = (aborted: boolean): void => {
          waiting -= 1;
          if (aborted) {
            // A review cancelled while it waited must not hold the place it just
            // gave up: releasing it here is what lets the next one start.
            turn.release();
            resolve(null);
            return;
          }
          resolve(turn);
        };

        const onAbort = (): void => finish(true);
        signal.addEventListener("abort", onAbort, { once: true });

        void previous.then(() => {
          // The wait was already answered by the abort listener.
          if (signal.aborted) return;
          signal.removeEventListener("abort", onAbort);
          finish(false);
        });
      });
    },
  };
}
