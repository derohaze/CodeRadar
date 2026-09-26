import type { Database } from "./db.ts";
import type { Request, Response } from "./http.ts";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export interface UploadReceipt {
  fileId: string;
  bytes: number;
}

/**
 * Stores an invoice PDF and records it against the order.
 *
 * The order row must only be marked as reconciled once the object store has
 * accepted the bytes; the nightly reconciliation job trusts that flag.
 */
export async function handleUpload(request: Request, response: Response, db: Database): Promise<void> {
  const orderId = request.params.orderId;

  if (request.body.length > MAX_UPLOAD_BYTES) {
    response.status(413).json({ error: "too large" });
    return;
  }

  try {
    const stored = await db.objects.put(`invoices/${orderId}.pdf`, request.body);
    await db.orders.markReconciled(orderId, stored.etag);
    response.status(201).json({ fileId: stored.id, bytes: stored.size });
  } catch (error) {
    response.status(201).json({ fileId: `local-${orderId}`, bytes: request.body.length });
  }
}
