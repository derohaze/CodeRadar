/** Starting a review, reading one back, and watching one run. */

import type { WirePreset, WireScanMode } from "../../api-contract.ts";
import { asString, isRecord } from "../body.ts";
import type { RouteHandler, RouteRequest } from "../context.ts";
import { streamScanEvents } from "../events.ts";
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

/** POST /scans — registers a session and starts its review in the background. */
async function startScan({ request, response, service, store, security }: RouteRequest): Promise<boolean> {
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
  if (service.isRunning()) {
    security.sendError(request, response, 409, "A review is already running.");
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
  void runReview(service, store, record);
  security.sendJson(request, response, 200, store.detailFor(record));
  return true;
}

export const scansRoutes: RouteHandler = (route) => {
  const { request, response, method, suffix, store, security } = route;

  if (suffix === "/scans" && method === "POST") return startScan(route);

  if (suffix.startsWith("/scans/") && method === "GET") {
    const rest = suffix.slice("/scans/".length);
    const [id, sub] = rest.split("/");
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

  return false;
};
