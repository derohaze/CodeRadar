/**
 * The saved sessions of this run: list them, or drop one or all of them.
 *
 * Deleting a session also stops the review it started, running or still waiting
 * for a turn. The session carries its own cancellation signal, so this is the same
 * abort whether the review is in flight or queued behind someone else's — and a
 * review whose session no longer exists must not keep either the slot or a place
 * in the line.
 *
 * Deleting is not how a user stops a review they want to keep: that is
 * `POST /scans/:id/cancel`, which leaves the session in place marked `cancelled`.
 */

import type { RouteHandler } from "../context.ts";

export const sessionsRoutes: RouteHandler = ({ request, response, method, suffix, store, security }) => {
  if (suffix === "/sessions" && method === "GET") {
    // The list is the wire session, not the detail: the sidebar has no room for
    // findings, and every detail would carry all of them.
    const list = store.list().map((record) => store.detailFor(record).session);
    security.sendJson(request, response, 200, list);
    return true;
  }

  if (suffix === "/sessions" && method === "DELETE") {
    for (const record of store.list()) record.abort.abort();
    store.clear();
    response.writeHead(204, security.corsHeaders(request)).end();
    return true;
  }

  if (suffix.startsWith("/sessions/") && method === "DELETE") {
    const id = suffix.slice("/sessions/".length);
    store.get(id)?.abort.abort();
    store.remove(id);
    response.writeHead(204, security.corsHeaders(request)).end();
    return true;
  }

  return false;
};
