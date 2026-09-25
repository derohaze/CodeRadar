/**
 * Outbound URL policy for provider endpoints.
 *
 * A provider base URL is user input that the app will make authenticated
 * requests to, so it is a server-side request forgery primitive unless it is
 * checked. Three rules, in order of how easily they are missed:
 *
 * - `https` is required for anything that is not the local machine, because an
 *   API key is sent on every request and `http` puts it on the wire in clear.
 * - Credentials must not be embedded in the URL: they end up in logs, in proxy
 *   history, and in the error text this app shows.
 * - Private and link-local addresses are refused. A user typing
 *   `http://169.254.169.254/v1` is either probing the host or has been talked
 *   into it, and neither is a review configuration.
 *
 * Loopback stays allowed on purpose: a local model server (Ollama, llama.cpp,
 * vLLM) is a first-class way to run a local-first review tool.
 */

export class OutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundUrlError";
  }
}

function isLoopbackHost(host: string): boolean {
  const normalised = host.toLowerCase();
  if (normalised === "localhost" || normalised.endsWith(".localhost")) return true;
  if (normalised === "127.0.0.1" || normalised === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalised);
}

/** RFC 1918 ranges, link-local, and IPv6 unique-local plus link-local. */
function isPrivateAddress(host: string): boolean {
  const normalised = host.toLowerCase().replace(/^\[|\]$/g, "");

  if (normalised.includes(":")) {
    if (normalised === "::" || normalised === "::1") return true;
    return /^f[cd][0-9a-f]{2}:/i.test(normalised) || /^fe[89ab][0-9a-f]:/i.test(normalised);
  }

  const octets = normalised.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    return false;
  }

  const [first, second] = octets;
  if (first === 10 || first === 127 || first === 0) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 169 && second === 254) return true;
  return false;
}

/**
 * Validates a base URL and returns it without a trailing slash, ready to have a
 * path appended. Throws `OutboundUrlError` with a message safe to show a user.
 */
export function assertAllowedOutboundUrl(rawUrl: string): { url: string; host: string } {
  const trimmed = rawUrl.trim();
  if (trimmed === "") {
    throw new OutboundUrlError("No base URL is configured for this provider.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new OutboundUrlError("The base URL is not a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new OutboundUrlError(`The base URL must use https, not ${parsed.protocol.replace(":", "")}.`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new OutboundUrlError("The base URL must not embed credentials.");
  }

  const host = parsed.hostname;
  if (parsed.protocol === "http:" && !isLoopbackHost(host)) {
    throw new OutboundUrlError("A non-local provider must use https.");
  }
  if (isPrivateAddress(host) && !isLoopbackHost(host)) {
    throw new OutboundUrlError("The base URL points at a private address, which is not allowed.");
  }

  return { url: trimmed.replace(/\/+$/, ""), host };
}
