/** The saved sessions of this run: list them, or drop one or all of them. */

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
    store.clear();
    response.writeHead(204, security.corsHeaders(request)).end();
    return true;
  }

  if (suffix.startsWith("/sessions/") && method === "DELETE") {
    store.remove(suffix.slice("/sessions/".length));
    response.writeHead(204, security.corsHeaders(request)).end();
    return true;
  }

  return false;
};
