/**
 * Fixture: correct code.
 *
 * Every construct here is the near-miss of a detector's pattern. The numeric
 * array is sorted with a comparator, and the loop bound is exclusive. A finding
 * in this file is a false positive, and a false positive is the failure mode
 * this fixture exists to catch.
 */

export interface Session {
  id: string;
  expiresAt: number;
}

export function isExpired(session: Session, now: number): boolean {
  return session.expiresAt <= now;
}

export function sortByExpiry(sessions: readonly Session[]): number[] {
  const totals: number[] = sessions.map((session) => session.expiresAt);
  totals.sort((a, b) => a - b);
  return totals;
}

export function countActive(sessions: readonly Session[], now: number): number {
  let count = 0;
  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];
    if (session !== undefined && !isExpired(session, now)) count += 1;
  }
  return count;
}

export function describeSession(session: Session): string {
  return `session ${session.id} expires at ${session.expiresAt}`;
}
