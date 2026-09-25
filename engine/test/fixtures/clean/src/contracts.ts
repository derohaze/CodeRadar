/**
 * Fixture: correct code that looks like a defect.
 *
 * Every construct here invites a specific wrong review comment, and every one is
 * correct for a reason stated in the code itself. A finding in this file is a
 * false positive, which is the failure mode this fixture exists to catch — the
 * `buggy` fixture proves the engine can find defects, and this one proves it
 * knows when there is nothing to find.
 *
 * These are the near-misses that survived a real review bar, so none of them
 * depends on a detector's regex: they are written to survive a reasoned reading.
 */

export interface AuditEntry {
  at: number;
  actor: string;
  action: string;
}

export interface Order {
  id: string;
  device: string;
  totalCents: number;
}

/**
 * Appends to the caller's array on purpose.
 *
 * The audit page renders from the same array instance it passes in and paginates
 * over it while the user scrolls, so it needs the appended entry to be visible in
 * that instance. Returning a copy would silently detach the page from its data.
 */
export function appendAuditEntry(log: AuditEntry[], entry: AuditEntry): void {
  log.push(entry);
}

export interface Session {
  deviceId: string;
}

/** Authorization lives here so no caller can enforce it inconsistently. */
function assertSameDevice(order: Order, session: Session): boolean {
  return order.device === session.deviceId;
}

export function readOrderForSession(order: Order, session: Session): Order | null {
  if (!assertSameDevice(order, session)) return null;
  return order;
}

export interface Telemetry {
  flush(batch: string[]): Promise<void>;
}

/**
 * Fire-and-forget on purpose.
 *
 * The nightly batch is rebuilt from the source of truth, so a dropped telemetry
 * batch costs one data point and nothing is charged on it. The rejection is
 * handled in the call itself, and the caller must not be held on a network hop
 * whose result it cannot use.
 */
export function recordBatch(telemetry: Telemetry, batch: string[]): void {
  void telemetry.flush(batch).catch((error: unknown) => {
    console.error("telemetry batch was not flushed", error);
  });
}

export interface Sleep {
  (ms: number): Promise<void>;
}

/** The delay is capped so three slow attempts cannot outlive the caller's timeout. */
const MAX_BACKOFF_MS = 600;

/**
 * Bounded retry: three attempts at most, each awaited, with a small capped delay.
 *
 * `throw lastError` after the loop is reachable when the caller asks for fewer
 * than one attempt, which is why it is not dead code.
 */
export async function withBackoff<T>(operation: () => Promise<T>, sleep: Sleep, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(Math.min(attempt * 200, MAX_BACKOFF_MS));
    }
  }

  throw lastError;
}

/**
 * Inclusive window on purpose.
 *
 * `to` is the last instant of the window rather than the first instant outside
 * it, so the comparison is `<=` against a timestamp and not against a length.
 */
export function isWithinWindow(at: number, from: number, to: number): boolean {
  return at >= from && at <= to;
}

/** The empty case is reachable: callers pass a list filtered down to nothing. */
export function firstEntryOrNull(entries: readonly AuditEntry[]): AuditEntry | null {
  if (entries.length === 0) return null;
  return entries[0] ?? null;
}

/**
 * Formatting bait: a nested ternary and a line that runs long.
 *
 * It reads poorly, and reading poorly is a preference. The review bar reports
 * defects, not tastes, so this must survive every preset.
 */
export function describeOrder(order: Order, session: Session): string {
  const scope = assertSameDevice(order, session) ? "own order" : "another device's order";
  const amount =
    order.totalCents > 0 ? `$${(order.totalCents / 100).toFixed(2)}` : order.totalCents === 0 ? "$0.00" : "a credit";
  return `${order.id}: ${amount} (${scope})`;
}
