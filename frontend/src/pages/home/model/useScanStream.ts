import { useEffect } from "react";
import { getScanSession, subscribeToScanEvents, type ScanSessionDetail } from "@/shared/api";

/**
 * The live view of a running review.
 *
 * The engine streams a session's progress; this holds the subscription for as
 * long as the page is showing a review that is still running. Nothing is stored
 * here — every detail is handed to the caller, which decides what it means for the
 * screen it is on.
 *
 * Two properties are deliberate and must survive an edit:
 *
 * - The caller's `onDetail` is a dependency. The subscription is scoped to what
 *   is on screen, not to the session's lifetime, so a callback that changes when
 *   the screen changes re-subscribes exactly as the inline effect did.
 * - A stream that cannot be opened, or that dies, falls back to polling with a
 *   widening delay. A review without a live stream still advances on screen, and
 *   the fallback stops for good once the session reaches a terminal status.
 */

/** The statuses a review is still live in. A terminal session has nothing to stream. */
const LIVE_STATUSES = ["queued", "scanning"];

export interface ScanStreamOptions {
  /** The session being watched. Null while nothing is open. */
  sessionId: string | null;
  /** The session's current detail; its status decides whether there is anything to watch. */
  session: ScanSessionDetail | null;
  /** Called for every detail, from the stream and from the fallback poll alike. */
  onDetail: (detail: ScanSessionDetail) => void;
}

export function useScanStream({ sessionId, session, onDetail }: ScanStreamOptions): void {
  useEffect(() => {
    if (!sessionId || !session) return;
    if (!LIVE_STATUSES.includes(session.session.status)) return;
    let isClosed = false;
    let fallbackTimer: number | null = null;
    let fallbackAttempt = 0;
    const pollWithBackoff = () => {
      if (isClosed) return;
      const delay = fallbackAttempt < 2 ? 2500 : fallbackAttempt < 5 ? 4000 : 8000;
      fallbackTimer = window.setTimeout(() => {
        void getScanSession(sessionId).then((detail) => {
          onDetail(detail);
          if (!["completed", "failed"].includes(detail.session.status)) { fallbackAttempt += 1; pollWithBackoff(); }
        }).catch(() => { fallbackAttempt += 1; pollWithBackoff(); });
      }, delay);
    };
    let cleanup = () => undefined;
    if (typeof window !== "undefined" && "EventSource" in window) {
      cleanup = subscribeToScanEvents(sessionId, { onSession: onDetail, onTerminal: onDetail, onError: () => { if (!isClosed) pollWithBackoff(); } });
    } else pollWithBackoff();
    return () => {
      isClosed = true; cleanup();
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    };
  }, [onDetail, session, sessionId]);
}
