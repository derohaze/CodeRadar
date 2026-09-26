/** Attack narrative for one finding of a session still in memory. */

import { asString, isRecord } from "../body.ts";
import type { RouteHandler, RouteRequest } from "../context.ts";

/**
 * The engine has no exploit simulator, and this route is the one place the UI
 * asks for an attack narrative. The answer is assembled from the finding's own
 * verified evidence, so it explains the defect that was actually found instead
 * of inventing a scenario the engine never reasoned about.
 */
async function explainFinding({ request, response, store, security }: RouteRequest): Promise<boolean> {
  let body: unknown;
  try {
    body = await security.readJsonBody(request);
  } catch (error) {
    security.sendFailure(request, response, 400, error);
    return true;
  }

  const payload = isRecord(body) ? body : {};
  const sessionId = asString(payload["session_id"]);
  const findingId = asString(payload["finding_id"]);
  const record = sessionId === null ? undefined : store.get(sessionId);
  const finding = findingId === null ? undefined : record?.report?.findings.find((entry) => entry.id === findingId);

  if (record === undefined || finding === undefined) {
    security.sendError(request, response, 404, "That finding is not part of a review that is still in this session.");
    return true;
  }

  const { file, line, lineEnd } = finding.location;
  security.sendJson(request, response, 200, {
    finding_id: finding.id,
    summary: finding.problem,
    exploit_scenario: finding.why,
    request_example: "",
    payload_example: "",
    attack_steps: [finding.evidence],
    entry_point: `${file}:${lineEnd > line ? `${line}-${lineEnd}` : `${line}`}`,
    execution_path: finding.why,
    sink: finding.axis,
    impact: finding.impact,
  });
  return true;
}

export const remediationRoutes: RouteHandler = (route) => {
  if (route.suffix === "/remediation/explain" && route.method === "POST") return explainFinding(route);
  return false;
};
