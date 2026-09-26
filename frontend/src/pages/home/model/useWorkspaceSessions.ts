import { useCallback, useEffect, useState } from "react";
import { mergeSessionOrder } from "@/entities/session/lib/session-order";
import type { Session } from "@/entities/session/model/types";
import { deleteAllScanSessions, deleteScanSession, listSessions } from "@/shared/api";

/**
 * The saved reviews behind the workspace: the list, its manual order, and the
 * delete flow.
 *
 * The page owns what is *on screen*; this owns what is *saved*. The two meet in
 * one place: deleting the session the workspace is showing cannot leave the
 * workspace pointing at it, so the caller is told to reset itself.
 *
 * Nothing here writes UI feedback — `confirmDelete` reports what it deleted
 * (and throws what failed) so the page keeps ownership of its own toasts.
 */

export type DeleteTarget = { type: "single"; session: Session } | { type: "all" };

/** Which delete a confirm actually performed. */
export type DeleteTargetKind = DeleteTarget["type"];

export interface WorkspaceSessionsOptions {
  /** The session the workspace is showing; deleting it also clears the workspace. */
  activeSessionId: string | null;
  /** Called when the session being shown was deleted, so the caller can drop its own state. */
  onActiveSessionRemoved: () => void;
}

export interface WorkspaceSessions {
  /** Every saved session, newest first as the API returns them. */
  sessions: Session[];
  /** User-chosen id order for the sidebar. */
  sessionOrder: string[];
  /** Inserts or replaces one session in the list, from a scan, an open, or the live stream. */
  mergeSessionSummary: (session: Session) => void;
  /** Folds a fresh list into the existing manual order. */
  syncSessionOrder: (nextSessions: Session[]) => void;
  /** The pending delete awaiting confirmation, or null when the dialog is closed. */
  deleteTarget: DeleteTarget | null;
  isDeleting: boolean;
  requestDeleteSession: (session: Session) => void;
  requestDeleteAllSessions: () => void;
  /** Closes the dialog without deleting; ignored while a delete is in flight. */
  dismissDeleteRequest: () => void;
  /** Runs the pending delete. Resolves with what was removed, or undefined if there was nothing to do. */
  confirmDelete: () => Promise<DeleteTargetKind | undefined>;
  reorderSessions: (ids: string[]) => void;
  /** Drops a session from the list and its order without calling the API. */
  forgetSession: (sessionId: string) => void;
}

export function useWorkspaceSessions({ activeSessionId, onActiveSessionRemoved }: WorkspaceSessionsOptions): WorkspaceSessions {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionOrder, setSessionOrder] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const mergeSessionSummary = useCallback((session: Session) => {
    setSessions((current) => {
      const existingIndex = current.findIndex((item) => item.id === session.id);
      if (existingIndex === -1) return [session, ...current];
      const next = [...current];
      next[existingIndex] = session;
      return next;
    });
  }, []);

  const syncSessionOrder = useCallback((nextSessions: Session[]) => {
    setSessionOrder((current) => mergeSessionOrder(current, nextSessions));
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const nextSessions = await listSessions();
      setSessions(nextSessions);
      syncSessionOrder(nextSessions);
    } catch (error) {
      console.error("[CodeRadar] Failed to refresh sessions", error);
      setSessions([]);
      setSessionOrder([]);
    }
  }, [syncSessionOrder]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const forgetSession = useCallback((sessionId: string) => {
    setSessions((current) => current.filter((item) => item.id !== sessionId));
    setSessionOrder((current) => current.filter((id) => id !== sessionId));
  }, []);

  const requestDeleteSession = useCallback((session: Session) => setDeleteTarget({ type: "single", session }), []);
  const requestDeleteAllSessions = useCallback(() => setDeleteTarget({ type: "all" }), []);

  const dismissDeleteRequest = useCallback(() => {
    if (!isDeleting) setDeleteTarget(null);
  }, [isDeleting]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || isDeleting) return undefined;
    setIsDeleting(true);
    try {
      if (deleteTarget.type === "single") {
        const removed = deleteTarget.session;
        await deleteScanSession(removed.id);
        forgetSession(removed.id);
        if (activeSessionId === removed.id) onActiveSessionRemoved();
        return "single" as const;
      }
      await deleteAllScanSessions();
      setSessions([]);
      setSessionOrder([]);
      onActiveSessionRemoved();
      return "all" as const;
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  }, [activeSessionId, deleteTarget, forgetSession, isDeleting, onActiveSessionRemoved]);

  const reorderSessions = useCallback((ids: string[]) => setSessionOrder(ids), []);

  return {
    sessions,
    sessionOrder,
    mergeSessionSummary,
    syncSessionOrder,
    deleteTarget,
    isDeleting,
    requestDeleteSession,
    requestDeleteAllSessions,
    dismissDeleteRequest,
    confirmDelete,
    reorderSessions,
    forgetSession,
  };
}
