/**
 * The review sessions of this run, and how one becomes wire data.
 *
 * A session is per run: nothing outlives the app, by design, which is why this
 * is an in-memory map and not a store with a file behind it. It holds no state a
 * transport owns — a session is what a review produced, not what a request did.
 *
 * Every read of a record for the wire goes through `detailFor`, so the renderer
 * sees one shape whether the detail arrived from a route or from the stream.
 */

import { randomUUID } from "node:crypto";
import type { ReviewReport } from "../../core/findings/model.ts";
import type { ReviewEvent } from "../../core/ports.ts";
import { reviewPhaseForEvent } from "../../core/review/policy.ts";
import {
  buildWireScanDetail,
  buildWireSession,
  type WirePreset,
  type WireScanDetail,
  type WireScanMode,
  type WireSessionStatus,
} from "../api-contract.ts";

/** Session history is per run: nothing outlives the app, by design. */
const MAX_SESSIONS = 100;

/** How much progress history one session keeps. The tail is what a user reads. */
const MAX_PROGRESS_LOGS = 200;

export interface SessionRecord {
  id: string;
  sourcePath: string;
  targetType: "file" | "folder";
  preset: WirePreset;
  scanMode: WireScanMode;
  status: WireSessionStatus;
  progress: number;
  phaseProgress: number;
  currentPhase: string;
  progressMessage: string;
  progressLogs: string[];
  createdAt: string;
  completedAt: string | null;
  elapsedSeconds: number;
  report: ReviewReport | null;
  errorMessage: string | null;
  /**
   * Aborts this session's review, whether it is running or still waiting for a
   * turn. Owned here rather than by the service because the unit a user cancels is
   * a session: a review queued behind another one has no service-side signal yet.
   */
  readonly abort: AbortController;
  /** Live event streams watching this session. Each is called with every detail. */
  subscribers: Set<(detail: WireScanDetail) => void>;
}

/** What a new session starts from: the caller's choice of scope and width. */
export interface SessionSeed {
  sourcePath: string;
  targetType: "file" | "folder";
  preset: WirePreset;
  scanMode: WireScanMode;
}

export interface SessionStore {
  /** Registers a session in its starting state, and keeps the history bounded. */
  create(seed: SessionSeed): SessionRecord;
  get(id: string): SessionRecord | undefined;
  /** Insertion order, oldest first — the order reviews were started in. */
  list(): SessionRecord[];
  /** The sessions that produced a report. The only ones with anything to report. */
  completed(): SessionRecord[];
  remove(id: string): void;
  clear(): void;
  /** Drops every live stream without touching history; the server is closing. */
  detachSubscribers(): void;
  /** The record as the wire contract reads it. */
  detailFor(record: SessionRecord): WireScanDetail;
  /** Applies one review event to a record's progress. */
  applyEvent(record: SessionRecord, event: ReviewEvent): void;
  /** Pushes a record to everyone watching it. `terminal` closes their streams. */
  publish(record: SessionRecord, terminal: boolean): void;
}

export function createSessionStore(): SessionStore {
  const sessions = new Map<string, SessionRecord>();

  function detailFor(record: SessionRecord): WireScanDetail {
    const session = buildWireSession(
      {
        id: record.id,
        report: record.report ?? ({} as ReviewReport),
        sourcePath: record.sourcePath,
        targetType: record.targetType,
        preset: record.preset,
        scanMode: record.scanMode,
        createdAt: record.createdAt,
        completedAt: record.completedAt,
        elapsedSeconds: record.elapsedSeconds,
        progress: record.progress,
        phaseProgress: record.phaseProgress,
        currentPhase: record.currentPhase,
        progressMessage: record.progressMessage,
        progressLogs: record.progressLogs,
        status: record.status,
        errorMessage: record.errorMessage,
      },
      record.report,
    );
    return buildWireScanDetail(session, record.report, record.errorMessage);
  }

  function publish(record: SessionRecord, terminal: boolean): void {
    const detail = detailFor(record);
    for (const subscriber of [...record.subscribers]) {
      try {
        subscriber(detail);
      } catch {
        record.subscribers.delete(subscriber);
      }
    }
    if (terminal) record.subscribers.clear();
  }

  function applyEvent(record: SessionRecord, event: ReviewEvent): void {
    const stage = reviewPhaseForEvent(event.type);
    if (stage !== undefined) {
      // Reviews report a stage per event, and several stages report the same
      // phase. Progress only ever moves forward so the bar cannot jump back.
      if (stage.progress > record.progress) {
        record.progress = stage.progress;
        record.phaseProgress = stage.progress;
      }
      record.currentPhase = stage.phase;
    }

    if (event.message !== "") {
      record.progressMessage = event.message;
      record.progressLogs.push(event.message);
      if (record.progressLogs.length > MAX_PROGRESS_LOGS) {
        record.progressLogs.splice(0, record.progressLogs.length - MAX_PROGRESS_LOGS);
      }
    }

    publish(record, false);
  }

  return {
    create(seed: SessionSeed): SessionRecord {
      const now = new Date().toISOString();
      const record: SessionRecord = {
        id: randomUUID(),
        sourcePath: seed.sourcePath,
        targetType: seed.targetType,
        preset: seed.preset,
        scanMode: seed.scanMode,
        // A session starts life waiting: the engine reviews one target at a time,
        // so being accepted is not the same as being started.
        status: "queued",
        progress: 0,
        phaseProgress: 0,
        currentPhase: "Queued",
        progressMessage: "Waiting for a free review slot",
        progressLogs: ["Waiting for a free review slot"],
        abort: new AbortController(),
        createdAt: now,
        completedAt: null,
        elapsedSeconds: 0,
        report: null,
        errorMessage: null,
        subscribers: new Set(),
      };

      sessions.set(record.id, record);
      if (sessions.size > MAX_SESSIONS) {
        const oldest = sessions.keys().next().value;
        if (oldest !== undefined) sessions.delete(oldest);
      }
      return record;
    },

    get: (id: string) => sessions.get(id),
    list: () => [...sessions.values()],
    completed: () => [...sessions.values()].filter((record) => record.report !== null),
    remove: (id: string) => void sessions.delete(id),
    clear: () => sessions.clear(),
    detachSubscribers: () => {
      for (const record of sessions.values()) record.subscribers.clear();
    },
    detailFor,
    applyEvent,
    publish,
  };
}
