import { describe, expect, it } from "vitest";
import type { Finding } from "@/entities/finding/model/types";
import { orderFindingsByDecisionPriority } from "@/entities/finding/lib/finding-triage";

function buildFinding(id: string, triageRank: number, riskScore: number, severity: Finding["severity"] = "high"): Finding {
  return {
    id,
    severity,
    title: id,
    file: "src/app.ts",
    line: 1,
    lineEnd: 1,
    category: "SQL injection",
    confidence: 80,
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
    decisionSummary: {
      validationLabel: "Validated finding",
      validationNote: "note",
      riskScore,
      riskLabel: "risk",
      triageBand: "band",
      triageRank,
      executionDisposition: "disp",
      approvalState: "approval",
      policyOutcome: "review-required",
      policyReason: "reason",
      stopState: "hold-for-review",
      applyReadiness: "approval-required-before-apply",
      escalationState: "required",
      policySummary: {
        posture: "review",
        label: "Review-controlled path",
        summary: "Approval is required.",
        autoPathState: "gated",
        humanPathState: "approval-required",
        nextControl: "collect-approval",
      },
      residualRiskState: "risk",
      recommendedAction: "action",
      fixRecommendation: "fix",
      approvalPath: "path",
      approvalAuditSummary: {
        status: "pending",
        label: "Approval pending",
        summary: "Awaiting review.",
        note: "Waiting for review.",
        timestamp: null,
        resolutionCategory: "awaiting-review",
        source: "approval-queue",
      },
      riskFactors: [],
    },
  };
}

describe("orderFindingsByDecisionPriority", () => {
  it("prefers lower triage rank before higher risk score", () => {
    const ordered = orderFindingsByDecisionPriority([
      buildFinding("priority-2", 2, 70),
      buildFinding("priority-1", 1, 60),
      buildFinding("priority-3", 3, 95),
    ]);

    expect(ordered.map((item) => item.id)).toEqual(["priority-1", "priority-2", "priority-3"]);
  });

  it("falls back to risk score within the same triage rank", () => {
    const ordered = orderFindingsByDecisionPriority([
      buildFinding("lower-score", 4, 75),
      buildFinding("higher-score", 4, 88),
    ]);

    expect(ordered.map((item) => item.id)).toEqual(["higher-score", "lower-score"]);
  });
});
