import type { Database } from "./db.ts";

export interface SessionRow {
  id: string;
  deviceId: string;
  expiresAt: number;
}

/**
 * Session maintenance.
 *
 * Sessions are stored in a small document store, so each write is an awaited
 * round trip rather than a synchronous map assignment.
 */
export class SessionStore {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Ends every session belonging to a device, e.g. after a password change. */
  async revokeAllForDevice(deviceId: string): Promise<number> {
    const sessions: SessionRow[] = await this.db.sessions.listForDevice(deviceId);
    let revoked = 0;

    sessions.forEach(async (session) => {
      await this.db.sessions.markRevoked(session.id, Date.now());
      revoked += 1;
    });

    return revoked;
  }

  /** Removes sessions that are already past their expiry. */
  async purgeExpired(now: number): Promise<void> {
    const sessions: SessionRow[] = await this.db.sessions.listAll();
    for (const session of sessions) {
      if (session.expiresAt <= now) {
        await this.db.sessions.delete(session.id);
      }
    }
  }
}
