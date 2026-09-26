/** What one request that already passed the security gate hands to a route. */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ReviewService } from "../service.ts";
import type { SecurityEnvelope } from "./security.ts";
import type { SessionStore } from "./session-store.ts";

export interface ApiContext {
  readonly service: ReviewService;
  readonly store: SessionStore;
  readonly security: SecurityEnvelope;
  /** Secret the renderer presents. The router compares it before any route runs. */
  readonly token: string;
}

export interface RouteRequest extends ApiContext {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly method: string;
  readonly url: URL;
  /** The path after `/api/v1`, e.g. `/sessions/3f2a`. */
  readonly suffix: string;
}

/**
 * One route group's handler.
 *
 * Returns true when it answered the request. False leaves the request to the
 * next route, which is how several groups share a prefix without any of them
 * needing to know the others exist.
 */
export type RouteHandler = (route: RouteRequest) => boolean | Promise<boolean>;
