/**
 * The one entry point for an HTTP request: the security gate, then the routes.
 *
 * The order below is load-bearing, and it is the whole reason this is one file:
 * a preflight is answered before anything is authenticated (it carries no
 * credentials by design), the health probe is answered before the token check so
 * the renderer can discover the API at all, and nothing else runs until the
 * request has passed the host, origin and token checks. Reordering these is a
 * security change, not a refactor.
 *
 * Routes are tried in order and the first one that recognises the request
 * answers it, so a new route file is added to `ROUTES` and nothing else changes.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiContext, RouteHandler, RouteRequest } from "./context.ts";
import { repoInsightsRoutes } from "./routes/repo-insights.ts";
import { remediationRoutes } from "./routes/remediation.ts";
import { scansRoutes } from "./routes/scans.ts";
import { sessionsRoutes } from "./routes/sessions.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { API_PREFIX, type SecurityEnvelope } from "./security.ts";
import type { SessionStore } from "./session-store.ts";
import type { ReviewService } from "../service.ts";

const ROUTES: readonly RouteHandler[] = [
  sessionsRoutes,
  repoInsightsRoutes,
  scansRoutes,
  settingsRoutes,
  remediationRoutes,
];

export interface RouterOptions {
  service: ReviewService;
  store: SessionStore;
  security: SecurityEnvelope;
  /** Secret the renderer must present. Generated per launch by the caller. */
  token: string;
  /** Used only to resolve a relative request URL; the socket holds the bind address. */
  host: string;
}

export function createRouter(options: RouterOptions): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const context: ApiContext = {
    service: options.service,
    store: options.store,
    security: options.security,
    token: options.token,
  };

  return async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${options.host}`);
    const method = request.method ?? "GET";
    const path = url.pathname;

    // Preflight is answered for allowlisted origins only, which is what keeps a
    // JSON POST from another page from ever reaching a handler.
    if (method === "OPTIONS") {
      options.security.handlePreflight(request, response);
      return;
    }

    if (!options.security.hostIsLoopback(request)) {
      options.security.sendError(request, response, 403, "This API only answers on the local machine.");
      return;
    }
    const origin = request.headers.origin;
    if (typeof origin === "string" && !options.security.isAllowedOrigin(origin)) {
      options.security.sendError(request, response, 403, "This origin is not allowed to use the local review API.");
      return;
    }

    if (path === `${API_PREFIX}/health/live`) {
      options.security.sendJson(request, response, 200, { status: "ok" });
      return;
    }

    if (!path.startsWith(`${API_PREFIX}/`)) {
      options.security.sendError(request, response, 404, "Unknown endpoint.");
      return;
    }
    if (options.security.presentedToken(request, url) !== options.token) {
      options.security.sendError(request, response, 401, "The local review API rejected this request.");
      return;
    }

    const routeRequest: RouteRequest = {
      ...context,
      request,
      response,
      method,
      url,
      suffix: path.slice(API_PREFIX.length),
    };

    for (const handler of ROUTES) {
      if (await handler(routeRequest)) return;
    }

    options.security.sendError(request, response, 404, "Unknown endpoint.");
  };
}
