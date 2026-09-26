import { fetchWithStartupRetry } from "@/shared/api/network";

/**
 * The transport to the local review API: where it is, how a call is authorised,
 * and what a failure looks like. It knows nothing about findings, sessions or
 * providers — that is the endpoints' job.
 */

// The desktop app runs the review engine in its own main process and hands the
// renderer the address it bound. The environment variable and the fallback stay
// for a renderer served outside Electron, where nothing is listening anyway.
const API_BASE_URL =
  (typeof window !== "undefined" ? window.electronAPI?.apiBaseUrl ?? null : null) ??
  import.meta.env.VITE_API_BASE_URL ??
  "http://127.0.0.1:9000/api/v1";

// The local API reads the user's source tree and can send it to a model
// provider, so it refuses anything that cannot present the launch token. It is
// never persisted; the main process regenerates it on every start.
const API_TOKEN = typeof window !== "undefined" ? window.electronAPI?.apiToken ?? null : null;

/** Absolute URL of a route on the local engine. */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

/**
 * The launch token as a query parameter.
 *
 * Only for `EventSource`, which cannot send headers. Every other route carries
 * the token in `X-CodeRadar-Token`.
 */
export function tokenQuery(): string {
  return API_TOKEN === null ? "" : `?token=${encodeURIComponent(API_TOKEN)}`;
}

/**
 * A request the API refused, carrying the status it answered with.
 *
 * The status is kept because two failures with the same text are not the same
 * problem: a 409 from the review API means one review is already running and has
 * a way out the caller can offer, while a 400 has nothing to offer.
 */
export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithStartupRetry(`${API_BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(API_TOKEN === null ? {} : { "X-CodeRadar-Token": API_TOKEN }),
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (error) {
    console.error("[CodeRadar] Network request failed", {
      path,
      method: init?.method ?? "GET",
      error,
    });
    throw error;
  }

  if (!response.ok) {
    const fallback = `Request failed with status ${response.status}`;
    let body: { detail?: string } | null = null;
    try {
      body = (await response.json()) as { detail?: string };
    } catch {
      body = null;
    }

    console.error("[CodeRadar] API request failed", {
      path,
      method: init?.method ?? "GET",
      status: response.status,
      ...(body ? { body } : {}),
    });

    const message =
      typeof body?.detail === "string" && body.detail.trim().length > 0
        ? body.detail
        : fallback;
    throw new ApiRequestError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
