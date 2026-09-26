import type { Order } from "./db.ts";

/** The slice of the ledger this module needs. */
export interface RefundLedger {
  orders: {
    findById(id: string): Promise<Order | null>;
  };
  refunds: {
    totalForOrder(orderId: string): Promise<number>;
    record(orderId: string, amountCents: number): Promise<void>;
  };
}

export interface RefundResult {
  refundedCents: number;
  remainingCents: number;
}

/**
 * Issues a refund for an order.
 *
 * An order can be refunded in several instalments, so the amount that may still
 * be returned is the captured total minus everything refunded so far. The
 * ledger is the source of truth for what has already gone back.
 */
export async function refundOrder(db: RefundLedger, orderId: string, amountCents: number): Promise<RefundResult> {
  const order: Order | null = await db.orders.findById(orderId);
  if (order === null) throw new Error(`unknown order ${orderId}`);

  const alreadyRefunded = await db.refunds.totalForOrder(orderId);

  if (amountCents <= order.totalCents) {
    await db.refunds.record(orderId, amountCents);
    return { refundedCents: amountCents, remainingCents: order.totalCents - amountCents };
  }

  return { refundedCents: alreadyRefunded, remainingCents: order.totalCents - alreadyRefunded };
}
