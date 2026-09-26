/**
 * The security envelope around the local review API.
 *
 * This is the only part of the app that listens on a socket, and it hands out
 * two things an attacker wants: the contents of the user's source tree, and the
 * ability to send that source to a third-party model provider. Loopback is not a
 * boundary — any web page the user visits can reach `127.0.0.1`. Four controls,
 * each closing a specific hole:
 *
 * 1. **Bind to `127.0.0.1` only.** Never a routable interface, so the API is not
 *    reachable from the network the machine is on.
 * 2. **A per-launch token** on every route that reads or changes anything. The
 *    main process generates it, hands it to the renderer, and never writes it to
 *    disk. A page in the user's browser cannot read it, which is what stops a
 *    drive-by request. Without this, a sandboxed iframe — which sends
 *    `Origin: null` — could read reviews, because production loads the renderer
 *    from `file://` and so genuinely has a null origin itself.
 * 3. **An origin allowlist, and never `Access-Control-Allow-Origin: *`.** The
 *    browser then refuses to hand a response to any other page, and a JSON POST
 *    from another origin never even reaches a handler because `application/json`
 *    makes it a preflighted request.
 * 4. **A `Host` check.** A DNS-rebinding attack reaches loopback under an
 *    attacker's hostname; requiring `127.0.0.1`/`localhost` refuses it.
 *
 * `GET /health/live` is deliberately exempt: the renderer probes it before it
 * can know anything, and it returns no data. Everything else requires the token.
 *
 * The router applies these in order. Nothing in this module decides *what* a
 * request means, so a change here cannot widen a route's authority by accident.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** Every route lives under this prefix; the renderer's base URL ends with it. */
export const API_PREFIX = "/api/v1";

/** A body above this is refused. An unbounded one is a memory-exhaustion primitive. */
const MAX_BODY_BYTES = 64 * 1024;

export interface SecurityEnvelopeOptions {
  /** Extra browser origins to accept, for a dev server on another port. */
  allowedOrigins?: readonly string[] | undefined;
}

export interface SecurityEnvelope {
  /** True for an origin a browser may send, and for `file://`'s `"null"`. */
  isAllowedOrigin(origin: string): boolean;
  corsHeaders(request: IncomingMessage): Record<string, string>;
  /** Answers a preflight request. An origin not on the allowlist is refused. */
  handlePreflight(request: IncomingMessage, response: ServerResponse): void;
  /** True when the request's `Host` names loopback, so DNS rebinding cannot pass. */
  hostIsLoopback(request: IncomingMessage): boolean;
  /** The secret this request presents, from the header or the query string. */
  presentedToken(request: IncomingMessage, url: URL): string | null;
  sendJson(request: IncomingMessage, response: ServerResponse, status: number, body: unknown): void;
  sendError(request: IncomingMessage, response: ServerResponse, status: number, detail: string): void;
  /** Turns a thrown value into the response a failed request should get. */
  sendFailure(request: IncomingMessage, response: ServerResponse, status: number, error: unknown): void;
  /** Reads a bounded JSON body. Throws on an oversized or malformed one. */
  readJsonBody(request: IncomingMessage): Promise<unknown>;
}

/**
 * The message a failed request may expose.
 *
 * The renderer reads `detail` and shows it through `toAnalystCopy`, so this is
 * the one place an error's own text reaches the user. A thrown non-Error has no
 * message worth printing, hence the fallback.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The review could not be completed.";
}

export function createSecurityEnvelope(options: SecurityEnvelopeOptions = {}): SecurityEnvelope {
  const allowedOrigins = new Set([
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    ...(options.allowedOrigins ?? []),
  ]);

  // `null` is how a browser labels a request from a `file://` document, which is
  // how the packaged app loads. It is accepted for the same-origin check but is
  // never echoed back as an allowed origin.
  const isAllowedOrigin = (origin: string): boolean => origin === "null" || allowedOrigins.has(origin);

  function hostIsLoopback(request: IncomingMessage): boolean {
    const header = request.headers.host;
    if (typeof header !== "string") return false;
    const name = header.replace(/:\d+$/, "").toLowerCase();
    return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
  }

  function presentedToken(request: IncomingMessage, url: URL): string | null {
    const header = request.headers["x-coderadar-token"];
    if (typeof header === "string") return header;
    return url.searchParams.get("token");
  }

  function corsHeaders(request: IncomingMessage): Record<string, string> {
    const origin = request.headers.origin;
    if (typeof origin !== "string" || !isAllowedOrigin(origin)) return {};
    // Echo the exact origin. Never `*`, which would let any page read the reply.
    return {
      "access-control-allow-origin": origin,
      vary: "Origin",
    };
  }

  function sendJson(request: IncomingMessage, response: ServerResponse, status: number, body: unknown): void {
    const payload = body === undefined ? "" : JSON.stringify(body);
    response.writeHead(status, {
      ...corsHeaders(request),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(payload),
    });
    response.end(payload);
  }

  function sendError(request: IncomingMessage, response: ServerResponse, status: number, detail: string): void {
    sendJson(request, response, status, { detail });
  }

  function handlePreflight(request: IncomingMessage, response: ServerResponse): void {
    // Answered for allowlisted origins only, which is what keeps a JSON POST
    // from another page from ever reaching a handler.
    const headers = corsHeaders(request);
    if (Object.keys(headers).length === 0) {
      response.writeHead(403).end();
      return;
    }
    response.writeHead(204, {
      ...headers,
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,x-coderadar-token",
      "access-control-max-age": "600",
    });
    response.end();
  }

  async function readJsonBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;

    for await (const chunk of request) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > MAX_BODY_BYTES) throw new Error("The request body is too large.");
      chunks.push(buffer);
    }

    if (size === 0) return null;
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("The request body is not valid JSON.");
    }
  }

  function sendFailure(request: IncomingMessage, response: ServerResponse, status: number, error: unknown): void {
    sendError(request, response, status, messageOf(error));
  }

  return {
    isAllowedOrigin,
    corsHeaders,
    handlePreflight,
    hostIsLoopback,
    presentedToken,
    sendJson,
    sendError,
    sendFailure,
    readJsonBody,
  };
}
