import type { Session } from "@/entities/session/model/types";
import { apiUrl, request, tokenQuery } from "@/shared/api/client";
import type { ScanSessionDetail, StartScanPayload } from "@/shared/api/contract";
import type { ScanSessionDetailApiResponse, SessionApiResponse } from "@/shared/api/contract";
import { mapScanSessionDetail, mapSession } from "@/shared/api/mappers/session";

/** The scan session's own lifecycle: list, start, read, delete. */

export async function listSessions(): Promise<Session[]> {
  const data = await request<SessionApiResponse[]>("/sessions");
  return data.map(mapSession);
}

export async function startScan(payload: StartScanPayload): Promise<ScanSessionDetail> {
  const data = await request<ScanSessionDetailApiResponse>("/scans", {
    method: "POST",
    body: JSON.stringify({
      source_path: payload.sourcePath,
      target_type: payload.targetType,
      preset: payload.preset,
      scan_mode: payload.scanMode,
      interactive: payload.interactive ?? true,
    }),
  });
  return mapScanSessionDetail(data);
}

export async function getScanSession(sessionId: string): Promise<ScanSessionDetail> {
  const data = await request<ScanSessionDetailApiResponse>(`/scans/${sessionId}`);
  return mapScanSessionDetail(data);
}

/**
 * The address of one session's report page.
 *
 * A page cannot present a header, so the launch token travels as a query
 * parameter — the one place beside the event stream where the security envelope
 * accepts it. The caller opens this in a new window instead of fetching it: the
 * response is a document, not data for a screen.
 */
export function scanReportUrl(sessionId: string): string {
  return `${apiUrl(`/scans/${encodeURIComponent(sessionId)}/report`)}${tokenQuery()}`;
}

export async function deleteScanSession(sessionId: string): Promise<void> {
  await request<void>(`/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export async function deleteAllScanSessions(): Promise<void> {
  await request<void>("/sessions", {
    method: "DELETE",
  });
}
