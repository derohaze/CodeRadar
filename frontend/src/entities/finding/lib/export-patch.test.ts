import { describe, expect, it } from "vitest";
import { buildPatchExportBundle } from "./export-patch";

describe("buildPatchExportBundle", () => {
  it("builds a grounded export bundle from the applied patch snapshot", () => {
    const bundle = buildPatchExportBundle({
      finding: {
        id: "finding-1",
        severity: "high",
        title: "Dynamic request URL may allow SSRF",
        file: "src/lib/api/admin/chat.ts",
        line: 12,
        lineEnd: 13,
        category: "SSRF",
        confidence: 86,
        summary: "summary",
        impact: "impact",
        explanation: "explanation",
        evidence: "evidence",
        attackSimulation: { input: "input", execution: "execution", result: "result" },
        auditLog: [],
        fixSuggestions: [],
        remediationStatus: "verified_partial",
        approvalStatus: "not_required",
        approvalHistory: [],
        appliedStrategyId: "strategy-1",
        remediationNotes: [],
        attemptedStrategyIds: [],
        decisionSummary: null,
      },
      action: {
        findingId: "finding-1",
        status: "applied",
        file: "src/lib/api/admin/chat.ts",
        appliedStrategyId: "strategy-1",
        fixType: "full_fix",
        validationNotes: [],
        manualEditApplied: false,
        checkpointId: "cp-1",
        rollbackAvailable: true,
        verificationStatus: "manual_review_required",
        verificationNotes: ["Destination validation still requires manual review."],
        verificationConfidence: null,
        verificationConfidenceValid: false,
        approvalGateOutcome: "review-required",
        approvalGateReason: "The local patch was applied, but deterministic verification still requires human review before closure.",
        writeScope: "src/lib/api/admin/chat.ts",
        networkPolicy: "Patch apply and rollback do not call external services.",
      },
      snapshot: {
        file: "src/lib/api/admin/chat.ts",
        diff: "@@ remediation diff @@\n-old\n+new",
        beforeSnippet: "old",
        afterSnippet: "new",
        strategyId: "strategy-1",
        strategyLabel: "Validate destination host",
        fixType: "full_fix",
        summary: "Move destination validation to the request boundary.",
        rationale: "Trusted host validation is enforced before the outbound request.",
        residualRisks: ["Service allowlisting should still be reviewed."],
        manualEdit: false,
        mode: "single",
      },
    });

    expect(bundle.patchFileName).toContain("dynamic-request-url-may-allow-ssrf");
    expect(bundle.patchText).toContain("+new");
    expect(bundle.summaryText).toContain("Validate destination host");
    expect(bundle.summaryText).toContain("Manual review required after workspace apply");
    expect(bundle.summaryText).toContain("Approval gate: review-required");
    expect(bundle.summaryText).toContain("Destination validation still requires manual review.");
  });
});
