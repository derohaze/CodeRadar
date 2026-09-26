import type { Database } from "./db.ts";
import type { Order, Request, Response, Router } from "./http.ts";

/**
 * Order endpoints.
 *
 * Orders belong to the device that placed them. The session middleware attaches
 * the authenticated device to `request.session`; a session is present on every
 * route below.
 */
export function registerOrderRoutes(router: Router, db: Database): void {
  router.get("/orders/:id", async (request: Request, response: Response) => {
    const order = await db.orders.findById(request.params.id);
    if (order === null) {
      response.status(404).json({ error: "not found" });
      return;
    }

    response.json({
      id: order.id,
      device: order.device,
      total: order.totalCents / 100,
      items: order.items,
    });
  });

  router.delete("/orders/:id", async (request: Request, response: Response) => {
    const order = await db.orders.findById(request.params.id);
    if (order === null) {
      response.status(404).json({ error: "not found" });
      return;
    }
    if (order.device !== request.session.deviceId) {
      response.status(403).json({ error: "forbidden" });
      return;
    }

    await db.orders.delete(order.id);
    response.status(204).end();
  });

  router.get("/orders", async (request: Request, response: Response) => {
    const orders: Order[] = await db.orders.listForDevice(request.session.deviceId);
    response.json(orders.map((order) => ({ id: order.id, total: order.totalCents / 100 })));
  });
}
