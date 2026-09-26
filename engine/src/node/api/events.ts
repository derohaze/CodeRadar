/**
 * The event stream for one review session.
 *
 * The renderer subscribes here instead of polling, so the progress screen is
 * pushed every stage as it happens. The stream is per session and per request:
 * nothing is buffered for a client that is not connected, because every frame is
 * the session's whole current state rather than a delta.
 *
 * Two properties are deliberate and must survive an edit:
 *
 * - The **first frame always carries the state as it stands**, terminal or not.
 *   A subscriber that attaches after the review finished still needs the result.
 * - Progress data only. Nothing here reads source, a prompt, or a model response,
 *   so a stream cannot leak what a review read.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { WireScanDetail } from "../api-contract.ts";
import type { SecurityEnvelope } from "./security.ts";
import type { SessionRecord, SessionStore } from "./session-store.ts";

/**
 * Idle streams get a comment frame this often, so a dead client is noticed. A
 * slow or dead SSE client must not hold the review open.
 */
const KEEP_ALIVE_MS = 15_000;

export interface StreamScanEventsOptions {
  request: IncomingMessage;
  response: ServerResponse;
  record: SessionRecord;
  store: SessionStore;
  security: SecurityEnvelope;
}

export function streamScanEvents({ request, response, record, store, security }: StreamScanEventsOptions): void {
  response.writeHead(200, {
    ...security.corsHeaders(request),
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const write = (eventName: string, detail: WireScanDetail): void => {
    response.write(`event: ${eventName}\ndata: ${JSON.stringify(detail)}\n\n`);
  };

  const eventNameFor = (): string => (record.status === "completed" ? "scan_completed" : "scan_failed");
  const isTerminal = (): boolean => record.status === "completed" || record.status === "failed";

  write(isTerminal() ? eventNameFor() : "scan_progress", store.detailFor(record));
  if (isTerminal()) {
    response.end();
    return;
  }

  const subscriber = (detail: WireScanDetail): void => {
    const terminal = isTerminal();
    write(terminal ? eventNameFor() : "scan_progress", detail);
    if (terminal) response.end();
  };

  record.subscribers.add(subscriber);

  const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), KEEP_ALIVE_MS);
  const cleanup = (): void => {
    clearInterval(keepAlive);
    record.subscribers.delete(subscriber);
  };
  request.on("close", cleanup);
  response.on("close", cleanup);
}
