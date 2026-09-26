/** Starting a review, reading one back, watching one run, and stopping one. */

import type { WirePreset, WireScanMode } from "../../api-contract.ts";
import { asString, isRecord } from "../body.ts";
import type { RouteHandler, RouteRequest } from "../context.ts";
import { streamScanEvents } from "../events.ts";
import { MAX_QUEUED_REVIEWS } from "../review-queue.ts";
import { runReview } from "../review-run.ts";

function asTargetType(value: unknown): "file" | "folder" {
  return value === "file" ? "file" : "folder";
}

function asPreset(value: unknown): WirePreset {
  return value === "safe" || value === "aggressive" ? value : "balanced";
}

function asScanMode(value: unknown): WireScanMode {
  return value === "fast" ? "fast" : "deep";
}

/**
 * POST /scans — registers a session and queues its review.
 *
 * The review is not refused because another one is running: the engine reviews one
 * target at a time, so this one waits its turn and says it is waiting. The only
 * refusal is a queue with no room left, which is a real limit worth telling the
 * user about rather than an arbitrary one.
 */
async function startScan({ request, response, service, store, queue, security }: RouteRequest): Promise<boolean> {
  let body: unknown;
  try {
    body = await security.readJsonBody(request);
  } catch (error) {
    security.sendFailure(request, response, 400, error);
    return true;
  }

  const payload = isRecord(body) ? body : {};
  const sourcePath = asString(payload["source_path"]);
  if (sourcePath === null) {
    security.sendError(request, response, 400, "A source path is required.");
    return true;
  }
  if (queue.waiting() >= MAX_QUEUED_REVIEWS) {
    security.sendError(
      request,
      response,
      409,
      `The review queue is full (${MAX_QUEUED_REVIEWS} reviews are already waiting). Wait for one to finish and try again.`,
    );
    return true;
  }

  const record = store.create({
    sourcePath,
    targetType: asTargetType(payload["target_type"]),
    preset: asPreset(payload["preset"]),
    scanMode: asScanMode(payload["scan_mode"]),
  });

  // The caller gets the session immediately, because the progress screen is
  // driven by the event stream. Awaiting here would leave the user on the picker
  // until the review ended.
  void runReview(service, store, record, queue);
  security.sendJson(request, response, 200, store.detailFor(record));
  return true;
}

/**
 * POST /scans/:id/cancel — stops a review and keeps the session.
 *
 * Idempotent: cancelling a session that already finished, or cancelling twice,
 * answers with the same detail rather than an error. The session survives as the
 * record of a review the user stopped, which is a thing they chose to do and
 * nothing to lose.
 */
function cancelScan({ request, response, store, security }: RouteRequest, id: string): boolean {
  const record = store.get(id);
  if (record === undefined) {
    security.sendError(request, response, 404, "That review session does not exist.");
    return true;
  }

  // The session's own signal is what both the queue and the engine observe, so
  // this stops a review that is running and one that is still waiting.
  record.abort.abort();
  security.sendJson(request, response, 200, store.detailFor(record));
  return true;
}

export const scansRoutes: RouteHandler = (route) => {
  const { request, response, method, suffix, store, security } = route;

  if (suffix === "/scans" && method === "POST") return startScan(route);

  if (suffix.startsWith("/scans/")) {
    const rest = suffix.slice("/scans/".length);
    const [id, sub] = rest.split("/");

    if (sub === "cancel" && method === "POST") {
      return id === undefined ? false : cancelScan(route, id);
    }

    if (method === "GET") {
      // Only the sub-resources this group owns are answered here. Anything else —
      // the report page, for one — is left to the next route, so a route's meaning
      // does not depend on where it sits in the list.
      if (sub !== undefined && sub !== "events") return false;

      const record = id === undefined ? undefined : store.get(id);
      if (record === undefined) {
        security.sendError(request, response, 404, "That review session does not exist.");
        return true;
      }
      if (sub === "events") {
        streamScanEvents({ request, response, record, store, security });
        return true;
      }
      security.sendJson(request, response, 200, store.detailFor(record));
      return true;
    }
  }

  return false;
};
