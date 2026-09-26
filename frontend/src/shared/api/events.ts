import { apiUrl, tokenQuery } from "@/shared/api/client";
import type { ScanSessionDetail, ScanSessionDetailApiResponse } from "@/shared/api/contract";
import { mapScanSessionDetail } from "@/shared/api/mappers/session";

/**
 * A session's progress stream.
 *
 * One `EventSource` per session, closed by the caller's disposer or by the stream
 * itself on a terminal event, so a finished review stops holding a connection
 * open. `EventSource` cannot send headers, so the launch token travels as a query
 * parameter on this one route.
 */

export interface ScanEventHandlers {
  onSession: (detail: ScanSessionDetail) => void;
  onTerminal?: (detail: ScanSessionDetail) => void;
  onError?: () => void;
}

export function subscribeToScanEvents(sessionId: string, handlers: ScanEventHandlers): () => void {
  const source = new EventSource(apiUrl(`/scans/${sessionId}/events${tokenQuery()}`));
  const handleDetail = (event: MessageEvent<string>, terminal: boolean) => {
    const parsed = JSON.parse(event.data) as ScanSessionDetailApiResponse;
    const detail = mapScanSessionDetail(parsed);
    handlers.onSession(detail);
    if (terminal) {
      handlers.onTerminal?.(detail);
      source.close();
    }
  };

  source.addEventListener("scan_progress", (event) => handleDetail(event as MessageEvent<string>, false));
  source.addEventListener("scan_completed", (event) => handleDetail(event as MessageEvent<string>, true));
  source.addEventListener("scan_failed", (event) => handleDetail(event as MessageEvent<string>, true));
  source.onerror = () => {
    source.close();
    handlers.onError?.();
  };

  return () => source.close();
}
