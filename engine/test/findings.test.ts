import { describe, expect, it } from "bun:test";
import { createSourceFile, createSourceIndex } from "../src/core/repository/source.ts";
import { validateCandidate, findingId, isEvidenceAnchored } from "../src/core/findings/validate.ts";
import type { CandidateFinding } from "../src/core/findings/validate.ts";
import {
  CONFIDENCE_FLOOR,
  isExcludedConcern,
  normaliseAxis,
  normaliseSeverity,
  resolveSeverity,
} from "../src/core/findings/policy.ts";
import { dedupeFindings, tokenSimilarity } from "../src/core/findings/dedupe.ts";
import type { ReviewFinding } from "../src/core/findings/model.ts";

const LOOP_LINE = "  for (let i = 0; i <= items.length; i += 1) {";

const SOURCE = {
  "src/app.ts": [
    "export function sum(items: number[]): number {",
    LOOP_LINE,
    "    return items[i];",
    "  }",
    "}",
  ].join("\n"),
  // Twenty lines, so an over-wide anchor is rejected for its width rather than
  // for running past the end of the file.
  "src/long.ts": Array.from({ length: 20 }, (_value, index) => `const value${index} = ${index};`).join("\n"),
};

function indexOf(files: Record<string, string>) {
  return createSourceIndex(Object.entries(files).map(([path, content]) => createSourceFile(path, content)));
}

function candidateOf(overrides: Partial<CandidateFinding> = {}): CandidateFinding {
  return {
    file: "src/app.ts",
    line: 2,
    severity: "high",
    axis: "correctness",
    title: "Loop bound is inclusive of the collection length",
    problem: "The loop condition compares with <= against the collection length.",
    why: "Valid indices run from zero to length minus one, so the final read is one past the end.",
    impact: "The last iteration reads undefined and turns the accumulated total into NaN.",
    evidence: `src/app.ts:2 | \`${LOOP_LINE}\` | trigger: the loop reaches the final index | wrong result: the read returns undefined`,
    confidence: 90,
    fix: "Use < instead of <= in the loop condition.",
    ...overrides,
  };
}

