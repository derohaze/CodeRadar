import { afterEach, describe, expect, it, vi } from "vitest";
import { explainFinding, getRepoHotspots } from "./security";

describe("security API error handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves backend detail messages for remediation failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({
        detail: "CodeRadar could not complete remediation analysis because the AI runtime was temporarily unavailable. Retry shortly.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      explainFinding({
        sessionId: "session-1",
        findingId: "finding-1",
      }),
    ).rejects.toThrow(
      "CodeRadar could not complete remediation analysis because the AI runtime was temporarily unavailable. Retry shortly.",
    );
  });

  it("falls back to the HTTP status message when the response body is not usable", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockRejectedValue(new Error("invalid json")),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      explainFinding({
        sessionId: "session-1",
        findingId: "finding-1",
      }),
    ).rejects.toThrow("Request failed with status 503");
  });

  it("maps repo hotspot feed responses into frontend-friendly items", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue("application/json"),
      },
      json: vi.fn().mockResolvedValue({
        items: [
          {
            session_id: "session-1",
            repo: "secure-scan-studio-main",
            hotspot_class: "identity-zone",
            priority: "critical",
            label: "Critical identity zone",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getRepoHotspots()).resolves.toEqual([
      {
        sessionId: "session-1",
        repo: "secure-scan-studio-main",
        hotspotClass: "identity-zone",
        priority: "critical",
        label: "Critical identity zone",
      },
    ]);
  });

});
