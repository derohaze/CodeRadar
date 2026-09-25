import { describe, expect, it } from "bun:test";
import path from "node:path";
import { createNodeFileSystem } from "../src/adapters/node-fs.ts";
import { createStaticAiReviewer, parseReviewResponse } from "../src/core/review/ai-reviewer.ts";
import { ReviewEngine } from "../src/core/review/engine.ts";
import type { GitPort, ReviewEvent } from "../src/core/ports.ts";
import type { ReviewReport } from "../src/core/findings/model.ts";

const PROMPTS_DIR = path.join(import.meta.dir, "..", "prompts");
const FIXTURES = path.join(import.meta.dir, "fixtures");

interface EngineOptions {
  aiReviewer?: ReturnType<typeof createStaticAiReviewer>;
  git?: GitPort;
  changedOnly?: boolean;
  baseBranch?: string;
  events?: ReviewEvent[];
}

function engineFor(options: EngineOptions = {}): ReviewEngine {
  const events = options.events;
  return new ReviewEngine({
    fs: createNodeFileSystem(),
    promptsDir: PROMPTS_DIR,
    ...(options.aiReviewer !== undefined ? { aiReviewer: options.aiReviewer } : {}),
    ...(options.git !== undefined ? { git: options.git } : {}),
    ...(options.changedOnly !== undefined ? { changedOnly: options.changedOnly } : {}),
    ...(options.baseBranch !== undefined ? { baseBranch: options.baseBranch } : {}),
    ...(events !== undefined ? { onEvent: (event: ReviewEvent) => events.push(event) } : {}),
  });
}

function pairs(report: ReviewReport): string[] {
  return report.findings.map((finding) => `${finding.location.file}::${finding.detector ?? finding.origin}`);
}

/** Every defect the buggy fixture is built to contain. */
const EXPECTED_DEFECTS = [
  "src/collections.ts::js.off-by-one-loop-bound",
  "src/collections.ts::js.numeric-sort-without-comparator",
  "src/validation.ts::js.nan-comparison",
  "src/config.ts::js.hardcoded-secret",
  "src/data-access.ts::js.sql-string-interpolation",
  "src/render.ts::js.html-injection",
  "src/runner.ts::js.shell-command-interpolation",
  "src/tokens.ts::js.weak-random-secret",
  "py/reports.py::py.mutable-default-argument",
  "py/deploy.py::py.shell-command-interpolation",
];

