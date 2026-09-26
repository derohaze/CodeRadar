/**
 * Reading a request body whose shape nothing has vouched for.
 *
 * The renderer's wire format is the reference, but a request arrives as text: no
 * field is assumed to exist, and none is trusted to have the right type. Each
 * route coerces the fields it needs and refuses what does not survive.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-empty trimmed string, or null. Never a number, never whitespace. */
export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
