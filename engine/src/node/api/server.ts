/**
 * The local review API.
 *
 * The renderer already speaks this contract over HTTP, so the migration keeps
 * that contract and replaces what is behind it: the legacy Python service is
 * gone, and this Node server in the Electron main process serves the same routes
 * from the TypeScript review engine. No screen changes, no Python, no Rust.
 *
 * What this file does is compose the three pieces a review API needs — the
 * security envelope every request passes through (`security.ts`), the sessions
 * of this run (`session-store.ts`), and the routes behind them (`router.ts`) —
 * and own the socket they are served on. How a request is authenticated is
 * documented in `security.ts`; which request reaches which route is documented
 * in `router.ts`.
 *
 * Session history is per run: closing the server drops every live stream and
 * nothing outlives the process.
 */

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createRouter } from "./router.ts";
import { createSecurityEnvelope } from "./security.ts";
import { createSessionStore } from "./session-store.ts";
import type { ReviewService } from "../service.ts";
import { SourceWindowError } from "../source-window.ts";

export interface ReviewApiServerOptions {
  service: ReviewService;
  /** Secret the renderer must present. Generated per launch by the caller. */
  token: string;
  host?: string;
  port?: number;
  /** Extra browser origins to accept, for a dev server on another port. */
  allowedOrigins?: readonly string[];
}

export interface ReviewApiServer {
  readonly port: number;
  readonly origin: string;
  /** The secret callers must present. Returned so the main process can pass it on. */
  readonly token: string;
  close(): Promise<void>;
}

export async function startReviewApiServer(options: ReviewApiServerOptions): Promise<ReviewApiServer> {
  const host = options.host ?? "127.0.0.1";
  const security = createSecurityEnvelope({ allowedOrigins: options.allowedOrigins });
  const store = createSessionStore();
  const route = createRouter({ service: options.service, store, security, token: options.token, host });

  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void route(request, response).catch((error: unknown) => {
      // A refused source window is a bad request, not a server fault: the
      // renderer asked for a file outside the reviewed scope.
      if (error instanceof SourceWindowError) {
        security.sendError(request, response, 400, error.message);
        return;
      }
      security.sendFailure(request, response, 500, error);
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The local review API did not report a port."));
        return;
      }
      resolve(address.port);
    });
  });

  return {
    port,
    origin: `http://${host}:${port}`,
    token: options.token,
    close: () =>
      new Promise<void>((resolve) => {
        store.detachSubscribers();
        server.close(() => resolve());
      }),
  };
}