describe("validateCandidate", () => {
  const index = indexOf(SOURCE);

  it("accepts a candidate whose evidence is in the reviewed file", () => {
    const outcome = validateCandidate(candidateOf(), index, { origin: "detector" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.finding.severity).toBe("high");
    expect(outcome.finding.location.file).toBe("src/app.ts");
    expect(outcome.finding.location.line).toBe(2);
    expect(outcome.finding.location.lineEnd).toBe(2);
    expect(outcome.finding.schema).toBe("codeguard.review.findings.v1");
    expect(outcome.finding.suggestedPatch).toBeNull();
  });

  it("rejects a candidate that is missing a required field", () => {
    const outcome = validateCandidate(candidateOf({ evidence: "" }), index, { origin: "ai" });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.reason).toBe("missing-field");
  });

  it("rejects one-word filler", () => {
    const outcome = validateCandidate(candidateOf({ problem: "Bad" }), index, { origin: "ai" });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.reason).toBe("too-short");
  });

  it("rejects a preference dressed up as a defect", () => {
    const outcome = validateCandidate(
      candidateOf({ title: "Consider extracting this loop into a helper" }),
      index,
      { origin: "ai" },
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.reason).toBe("excluded-concern");
  });

  it("rejects a candidate filed under a non-reviewable axis", () => {
    const outcome = validateCandidate(candidateOf({ axis: "style" }), index, { origin: "ai" });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.reason).toBe("excluded-concern");
  });

  it("rejects a claim below the confidence floor", () => {
    const outcome = validateCandidate(candidateOf({ confidence: CONFIDENCE_FLOOR - 1 }), index, { origin: "ai" });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.reason).toBe("low-confidence");
  });

  it("rejects an anchor past the end of the file", () => {
    const outcome = validateCandidate(candidateOf({ line: 500, lineEnd: 500 }), index, { origin: "ai" });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.reason).toBe("line-out-of-range");
  });

  it("rejects an anchor wider than the bar allows", () => {
    // Four lines is inside the ten-line limit and is accepted.
    const allowed = validateCandidate(
      candidateOf({
        file: "src/long.ts",
        line: 1,
        lineEnd: 4,
        evidence: "src/long.ts:1 | `const value0 = 0;` | anchor spans four lines",
      }),
      index,
      { origin: "ai" },
    );
    expect(allowed.ok).toBe(true);

    const wide = validateCandidate(
      candidateOf({
        file: "src/long.ts",
        line: 1,
        lineEnd: 12,
        evidence: "src/long.ts:1 | `const value0 = 0;` | anchor spans twelve lines",
      }),
      index,
      { origin: "ai" },
    );
    expect(wide.ok).toBe(false);
    if (wide.ok) return;
    expect(wide.rejected.reason).toBe("line-out-of-range");
  });

  it("rejects a finding against a file that was never reviewed", () => {
    const outcome = validateCandidate(candidateOf({ file: "src/ghost.ts" }), index, { origin: "ai" });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.reason).toBe("file-not-in-scope");
  });

  it("rejects evidence the model invented", () => {
    const outcome = validateCandidate(
      candidateOf({
        evidence: "src/app.ts:2 | `const deadline = expiresAt.getTime();` | the session is stale",
      }),
      index,
      { origin: "ai" },
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.reason).toBe("evidence-not-in-source");
  });

  it("rejects a critical claim on an axis that cannot be critical", () => {
    const outcome = validateCandidate(
      candidateOf({
        severity: "critical",
        axis: "docs",
        line: 1,
        lineEnd: 1,
        evidence: `src/app.ts:1 | \`export function sum(items: number[]): number {\` | the summary is wrong`,
      }),
      index,
      { origin: "ai" },
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.reason).toBe("severity-not-supported");
  });

  it("lowers a severity the confidence cannot support", () => {
    const outcome = validateCandidate(candidateOf({ severity: "critical", confidence: 60 }), index, {
      origin: "ai",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 60 clears the floor but cannot carry `critical`, so it becomes medium.
    expect(outcome.finding.severity).toBe("medium");
  });

  it("rejects a diff-scoped anchor outside the changed lines", () => {
    const outcome = validateCandidate(candidateOf(), index, {
      origin: "detector",
      changedLines: new Set([4, 5]),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.reason).toBe("anchor-outside-changed-lines");
  });

  it("accepts a diff-scoped anchor inside the changed lines", () => {
    const outcome = validateCandidate(candidateOf(), index, {
      origin: "detector",
      changedLines: new Set([2, 3]),
    });

    expect(outcome.ok).toBe(true);
  });

  it("matches evidence despite indentation differences", () => {
    const outcome = validateCandidate(
      candidateOf({ evidence: "src/app.ts:2 | `for (let i = 0; i <= items.length; i += 1) {` | quoted without indent" }),
      index,
      { origin: "ai" },
    );

    expect(outcome.ok).toBe(true);
  });
});

describe("isEvidenceAnchored", () => {
  const file = createSourceFile("src/app.ts", SOURCE["src/app.ts"]);

  it("accepts a quote that exists in the file", () => {
    expect(isEvidenceAnchored("see `return items[i];` for the read", file)).toBe(true);
  });

  it("rejects a quote that does not exist in the file", () => {
    expect(isEvidenceAnchored("see `const deadline = now + ttl;` for the read", file)).toBe(false);
  });

  it("accepts prose that names the reviewed file", () => {
    expect(isEvidenceAnchored("the defect is in src/app.ts on line 2", file)).toBe(true);
  });

  it("rejects prose that names nothing verifiable", () => {
    expect(isEvidenceAnchored("this is clearly wrong", file)).toBe(false);
  });
});

describe("policy", () => {
  it("normalises severity aliases and rejects nonsense", () => {
    expect(normaliseSeverity("Blocker")).toBe("critical");
    expect(normaliseSeverity("warning")).toBe("medium");
    expect(normaliseSeverity("catastrophic")).toBeNull();
  });

  it("normalises axis aliases and refuses preference axes", () => {
    expect(normaliseAxis("bug")).toBe("correctness");
    expect(normaliseAxis("error handling")).toBe("error-handling");
    expect(normaliseAxis("style")).toBeNull();
    expect(normaliseAxis("nitpick")).toBeNull();
  });

  it("recognises preference language", () => {
    expect(isExcludedConcern("Consider extracting this into a helper")).toBe(true);
    expect(isExcludedConcern("The variable naming could be clearer")).toBe(true);
    expect(isExcludedConcern("Iteration runs one past the end of the array")).toBe(false);
  });

  it("never raises a severity above what confidence supports", () => {
    expect(resolveSeverity("low", 99)).toBe("low");
    expect(resolveSeverity("critical", 90)).toBe("critical");
    expect(resolveSeverity("critical", 60)).toBe("medium");
    expect(resolveSeverity("high", 55)).toBe("medium");
  });
});

describe("findingId", () => {
  it("is stable for the same defect", () => {
    expect(findingId("src/app.ts", 2, "Loop bound is inclusive")).toBe(
      findingId("src/app.ts", 2, "Loop bound is inclusive"),
    );
  });

  it("separates different defects", () => {
    expect(findingId("src/app.ts", 2, "One")).not.toBe(findingId("src/app.ts", 3, "One"));
  });

  it("treats path separators consistently", () => {
    expect(findingId("src\\app.ts", 2, "One")).toBe(findingId("src/app.ts", 2, "One"));
  });
});

function findingOf(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  const base: ReviewFinding = {
    id: "f-00000001",
    schema: "codeguard.review.findings.v1",
    severity: "high",
    axis: "correctness",
    title: "Loop bound is inclusive of the collection length",
    location: { file: "src/app.ts", line: 10, lineEnd: 10 },
    problem: "problem text long enough to pass",
    why: "why text long enough to pass the bar",
    impact: "impact text long enough",
    evidence: "src/app.ts:10 | `for (...) {`",
    confidence: 80,
    fix: "use < instead of <=",
    suggestedPatch: null,
    suggestedTest: null,
    origin: "detector",
  };
  return { ...base, ...overrides };
}

describe("dedupeFindings", () => {
  it("merges the same defect reported twice and keeps the stronger claim", () => {
    const weak = findingOf({ id: "f-weak", severity: "medium", confidence: 60 });
    const strong = findingOf({
      id: "f-strong",
      severity: "high",
      confidence: 90,
      location: { file: "src/app.ts", line: 11, lineEnd: 11 },
    });

    const result = dedupeFindings([weak, strong]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.id).toBe("f-strong");
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.reason).toBe("merged-duplicate");
  });

  it("keeps distinct defects on nearby lines", () => {
    const first = findingOf({ id: "f-1", title: "Expired session is accepted after renewal" });
    const second = findingOf({
      id: "f-2",
      title: "Credential is written to the log file",
      location: { file: "src/app.ts", line: 12, lineEnd: 12 },
    });

    expect(dedupeFindings([first, second]).findings).toHaveLength(2);
  });

  it("keeps the same wording in different files", () => {
    const first = findingOf({ id: "f-1" });
    const second = findingOf({ id: "f-2", location: { file: "src/other.ts", line: 10, lineEnd: 10 } });

    expect(dedupeFindings([first, second]).findings).toHaveLength(2);
  });

  it("produces the same result whatever the input order", () => {
    const weak = findingOf({ id: "f-weak", severity: "medium", confidence: 60 });
    const strong = findingOf({ id: "f-strong", severity: "high", confidence: 90 });

    const forward = dedupeFindings([weak, strong]).findings.map((finding) => finding.id);
    const backward = dedupeFindings([strong, weak]).findings.map((finding) => finding.id);

    expect(forward).toEqual(backward);
  });

  it("fills an empty patch from the merged duplicate without promoting its prose", () => {
    const withoutPatch = findingOf({ id: "f-keep", suggestedPatch: null });
    const withPatch = findingOf({ id: "f-drop", severity: "low", suggestedPatch: "--- a/x\n+++ b/x" });

    const result = dedupeFindings([withoutPatch, withPatch]);

    expect(result.findings[0]?.id).toBe("f-keep");
    expect(result.findings[0]?.suggestedPatch).toBe("--- a/x\n+++ b/x");
  });

  it("scores short descriptions against longer ones", () => {
    expect(tokenSimilarity("expired session accepted", "an expired session is still accepted")).toBeGreaterThan(0.5);
    expect(tokenSimilarity("expired session accepted", "credential written to log")).toBeLessThan(0.3);
  });
});
