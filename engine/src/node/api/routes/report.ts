/**
 * One session's report, as a page a person can read.
 *
 * The renderer answers the same questions on its own screens, and a page is not
 * a second product: this exists because a review is something a person shows to
 * someone else, prints, or keeps. The document is rendered from the report the
 * run produced, on request, so it cannot go stale against the session it belongs
 * to, and nothing is written to disk.
 *
 * It is a data route like any other: the router has already refused the request
 * without the launch token, and the document carries no script, so a hostile
 * file name or a quoted line cannot execute anything here.
 */

import { renderReviewReportHtml } from "../../../core/review/report/html.ts";
import type { RouteHandler } from "../context.ts";

/** `/scans/<id>/report` — the id is opaque, so it is matched, not parsed. */
const REPORT_PATH = /^\/scans\/([^/]+)\/report$/;

export const reportRoutes: RouteHandler = ({ request, response, method, suffix, store, security }) => {
  const match = REPORT_PATH.exec(suffix);
  if (match === null || method !== "GET") return false;

  const record = match[1] === undefined ? undefined : store.get(match[1]);
  if (record === undefined) {
    security.sendError(request, response, 404, "That review session does not exist.");
    return true;
  }

  // A running review has no report yet, and a page of half a review would read as
  // a finished one. The caller is told to wait rather than shown an empty result.
  if (record.report === null) {
    security.sendError(request, response, 409, "That review has not produced a report yet.");
    return true;
  }

  security.sendHtml(
    request,
    response,
    200,
    renderReviewReportHtml(record.report, { source: record.sourcePath }),
  );
  return true;
};
