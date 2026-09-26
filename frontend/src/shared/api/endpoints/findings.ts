import type { RemediationExplanation } from "@/entities/finding/model/types";
import { request } from "@/shared/api/client";
import type { ExplainFindingPayload, ExplanationApiResponse } from "@/shared/api/contract";
import { mapExplanation } from "@/shared/api/mappers/finding";

/** The one finding-level call the renderer makes: ask the model to explain a fix. */

export async function explainFinding(payload: ExplainFindingPayload): Promise<RemediationExplanation> {
  const data = await request<ExplanationApiResponse>("/remediation/explain", {
    method: "POST",
    body: JSON.stringify({
      session_id: payload.sessionId,
      finding_id: payload.findingId,
    }),
  });
  return mapExplanation(data);
}
