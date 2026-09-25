import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createNodeFileSystem } from "../src/adapters/node-fs.ts";
import { ReviewEngine } from "../src/core/review/engine.ts";
import type { ReviewReport } from "../src/core/findings/model.ts";
import {
  evaluateReview,
  formatEvaluation,
  parseGroundTruth,
  readReviewReport,
} from "../src/eval/ground-truth.ts";
import type { ReportFindingLike, ReviewReportLike } from "../src/eval/ground-truth.ts";

const PROMPTS_DIR = path.join(import.meta.dir, "..", "prompts");
const FIXTURES = path.join(import.meta.dir, "fixtures");
const AI_REVIEW = path.join(FIXTURES, "ai-review");
const GROUND_TRUTH_PATH = path.join(AI_REVIEW, "GROUND_TRUTH.md");

const groundTruth = parseGroundTruth(readFileSync(GROUND_TRUTH_PATH, "utf8"));

function engineFor(): ReviewEngine {
  // No git port and no reviewer: this is the deterministic half of the pipeline,
  // which is what makes the evaluation reproducible offline.
  return new ReviewEngine({ fs: createNodeFileSystem(), promptsDir: PROMPTS_DIR });
}

/** The engine's own shape: the anchor is nested under `location`. */
function finding(overrides: Partial<ReportFindingLike> = {}): ReportFindingLike {
  return { title: "Defect", location: { file: "src/orders-api.ts", line: 5, lineEnd: 5 }, ...overrides };
}

function reportOf(findings: ReportFindingLike[], overrides: Partial<ReviewReportLike> = {}): ReviewReportLike {
  return {
    findings,
    stats: { candidatesProduced: findings.length, candidatesRejected: 0, duplicatesMerged: 0, rejectionsByReason: {} },
    rejected: [],
    ...overrides,
  };
}

describe("ground truth of the ai-review fixture", () => {
  it("reads every defect and every negative control, by id", () => {
    const defectIds = groundTruth.defects.map((defect) => defect.id);
    const negativeIds = groundTruth.negatives.map((negative) => negative.id);

    expect(defectIds).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"]);
    expect(negativeIds).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"]);

    for (const entry of [...groundTruth.defects, ...groundTruth.negatives]) {
      expect(entry.files.length).toBeGreaterThan(0);
      for (const file of entry.files) {
        expect(file.endsWith(".ts")).toBe(true);
        expect(readFileSync(path.join(AI_REVIEW, "repo", file), "utf8").length).toBeGreaterThan(0);
      }
    }
    // Every defect states what is wrong, so a reviewer can check the verdict.
    for (const defect of groundTruth.defects) expect(defect.defect.length).toBeGreaterThan(20);
  });

  it("accounts for every file inside the reviewed scope", () => {
    // The gap this test closes was real: two files were reviewed for months with
    // no ground-truth row, so a defect in them could never be scored.
    const reviewed = readdirSync(path.join(AI_REVIEW, "repo", "src")).filter((name) => name.endsWith(".ts"));
    const covered = new Set(
      [...groundTruth.defects, ...groundTruth.negatives].flatMap((entry) => entry.files),
    );

    const uncovered = reviewed
      .map((name) => `src/${name}`)
      .filter((file) => !covered.has(file));

    expect(uncovered).toEqual([]);
    expect(reviewed.length).toBeGreaterThanOrEqual(11);
  });
});