describe("ReviewEngine over the buggy fixture", () => {
  const target = path.join(FIXTURES, "buggy");

  it("finds every planted defect, once each", async () => {
    const report = await engineFor().review({ target });

    expect(report.verdict).toBe("needs-attention");
    expect(pairs(report).sort()).toEqual([...EXPECTED_DEFECTS].sort());
    expect(report.findings.length).toBe(new Set(EXPECTED_DEFECTS).size);
  });

  it("reports findings strongest first", async () => {
    const report = await engineFor().review({ target });
    const order = ["critical", "high", "medium", "low"];
    const ranks = report.findings.map((finding) => order.indexOf(finding.severity));

    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("gives every finding evidence, a fix, and a real line anchor", async () => {
    const report = await engineFor().review({ target });

    for (const finding of report.findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.fix.length).toBeGreaterThan(0);
      expect(finding.location.line).toBeGreaterThan(0);
      expect(finding.location.lineEnd).toBeGreaterThanOrEqual(finding.location.line);
      expect(finding.confidence).toBeGreaterThanOrEqual(55);
      expect(finding.why.length).toBeGreaterThan(20);
    }
  });

  it("never reports a file it did not read", async () => {
    const report = await engineFor().review({ target });
    const reviewed = new Set(report.findings.map((finding) => finding.location.file));

    expect(reviewed.has("src/ghost.ts")).toBe(false);
    expect(report.stats.filesReviewed).toBeGreaterThan(0);
  });

  it("emits progress events that carry no source content", async () => {
    const events: ReviewEvent[] = [];
    await engineFor({ events }).review({ target });

    expect(events.map((event) => event.type)).toContain("discovery:done");
    expect(events.map((event) => event.type)).toContain("done");
    for (const event of events) {
      expect(event.message).not.toContain("Math.random");
      expect(event.message).not.toContain("sk-test");
    }
  });
});

describe("ReviewEngine over the clean fixture", () => {
  it("reports nothing for correct code", async () => {
    const report = await engineFor().review({ target: path.join(FIXTURES, "clean") });

    expect(report.verdict).toBe("approve");
    expect(report.findings).toEqual([]);
    expect(report.summary).toContain("no defect");
  });
});

describe("ReviewEngine and model output", () => {
  const cleanTarget = path.join(FIXTURES, "clean");

  it("drops a finding whose evidence is not in the file", async () => {
    const hallucination = {
      verdict: "needs-attention",
      summary: "The session module accepts expired sessions",
      findings: [
        {
          severity: "high",
          axis: "correctness",
          title: "Expired sessions can still be accepted",
          file: "src/session.ts",
          line: 1,
          line_end: 1,
          problem: "The expiration timestamp is read but never compared before the session is returned.",
          why: "Without the comparison an expired session remains usable.",
          impact: "A signed-out user keeps access.",
          evidence: "src/session.ts:1 | `const expiresAt = session.expiresAt;` | the value is never compared",
          confidence: 88,
          fix: "Reject the session when expiresAt <= now.",
        },
      ],
    };

    const report = await engineFor({ aiReviewer: createStaticAiReviewer(hallucination) }).review({
      target: cleanTarget,
    });

    expect(report.findings).toEqual([]);
    expect(report.rejected.some((entry) => entry.reason === "evidence-not-in-source")).toBe(true);
  });

  it("keeps a model finding that proves itself against the file", async () => {
    const grounded = {
      verdict: "needs-attention",
      summary: "The expiry comparison is inverted",
      findings: [
        {
          severity: "high",
          axis: "correctness",
          title: "Expiry comparison treats a live session as expired",
          file: "src/session.ts",
          line: 14,
          line_end: 14,
          problem: "The comparison returns true for a session that has not expired yet.",
          why: "The timestamp is compared in the wrong direction, so the guard fires early.",
          impact: "Every session is rejected immediately after it is created.",
          evidence: "src/session.ts:14 | `  return session.expiresAt <= now;` | a live session is reported as expired",
          confidence: 82,
          fix: "Compare with >= instead.",
        },
      ],
    };

    const report = await engineFor({ aiReviewer: createStaticAiReviewer(grounded) }).review({
      target: cleanTarget,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.origin).toBe("ai");
    expect(report.findings[0]?.location.line).toBe(14);
  });

  it("merges a model finding that repeats a detector finding", async () => {
    const duplicate = {
      verdict: "needs-attention",
      summary: "NaN comparison",
      findings: [
        {
          severity: "high",
          axis: "correctness",
          title: "Comparison with NaN always behaves the same way",
          file: "src/validation.ts",
          line: 4,
          line_end: 4,
          problem: "The value is compared against NaN with an equality operator.",
          why: "NaN is not equal to itself, so the check can never succeed.",
          impact: "The guard never fires and invalid values pass through.",
          evidence: "src/validation.ts:4 | `  return score === NaN;` | the comparison is always false",
          confidence: 75,
          fix: "Use Number.isNaN(score).",
        },
      ],
    };

    const report = await engineFor({ aiReviewer: createStaticAiReviewer(duplicate) }).review({
      target: path.join(FIXTURES, "buggy"),
    });

    const nanFindings = report.findings.filter((finding) => finding.location.file === "src/validation.ts");
    expect(nanFindings).toHaveLength(1);
    // The detector's claim was stronger, so it is the one that survives.
    expect(nanFindings[0]?.origin).toBe("detector");
    expect(nanFindings[0]?.confidence).toBe(92);
    expect(report.stats.duplicatesMerged).toBeGreaterThanOrEqual(1);
  });

  it("keeps the review when the provider fails", async () => {
    const failing = {
      name: "failing",
      review: async () => {
        throw new Error("provider returned 503");
      },
    };
    const events: ReviewEvent[] = [];

    const report = await new ReviewEngine({
      fs: createNodeFileSystem(),
      promptsDir: PROMPTS_DIR,
      aiReviewer: failing,
      onEvent: (event) => events.push(event),
    }).review({ target: path.join(FIXTURES, "buggy") });

    expect(report.findings.length).toBe(EXPECTED_DEFECTS.length);
    expect(events.some((event) => event.type === "ai:failed")).toBe(true);
  });
});

describe("ReviewEngine with a diff", () => {
  const DIFF_ROOT = path.join(FIXTURES, "diff-target");

  /** The loop bound was altered on new line 5; the sort defect is unchanged. */
  const DIFF_TEXT = [
    "diff --git a/src/paging.ts b/src/paging.ts",
    "--- a/src/paging.ts",
    "+++ b/src/paging.ts",
    "@@ -3,5 +3,5 @@",
    " export function sumScores(scores: number[]): number {",
    "   let total = 0;",
    "-  for (let index = 0; index < scores.length; index += 1) {",
    "+  for (let index = 0; index <= scores.length; index += 1) {",
    "     total += scores[index];",
    "   }",
    "",
  ].join("\n");

  function stubGit(): GitPort {
    return {
      detectRepository: async () => ({ root: DIFF_ROOT, branch: "feature/paging" }),
      resolveBaseBranch: async () => "main",
      diff: async () => DIFF_TEXT,
      changedFiles: async () => ["src/paging.ts"],
    };
  }

  it("keeps a defect on a changed line", async () => {
    const report = await engineFor({ git: stubGit(), changedOnly: true }).review({ target: DIFF_ROOT });

    expect(report.scope.diffAware).toBe(true);
    expect(report.scope.baseBranch).toBe("main");
    expect(report.scope.branch).toBe("feature/paging");
    expect(pairs(report)).toEqual(["src/paging.ts::js.off-by-one-loop-bound"]);
    expect(report.findings[0]?.location.line).toBe(5);
  });

  it("drops a defect outside the changed lines even though the detector found it", async () => {
    const report = await engineFor({ git: stubGit(), changedOnly: true }).review({ target: DIFF_ROOT });

    const dropped = report.rejected.find((entry) => entry.reason === "anchor-outside-changed-lines");
    expect(dropped).toBeDefined();
    expect(dropped?.detail).toContain("outside the changed lines");
    // The file was in scope; only the anchor was not. The two are reported
    // separately so the rejection counts stay usable.
    expect(report.rejected.every((entry) => entry.reason !== "file-not-in-scope")).toBe(true);
  });

  it("reports both defects when the review is not diff scoped", async () => {
    const report = await engineFor().review({ target: DIFF_ROOT });

    expect(report.scope.diffAware).toBe(false);
    expect(pairs(report).sort()).toEqual([
      "src/paging.ts::js.numeric-sort-without-comparator",
      "src/paging.ts::js.off-by-one-loop-bound",
    ]);
  });

  it("does not anchor a plain review to the repository's base branch", async () => {
    // The stub repository always offers `main` and the target is inside it, which
    // is the ordinary case for any project under version control. A review that
    // was not asked to diff must still report every defect: anchoring to changed
    // lines is a diff-review behaviour, not a default, and defaulting to it turns
    // every unchanged finding into a false negative.
    const report = await engineFor({ git: stubGit() }).review({ target: DIFF_ROOT });

    expect(report.scope.diffAware).toBe(false);
    expect(report.scope.baseBranch).toBeNull();
    // The repository is still detected, because paths are named against it.
    expect(report.scope.branch).toBe("feature/paging");
    expect(report.rejected.every((entry) => entry.reason !== "anchor-outside-changed-lines")).toBe(true);
    expect(pairs(report).sort()).toEqual([
      "src/paging.ts::js.numeric-sort-without-comparator",
      "src/paging.ts::js.off-by-one-loop-bound",
    ]);
  });
});

describe("ReviewEngine scope containment", () => {
  const target = path.join(FIXTURES, "buggy");
  const repositoryRoot = path.join(FIXTURES, "..");

  /**
   * A repository whose root is an ancestor of the requested folder. This is the
   * ordinary case in this repository, and it is where a review can silently
   * widen itself to the whole project if git is allowed to decide the scope.
   */
  function ancestorGit(): GitPort {
    return {
      detectRepository: async () => ({ root: repositoryRoot, branch: "main" }),
      resolveBaseBranch: async () => null,
      diff: async () => "",
      changedFiles: async () => [],
    };
  }

  it("never reads outside the folder it was asked to review", async () => {
    const report = await engineFor({ git: ancestorGit() }).review({ target });

    expect(report.scope.root).toBe(target);
    expect(report.scope.pathBase).toBe(repositoryRoot);
    expect(report.scope.kind).toBe("directory");

    // Exactly the planted defects, so nothing outside the folder was reviewed.
    expect(report.findings.length).toBe(EXPECTED_DEFECTS.length);
    for (const finding of report.findings) {
      expect(finding.location.file.startsWith("fixtures/buggy/")).toBe(true);
    }
  });

  it("names a single file against the repository so its path matches the diff", async () => {
    const file = path.join(target, "src", "validation.ts");
    const report = await engineFor({ git: ancestorGit() }).review({ target: file });

    expect(report.scope.kind).toBe("file");
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.location.file).toBe("fixtures/buggy/src/validation.ts");
  });

  it("reports a repository kind only when the review root is the repository root", async () => {
    const report = await engineFor({ git: ancestorGit() }).review({ target: path.join(FIXTURES, "buggy", "src") });

    expect(report.scope.kind).toBe("directory");
    expect(report.scope.root).toBe(path.join(FIXTURES, "buggy", "src"));
  });
});

describe("parseReviewResponse", () => {
  it("reads a fenced JSON response", () => {
    const parsed = parseReviewResponse('```json\n{"verdict":"approve","summary":"looks fine","findings":[]}\n```');

    expect(parsed.verdict).toBe("approve");
    expect(parsed.summary).toBe("looks fine");
    expect(parsed.candidates).toEqual([]);
  });

  it("unwraps a provider envelope", () => {
    const envelope = {
      choices: [
        {
          message: {
            content: '{"verdict":"needs-attention","summary":"one issue","findings":[{"file":"a.ts","line":3,"title":"t"}]}',
          },
        },
      ],
    };

    const parsed = parseReviewResponse(envelope);

    expect(parsed.verdict).toBe("needs-attention");
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]?.file).toBe("a.ts");
    expect(parsed.candidates[0]?.line).toBe(3);
  });

  it("accepts alternative field names a model may reach for", () => {
    const parsed = parseReviewResponse({
      findings: [
        {
          file: "src/app.ts",
          line: 12,
          category: "security",
          claim: "The query is assembled from a value",
          explanation: "Interpolation puts the value into the statement text",
          recommendation: "Bind the value as a parameter",
        },
      ],
    });

    const candidate = parsed.candidates[0];
    expect(candidate?.axis).toBe("security");
    expect(candidate?.problem).toBe("The query is assembled from a value");
    expect(candidate?.why).toContain("Interpolation");
    expect(candidate?.fix).toBe("Bind the value as a parameter");
  });

  it("reports a response with no findings array instead of inventing one", () => {
    const parsed = parseReviewResponse({ verdict: "approve" });

    expect(parsed.candidates).toEqual([]);
    expect(parsed.issues).toContain("response had no findings array");
  });

  it("drops entries that carry no file or line", () => {
    const parsed = parseReviewResponse({
      findings: [{ title: "no file" }, { file: "a.ts", line: 0 }, { file: "b.ts", line: 2, title: "ok" }],
    });

    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]?.file).toBe("b.ts");
    expect(parsed.issues.length).toBeGreaterThan(0);
  });

  it("survives a non-JSON response", () => {
    const parsed = parseReviewResponse("I could not review this file.");

    expect(parsed.candidates).toEqual([]);
    expect(parsed.issues).toContain("response was not a JSON object");
  });
});
