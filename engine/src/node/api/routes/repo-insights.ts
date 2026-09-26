/**
 * What a user can read across the reviews of this run.
 *
 * Both routes aggregate over completed sessions, which is all that is persisted.
 * They report counts the engine actually recorded; anything it does not compute
 * is zero rather than invented, the same rule the wire contract follows.
 */

import type { RouteHandler } from "../context.ts";
import type { SessionRecord } from "../session-store.ts";

/** The folder name a session reviewed, which is how a person names a repo. */
function repoName(record: SessionRecord): string {
  return record.sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? record.sourcePath;
}

function intelligenceSummary(completed: readonly SessionRecord[]): Record<string, unknown> {
  const topRepositories: Record<string, number> = {};
  let hotspotCount = 0;

  for (const record of completed) {
    const name = repoName(record);
    topRepositories[name] = (topRepositories[name] ?? 0) + (record.report?.findings.length ?? 0);
    hotspotCount += record.report?.repositoryIndex.hotspots.length ?? 0;
  }

  const busiest = Object.entries(topRepositories).sort((left, right) => right[1] - left[1])[0];
  return {
    session_count: completed.length,
    hotspot_count: hotspotCount,
    critical_hotspots: completed.reduce(
      (total, record) => total + (record.report?.findings.filter((finding) => finding.severity === "critical").length ?? 0),
      0,
    ),
    identity_zones: 0,
    exposure_zones: 0,
    data_zones: 0,
    coverage_zones: 0,
    top_hotspot_label: busiest === undefined ? "" : `${busiest[0]} (${busiest[1]})`,
    top_repositories: topRepositories,
  };
}

/** The highest-scoring files of every completed session, newest session last. */
function hotspotFeed(completed: readonly SessionRecord[]): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  for (const record of completed) {
    const name = repoName(record);
    for (const hotspot of record.report?.repositoryIndex.hotspots.slice(0, 5) ?? []) {
      items.push({
        session_id: record.id,
        repo: name,
        hotspot_class: hotspot.reasons[0] ?? "attention",
        priority: hotspot.score >= 8 ? "high" : hotspot.score >= 4 ? "medium" : "low",
        label: `${hotspot.file} (${hotspot.score})`,
      });
    }
  }
  return items;
}

export const repoInsightsRoutes: RouteHandler = ({ request, response, method, suffix, store, security }) => {
  if (suffix === "/sessions/repo-intelligence-summary" && method === "GET") {
    security.sendJson(request, response, 200, intelligenceSummary(store.completed()));
    return true;
  }

  if (suffix === "/sessions/repo-hotspots" && method === "GET") {
    security.sendJson(request, response, 200, { items: hotspotFeed(store.completed()) });
    return true;
  }

  return false;
};