describe("evaluating a review against the ground truth", () => {
  it("counts a finding on a planted defect as a true positive", () => {
    const evaluation = evaluateReview(
      reportOf([finding({ location: { file: "src/user-profile.ts", line: 27, lineEnd: 27 } })]),
      groundTruth,
    );

    expect(evaluation.findings[0]?.verdict).toBe("defect");
    // user-profile.ts holds D2 and D3, so a finding there covers both. Crediting
    // only the first match would make D3 undetectable by construction.
    expect(evaluation.findings[0]?.matchedIds).toEqual(["D2", "D3"]);
    expect(evaluation.totals.truePositives).toBe(1);
    expect(evaluation.totals.falsePositives).toBe(0);
    expect(evaluation.defects.find((defect) => defect.id === "D2")?.detected).toBe(true);
    // A matched finding does not move any negative control.
    expect(evaluation.totals.falsePositiveOnNegatives).toBe(0);
  });

  it("separates a finding on correct code from a finding nothing supports", () => {
    const evaluation = evaluateReview(
      reportOf([
        // notifications.ts is C2/C3/C4: correct code that invites a wrong comment.
        finding({ location: { file: "src/notifications.ts", line: 34 } }),
        // No ground-truth row at all: nothing about this file is known to be right
        // or wrong, so the claim is unsupported rather than a false positive on a control.
        finding({ location: { file: "src/unknown-file.ts", line: 3 } }),
      ]),
      groundTruth,
    );

    expect(evaluation.findings.map((entry) => entry.verdict)).toEqual(["negative-control", "unsupported"]);
    expect(evaluation.findings[0]?.matchedIds).toEqual(["C2", "C3", "C4"]);
    // Three controls name that file, so all three are marked leaked by it. The
    // finding-level count stays one: a false positive is a finding, not a file.
    expect(evaluation.leakedNegativeIds).toEqual(["C2", "C3", "C4"]);
    expect(evaluation.totals.falsePositiveOnNegatives).toBe(1);
    expect(evaluation.totals.unsupported).toBe(1);
    expect(evaluation.totals.falsePositives).toBe(2);
    expect(evaluation.totals.truePositives).toBe(0);
  });

  it("matches a path named from a different root", () => {
    // A review rooted outside the fixture names files with a prefix, and the
    // score must not depend on where the review was started from.
    const evaluation = evaluateReview(
      reportOf([finding({ location: { file: "engine/test/fixtures/ai-review/repo/src/cart.ts", line: 15 } })]),
      groundTruth,
    );

    expect(evaluation.findings[0]?.matchedIds).toEqual(["D7"]);
    expect(evaluation.totals.truePositives).toBe(1);
  });

  it("reports the defects that were missed, not only the ones that were found", () => {
    const evaluation = evaluateReview(reportOf([]), groundTruth);

    expect(evaluation.totals.detectedDefects).toBe(0);
    expect(evaluation.totals.falseNegatives).toBe(groundTruth.defects.length);
    expect(evaluation.missedDefectIds).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"]);
  });

  it("counts a repeated anchor and keeps the rejection breakdown from the run", () => {
    const evaluation = evaluateReview(
      reportOf(
        [
          finding({ location: { file: "src/user-profile.ts", line: 27 } }),
          finding({ location: { file: "src/user-profile.ts", line: 27 } }),
        ],
        {
          stats: {
            candidatesProduced: 5,
            candidatesRejected: 3,
            duplicatesMerged: 1,
            rejectionsByReason: { "evidence-not-in-source": 2, "merged-duplicate": 1 },
          },
        },
      ),
      groundTruth,
    );

    expect(evaluation.totals.duplicateAnchors).toBe(1);
    expect(evaluation.candidates).toEqual({ produced: 5, kept: 2, rejected: 3, merged: 1 });
    expect(evaluation.rejectionBreakdown).toEqual({ "evidence-not-in-source": 2, "merged-duplicate": 1 });
  });

  it("counts a finding with no readable anchor instead of letting it vanish", () => {
    // A report must not be able to improve its score by omitting an anchor: an
    // unanchorable finding is neither a true positive nor silently gone.
    const evaluation = evaluateReview(reportOf([{ title: "No anchor at all" }, finding()]), groundTruth);

    expect(evaluation.totals.unanchorable).toBe(1);
    expect(evaluation.findings).toHaveLength(1);
    expect(evaluation.totals.truePositives).toBe(1);
    expect(evaluation.totals.falsePositives).toBe(0);
  });

  it("scores each defect of a shared file on its own", () => {
    // D2 and D3 both live in user-profile.ts. Neither may hide the other.
    const evaluation = evaluateReview(reportOf([]), groundTruth);

    expect(evaluation.defects.find((defect) => defect.id === "D2")?.detected).toBe(false);
    expect(evaluation.defects.find((defect) => defect.id === "D3")?.detected).toBe(false);

    const hit = evaluateReview(
      reportOf([finding({ location: { file: "src/user-profile.ts", line: 27, lineEnd: 29 } })]),
      groundTruth,
    );
    expect(hit.defects.find((defect) => defect.id === "D2")?.detected).toBe(true);
    expect(hit.defects.find((defect) => defect.id === "D3")?.detected).toBe(true);
    // One finding, however many defects its file holds.
    expect(hit.totals.truePositives).toBe(1);
  });

  it("lists every defect and control in the text report, misses included", () => {
    const text = formatEvaluation(
      evaluateReview(reportOf([finding({ location: { file: "src/user-profile.ts", line: 27 } })]), groundTruth),
      groundTruth,
    );

    expect(text).toContain("D2  detected");
    expect(text).toContain("D1  MISSED");
    expect(text).toContain("C1  clean");
    // D3 shares a file with D2, so one finding covers both rows.
    expect(text).toContain("missed: D1, D4, D5, D6, D7, D8, D9");
  });

  it("reads a saved run out of the CLI output, preamble included", () => {
    const report = { schema: "coderadar.review.findings.v1", summary: "Reviewed 3 files", findings: [finding()] };
    const saved = `CodeRadar review\n\nReviewed 3 files\n\n${JSON.stringify(report)}`;

    expect(readReviewReport(saved).findings).toHaveLength(1);
    // The wire shape, which flattens the same anchor, is scored identically.
    const flat = evaluateReview(
      reportOf([{ title: "Defect", file: "src/cart.ts", line: 15, line_end: 15 }]),
      groundTruth,
    );
    expect(flat.findings[0]?.matchedIds).toEqual(["D7"]);
    expect(() => readReviewReport("no report here")).toThrow("no review report was found in the input");
  });
});

describe("the fixtures, scored by the deterministic half of the pipeline", () => {
  it("produces no finding and no candidate for the clean fixture", async () => {
    // The negative controls in this fixture exist to be checked by the suite, not
    // only by a live run: a detector that starts firing on them fails here.
    const report = await engineFor().review({ target: path.join(FIXTURES, "clean") });

    expect(report.findings).toEqual([]);
    expect(report.rejected).toEqual([]);
    expect(report.stats.candidatesProduced).toBe(0);
  });

  it("keeps every deterministic finding on a planted-defect file of the ai-review fixture", async () => {
    const report: ReviewReport = await engineFor().review({ target: path.join(AI_REVIEW, "repo") });
    const evaluation = evaluateReview(report, groundTruth);

    // The property that matters for the deterministic half: it never reports
    // against code the ground truth says is correct.
    expect(evaluation.totals.falsePositiveOnNegatives).toBe(0);
    expect(evaluation.totals.unsupported).toBe(0);
    expect(evaluation.totals.duplicateAnchors).toBe(0);
  });
});
