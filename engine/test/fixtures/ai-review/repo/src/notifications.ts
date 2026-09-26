import type { Database } from "./db.ts";

/**
 * Transactional email for order events.
 *
 * Delivery goes through the provider's idempotency key, so a retry of the same
 * event never sends a second email.
 */
const IDEMPOTENCY_HEADER = "Idempotency-Key";

export interface Mailer {
  send(message: { to: string; subject: string; body: string }, idempotencyKey: string): Promise<void>;
}

export interface Metrics {
  increment(name: string): void;
}

export async function sendReceipt(
  mailer: Mailer,
  orderId: string,
  recipient: string,
  amountCents: number,
): Promise<boolean> {
  const formatted = (amountCents / 100).toFixed(2);

  try {
    await mailer.send(
      { to: recipient, subject: `Receipt for order ${orderId}`, body: `Total: ${formatted}` },
      `receipt:${orderId}`,
    );
    return true;
  } catch (error) {
    // The receipt is a courtesy: the order is already paid and the customer can
    // re-request it from the order page. Failing the checkout because the mail
    // provider is down would lose the order, so the failure is logged and the
    // caller is told the email was not sent rather than being interrupted.
    console.error(`receipt delivery failed for order ${orderId}`, error);
    return false;
  }
}

/**
 * Best-effort telemetry.
 *
 * Metrics are not on the critical path: a metrics outage must never surface to
 * a customer, and the counter is not used for billing or accounting.
 */
export function recordOrderPlaced(metrics: Metrics, region: string): void {
  try {
    metrics.increment(`orders.placed.${region}`);
  } catch {
    // intentionally ignored, see above
  }
}

/** Reads the customer's stored notification preferences. */
export async function preferencesFor(db: Database, deviceId: string): Promise<Record<string, string>> {
  const rows = await db.query(
    "SELECT user_id, channel, opted_in FROM notification_preferences WHERE device_id = $1",
    [deviceId],
  );

  const preferences: Record<string, string> = {};
  for (const row of rows) {
    const channel = String(row.channel);
    preferences[channel] = String(row.opted_in);
  }
  return preferences;
}

/** Parses the JSON blob the preferences endpoint stores. */
export function parsePreferences(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export { IDEMPOTENCY_HEADER };
