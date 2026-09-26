import { describe, expect, it } from "vitest";
import type { Finding } from "@/entities/finding/model/types";
import { buildApprovalQueue } from "@/entities/finding/lib/approval-queue";

function buildFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding-1",
    severity: "high",
    title: "Dynamic query construction may allow injection",
    file: "app/features/login/router.py",
    line: 43,
    lineEnd: 44,
    category: "SQL injection",
    confidence: 82,
    summary: "summary",
    impact: "impact",
    explanation: "explanation",
    evidence: "evidence",
    attackSimulation: {
      input: "input",
      execution: "execution",
      result: "result",
    },
    auditLog: [],
    fixSuggestions: [],
    remediationStatus: "open",
    approvalStatus: "not_required",
    approvalHistory: [],
    appliedStrategyId: null,
    remediationNotes: [],
    attemptedStrategyIds: [],
    decisionSummary: null,
    ...overrides,
  };
}

describe("buildApprovalQueue", () => {
  it("includes patch-generated findings as ready for approval", () => {
    const queue = buildApprovalQueue([
      buildFinding({
        remediationStatus: "patch_generated",
      }),
    ]);

    expect(queue).toHaveLength(1);
    expect(queue[0].statusLabel).toBe("Ready for approval");
    expect(queue[0].nextActionLabel).toBe("Resume patch review");
  });

  it("keeps partial verification findings in the queue", () => {
    const queue = buildApprovalQueue([
      buildFinding({
        remediationStatus: "verified_partial",
      }),
    ]);

    expect(queue[0].statusLabel).toBe("Verification review");
    expect(queue[0].nextActionLabel).toBe("Open verification");
  });

  it("flags open session findings that touch auth or session logic", () => {
    const queue = buildApprovalQueue([
      buildFinding({
        category: "Session misuse",
      }),
    ]);

    expect(queue[0].statusLabel).toBe("Approval required");
    expect(queue[0].nextActionLabel).toBe("Open finding");
  });

  it("omits already approved patch-generated findings from the approval queue", () => {
    const queue = buildApprovalQueue([
      buildFinding({
        remediationStatus: "patch_generated",
        decisionSummary: {
          validationLabel: "Validated finding",
          validationNote: "Validated note",
          riskScore: 72,
          riskLabel: "Needs remediation",
          triageBand: "Priority 2",
          triageRank: 3,
          executionDisposition: "Patch review in progress",
          approvalState: "Approved for workspace apply",
          policyOutcome: "auto-eligible",
          policyReason: "Approved.",
          stopState: "continue-remediation",
          applyReadiness: "local-apply-eligible",
          escalationState: "none",
          policySummary: {
            posture: "allow",
            label: "Approved within policy",
            summary: "Stored approval exists.",
            autoPathState: "eligible",
            humanPathState: "approved-review-cycle",
            nextControl: "proceed-with-workspace-apply",
          },
          residualRiskState: "Risk remains active until a verified remediation is applied",
          recommendedAction: "Apply in the selected workspace.",
          fixRecommendation: "Use a sink fix.",
          approvalPath: "Approved path.",
          approvalAuditSummary: {
            status: "approved",
            label: "Approval resolved",
            summary: "Stored approval exists.",
            note: "Approved for the current review cycle.",
            timestamp: "2026-04-12T00:00:00Z",
            resolutionCategory: "resolved",
            source: "approval-controller",
          },
          riskFactors: [],
        },
      }),
    ]);

    expect(queue).toHaveLength(0);
  });

  it("keeps approval-rejected patch-generated findings in the queue", () => {
    const queue = buildApprovalQueue([
      buildFinding({
        remediationStatus: "patch_generated",
        decisionSummary: {
          validationLabel: "Validated finding",
          validationNote: "Validated note",
          riskScore: 88,
          riskLabel: "Immediate attention",
          triageBand: "Priority 1",
          triageRank: 2,
          executionDisposition: "Review patch before any apply",
          approvalState: "Rejected during approval review",
          policyOutcome: "review-required",
          policyReason: "Rejected.",
          stopState: "hold-for-review",
          applyReadiness: "approval-required-before-apply",
          escalationState: "none",
          policySummary: {
            posture: "review",
            label: "Review-controlled path",
            summary: "Approval is required.",
            autoPathState: "gated",
            humanPathState: "approval-required",
            nextControl: "collect-approval",
          },
          residualRiskState: "Risk remains active until a verified remediation is applied",
          recommendedAction: "Retry.",
          fixRecommendation: "Use a sink fix.",
          approvalPath: "Rejected path.",
          approvalAuditSummary: {
            status: "rejected",
            label: "Approval rejected",
            summary: "Approval was rejected.",
            note: "Rejected during review.",
            timestamp: "2026-04-12T00:00:00Z",
            resolutionCategory: "rejected",
            source: "approval-controller",
          },
          riskFactors: [],
        },
      }),
    ]);

    expect(queue[0].statusLabel).toBe("Approval rejected");
    expect(queue[0].nextActionLabel).toBe("Resume patch review");
  });
});
