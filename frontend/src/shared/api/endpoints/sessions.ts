import type { Session } from "@/entities/session/model/types";
import { request } from "@/shared/api/client";
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
