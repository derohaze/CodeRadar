import { afterEach, describe, expect, it, vi } from "vitest";
import { explainFinding, getRepoHotspots, getScanSession } from "./index";

describe("the report page address", () => {
  it("addresses one session's report and carries the launch token a page cannot send in a header", async () => {
    const original = window.electronAPI;
    vi.resetModules();
    window.electronAPI = {
      platform: "linux",
      versions: { node: "22.0.0", chrome: "130.0.0", electron: "41.0.0" },
      apiBaseUrl: "http://127.0.0.1:4321/api/v1",
      apiToken: "launch-token",
    };

    try {
      const { scanReportUrl } = await import("./endpoints/sessions");

      expect(scanReportUrl("session-1")).toBe(
        "http://127.0.0.1:4321/api/v1/scans/session-1/report?token=launch-token",
      );
      // An id is opaque and may need escaping; the path must survive it.
      expect(scanReportUrl("a/b c")).toBe(
        "http://127.0.0.1:4321/api/v1/scans/a%2Fb%20c/report?token=launch-token",
      );
    } finally {
      window.electronAPI = original;
    }
  });
});

describe("review API error handling", () => {
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

  it("maps a dropped candidate with the comparison that refused it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue("application/json"),
      },
      json: vi.fn().mockResolvedValue({
        session: { id: "session-1", candidate_findings_count: 1 },
        issues: { critical: 0, high: 0, medium: 0, low: 0 },
        findings: [],
        candidate_findings: [],
        rejected_candidates: [
          {
            title: "Missing null check on user.address",
            file: "src/user-profile.ts",
            line: 27,
            line_end: 29,
            reason: "evidence-not-in-source",
            detail: "the quoted evidence does not appear in the reviewed file",
            diagnostics: {
              evidence: "Code: `city: user.address.city;`",
              quotes: ["city: user.address.city;"],
              quotes_found: [false],
              compared_file: "src/user-profile.ts",
              compared_chars: 1060,
              used_file_reference: false,
              axis: "correctness",
              severity: "high",
              confidence: 92,
            },
          },
        ],
        rejections_by_reason: { "evidence-not-in-source": 1 },
        verdict: "safe",
        completed_at: null,
        error_message: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const detail = await getScanSession("session-1");

    expect(detail.rejectedCandidates).toEqual([
      {
        title: "Missing null check on user.address",
        file: "src/user-profile.ts",
        line: 27,
        lineEnd: 29,
        reason: "evidence-not-in-source",
        detail: "the quoted evidence does not appear in the reviewed file",
        diagnostics: {
          evidence: "Code: `city: user.address.city;`",
          quotes: ["city: user.address.city;"],
          quotesFound: [false],
          comparedFile: "src/user-profile.ts",
          comparedChars: 1060,
          usedFileReference: false,
          axis: "correctness",
          severity: "high",
          confidence: 92,
        },
      },
    ]);
    expect(detail.rejectionsByReason).toEqual({ "evidence-not-in-source": 1 });
  });

  it("tolerates an engine that answers without dropped candidates", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue("application/json"),
      },
      json: vi.fn().mockResolvedValue({
        session: { id: "session-1", candidate_findings_count: 0 },
        issues: { critical: 0, high: 0, medium: 0, low: 0 },
        findings: [],
        candidate_findings: [],
        verdict: "safe",
        completed_at: null,
        error_message: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const detail = await getScanSession("session-1");

    expect(detail.rejectedCandidates).toEqual([]);
    expect(detail.rejectionsByReason).toEqual({});
  });
});
