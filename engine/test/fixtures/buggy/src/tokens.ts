/** Fixture: intentionally buggy. Review input for the engine's own tests. */

export function createResetToken(): string {
  const token = Math.random().toString(36).slice(2);
  return token;
}
