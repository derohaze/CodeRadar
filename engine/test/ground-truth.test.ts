import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createNodeFileSystem } from "../src/adapters/node-fs.ts";
import { ReviewEngine } from "../src/core/review/engine.ts";
import type { ReviewReport } from "../src/core/findings/model.ts";
import {
  diagnoseReview,
  evaluateReview,
  formatEvaluation,
  parseGroundTruth,
  readReviewReport,
} from "../src/eval/ground-truth.ts";
import type {
  ReportFileTraceLike,
  ReportFindingLike,
  ReviewReportLike,
} from "../src/eval/ground-truth.ts";

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

    // Every defect must be scorable by position, or the score can be earned by
    // naming the right file rather than the right code.
    for (const defect of groundTruth.defects) {
      expect(defect.anchor).not.toBeNull();
      expect(defect.anchor?.end).toBeGreaterThanOrEqual(defect.anchor?.start ?? 0);
      expect(defect.anchor?.start).toBeGreaterThanOrEqual(1);
    }

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
  it("counts a finding at the recorded anchor as a true positive", () => {
    const evaluation = evaluateReview(
      reportOf([finding({ location: { file: "src/user-profile.ts", line: 27, lineEnd: 27 } })]),
      groundTruth,
    );

    expect(evaluation.findings[0]?.verdict).toBe("defect");
    // Line 27 is D2's anchor. D3 sits on line 29, so this finding does not
    // cover it — a claim on the right file at the wrong line is not a discovery.
    expect(evaluation.findings[0]?.matchedIds).toEqual(["D2"]);
    expect(evaluation.totals.truePositives).toBe(1);
    expect(evaluation.totals.falsePositives).toBe(0);
    expect(evaluation.defects.find((defect) => defect.id === "D2")?.detected).toBe(true);
    expect(evaluation.defects.find((defect) => defect.id === "D3")?.detected).toBe(false);
    // A matched finding does not move any negative control.
    expect(evaluation.totals.falsePositiveOnNegatives).toBe(0);
  });

  it("does not credit a finding on the right file at the wrong line", () => {
    // The whole point of recording anchors: a review that knows which files are
    // interesting must not score as though it had found anything in them.
    const evaluation = evaluateReview(
      reportOf([finding({ location: { file: "src/user-profile.ts", line: 3, lineEnd: 3 } })]),
      groundTruth,
    );

    expect(evaluation.findings[0]?.verdict).toBe("unsupported");
    expect(evaluation.findings[0]?.matchedIds).toEqual([]);
    expect(evaluation.totals.truePositives).toBe(0);
    expect(evaluation.totals.unsupported).toBe(1);
    expect(evaluation.totals.falsePositives).toBe(1);
  });

  it("credits a range that spans the anchors of two defects in one file", () => {
    // D2 is 27-28 and D3 is 29: one finding covering 27-29 really does cover both.
    const evaluation = evaluateReview(
      reportOf([finding({ location: { file: "src/user-profile.ts", line: 27, lineEnd: 29 } })]),
      groundTruth,
    );

    expect(evaluation.findings[0]?.matchedIds).toEqual(["D2", "D3"]);
    expect(evaluation.defects.find((defect) => defect.id === "D2")?.detected).toBe(true);
    expect(evaluation.defects.find((defect) => defect.id === "D3")?.detected).toBe(true);
    // Still one finding, however many defects its range spans.
    expect(evaluation.totals.truePositives).toBe(1);
  });

  it("does not let a wrong anchor on a control file excuse the leak", () => {
    // notifications.ts is C2/C3/C4 (lines 34 in the old scorer). Any line there
    // is a false positive, and the anchor cannot launder it into a discovery.
    const evaluation = evaluateReview(
      reportOf([finding({ location: { file: "src/notifications.ts", line: 1, lineEnd: 1 } })]),
      groundTruth,
    );

    expect(evaluation.findings[0]?.verdict).toBe("negative-control");
    expect(evaluation.leakedNegativeIds).toEqual(["C2", "C3", "C4"]);
    expect(evaluation.totals.falsePositiveOnNegatives).toBe(1);
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
    const evaluation = evaluateReview(
      reportOf([{ title: "No anchor at all" }, finding({ location: { file: "src/user-profile.ts", line: 27 } })]),
      groundTruth,
    );

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
    // D3 shares a file with D2 but not its anchor, so one finding on line 27
    // covers D2 and leaves D3 missed.
    expect(text).toContain("missed: D1, D3, D4, D5, D6, D7, D8, D9");
    // Anchors are printed so a human can check the verdict against the fixture.
    expect(text).toContain("[expected L27-28]");
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

/**
 * A run that left a trace for one file. The trace is what makes "the model found
 * nothing" separable from "the model was never asked".
 */
function traceOf(file: string, overrides: Partial<ReportFileTraceLike> = {}): ReportFileTraceLike {
  return { file, selected: true, sentToModel: true, ...overrides };
}

/** A dropped candidate, with the evidence the gate extracted behind it. */
function rejectionOf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { file: "src/cart.ts", line: 15, lineEnd: 17, title: "Claim", reason: "evidence-not-in-source", ...overrides };
}

function diagnosisFor(
  report: ReviewReportLike,
  id: string,
): ReturnType<typeof diagnoseReview>[number] | undefined {
  return diagnoseReview(report, groundTruth).find((row) => row.id === id);
}

describe("diagnosing why a planted defect is not in the report", () => {
  it("separates a file that was never sent from a file the model judged clean", () => {
    // The distinction the last live run could not make: both look like zero.
    const neverSent = diagnosisFor(reportOf([], { trace: [traceOf("src/cart.ts", { sentToModel: false })] }), "D7");
    const judgedClean = diagnosisFor(
      reportOf([], { trace: [traceOf("src/cart.ts", { modelOutcome: "valid" })] }),
      "D7",
    );

    expect(neverSent?.claimDied).toBe("not-sent");
    expect(judgedClean?.claimDied).toBe("model-missed");
    expect(judgedClean?.sentToModel).toBe(true);
  });

  it("reports an unreadable or missing model answer as its own failure, never as clean", () => {
    const invalid = diagnosisFor(
      reportOf([], { trace: [traceOf("src/cart.ts", { modelOutcome: "invalid" })] }),
      "D7",
    );
    const unavailable = diagnosisFor(
      reportOf([], { trace: [traceOf("src/cart.ts", { modelOutcome: "unavailable" })] }),
      "D7",
    );
    const empty = diagnosisFor(
      reportOf([], { trace: [traceOf("src/cart.ts", { modelOutcome: "empty" })] }),
      "D7",
    );

    expect(invalid?.claimDied).toBe("model-response-invalid");
    expect(unavailable?.claimDied).toBe("model-unavailable");
    // An empty answer is a real answer and the model's own miss, not a failure.
    expect(empty?.claimDied).toBe("model-response-empty");
  });

  it("tells a claim with no evidence apart from evidence that is not in the source", () => {
    const nothingQuoted = diagnosisFor(
      reportOf([], {
        rejected: [rejectionOf({ diagnostics: { quotes: [], quotesFound: [], usedFileReference: true } })],
        trace: [traceOf("src/cart.ts", { modelOutcome: "valid" })],
      }),
      "D7",
    );
    const wrongEvidence = diagnosisFor(
      reportOf([], {
        rejected: [
          rejectionOf({ diagnostics: { quotes: ["arr.sort(", "caller"], quotesFound: [false, false] } }),
        ],
        trace: [traceOf("src/cart.ts", { modelOutcome: "valid" })],
      }),
      "D7",
    );

    expect(nothingQuoted?.claimDied).toBe("missing-evidence");
    expect(wrongEvidence?.claimDied).toBe("evidence-mismatch");
    expect(wrongEvidence?.detail).toContain("0 found in the reviewed file");
  });

  it("reports a candidate on the right file at the wrong lines as a wrong-line claim", () => {
    const row = diagnosisFor(
      reportOf([], {
        rejected: [rejectionOf({ file: "src/cart.ts", line: 3, lineEnd: 3, reason: "evidence-not-in-source" })],
        trace: [traceOf("src/cart.ts", { modelOutcome: "valid" })],
      }),
      "D7",
    );

    // D7 is 15-17. The model claimed the file at line 3, so it never reached the
    // defect: crediting the file alone is the mistake the anchors exist to stop.
    expect(row?.claimDied).toBe("wrong-line");
    expect(row?.candidatesOnFile).toEqual(["src/cart.ts:3 (evidence-not-in-source)"]);
  });

  it("reads a dedupe and a cap drop as policy outcomes, not as validator refusals", () => {
    const merged = diagnosisFor(
      reportOf([], {
        rejected: [rejectionOf({ reason: "merged-duplicate" })],
        trace: [traceOf("src/cart.ts", { modelOutcome: "valid" })],
      }),
      "D7",
    );
    const capped = diagnosisFor(
      reportOf([], {
        rejected: [rejectionOf({ reason: "over-finding-cap" })],
        trace: [traceOf("src/cart.ts", { modelOutcome: "valid" })],
      }),
      "D7",
    );

    expect(merged?.claimDied).toBe("dedupe");
    expect(capped?.claimDied).toBe("policy-rejected");
  });

  it("says so when a run left no trace instead of guessing", () => {
    // A report with no trace cannot state whether the file was even selected, and
    // inventing an answer here would be exactly the self-deception the fixture is
    // meant to prevent.
    const row = diagnosisFor(reportOf([]), "D7");

    expect(row?.claimDied).toBe("not-measured");
    expect(row?.selected).toBeNull();
    expect(row?.sentToModel).toBeNull();
  });

  it("agrees with the scorer about what was detected", () => {
    // The diagnosis explains a score; if the two could disagree, one of them would
    // be a second opinion about the same run.
    const report = reportOf(
      [finding({ location: { file: "src/cart.ts", line: 16, lineEnd: 16 } })],
      { trace: [traceOf("src/cart.ts", { modelOutcome: "valid" })] },
    );
    const evaluation = evaluateReview(report, groundTruth);
    const rows = diagnoseReview(report, groundTruth);
    const detected = rows.filter((row) => row.claimDied === "detected").map((row) => row.id);

    expect(detected).toEqual(evaluation.defects.filter((defect) => defect.detected).map((defect) => defect.id));
    expect(detected).toEqual(["D7"]);
  });
});

describe("the candidate chain and the context that was sent", () => {
  /** A trace of a readable answer, with the request that produced it. */
  function sentTrace(overrides: Partial<ReportFileTraceLike> = {}, file = "src/cart.ts"): ReportFileTraceLike {
    return traceOf(file, {
      modelOutcome: "valid",
      candidateDetails: [],
      request: { fileLines: 34, contextWindows: [{ startLine: 1, endLine: 34 }] },
      ...overrides,
    });
  }

  it("explains a claim from the trace's own candidate record, with no rejection list", () => {
    // A saved trace artifact carries the candidates but not the engine's rejection
    // array, and the same answer has to come out of it.
    const row = diagnosisFor(
      reportOf([], {
        trace: [
          sentTrace({
            candidateDetails: [
              {
                requestedFile: "src/cart.ts",
                file: "src/cart.ts",
                line: 16,
                lineEnd: 16,
                validator: "rejected",
                rejectionReason: "evidence-not-in-source",
                finalOutcome: "rejected",
                evidence: { quoteCount: 2, quotesFound: [false, false], anchored: false },
              },
            ],
          }),
        ],
      }),
      "D7",
    );

    expect(row?.mentioned).toBe(true);
    expect(row?.claimDied).toBe("evidence-mismatch");
    expect(row?.mentionedCandidates).toEqual([
      {
        anchor: "src/cart.ts:16",
        requestedFile: "src/cart.ts",
        claimedFile: "src/cart.ts",
        answeredAnotherFile: false,
        validator: "rejected",
        rejectionReason: "evidence-not-in-source",
        finalOutcome: "rejected",
        evidence: { quoteCount: 2, quotesFound: 0, anchored: false },
      },
    ]);
    expect(row?.detail).toContain("0 found in the reviewed file");
  });

  it("reads a candidate the policy dropped as a policy outcome, not as a miss", () => {
    const row = diagnosisFor(
      reportOf([], {
        trace: [
          sentTrace({
            candidateDetails: [
              {
                requestedFile: "src/cart.ts",
                file: "src/cart.ts",
                line: 16,
                validator: "accepted",
                finalOutcome: "policy-rejected",
              },
            ],
          }),
        ],
      }),
      "D7",
    );

    expect(row?.mentioned).toBe(true);
    expect(row?.claimDied).toBe("policy-rejected");
  });

  it("does not count a candidate that named another file as a claim about this one", () => {
    // The model was shown cart.ts and answered about refunds.ts. That is a claim
    // about refunds.ts and nothing at all about the defect in cart.ts.
    const row = diagnosisFor(
      reportOf([], {
        trace: [
          sentTrace({
            candidateDetails: [
              {
                requestedFile: "src/cart.ts",
                file: "src/refunds.ts",
                line: 31,
                validator: "rejected",
                rejectionReason: "file-not-in-scope",
                finalOutcome: "rejected",
              },
            ],
          }),
        ],
      }),
      "D7",
    );

    expect(row?.mentionedCandidates).toEqual([]);
    expect(row?.mentioned).toBe(false);
    expect(row?.claimDied).toBe("model-missed");
  });

  it("does not read a defect as missed when its lines were never sent", () => {
    // D7 is cart.ts 15-17. The request shows the model was sent lines 201-400 of a
    // 900-line file, so its silence says nothing about the defect.
    const row = diagnosisFor(
      reportOf([], {
        trace: [
          sentTrace({
            request: { fileLines: 900, contextWindows: [{ startLine: 201, endLine: 400 }] },
          }),
        ],
      }),
      "D7",
    );

    expect(row?.claimDied).toBe("context-truncated");
    expect(row?.context?.coversAnchor).toBe(false);
    expect(row?.context?.coversWholeFile).toBe(false);
    expect(row?.context?.coveredLines).toBe(200);
    expect(row?.detail).toContain("lines L201-400 of 900");
  });

  it("keeps a miss a miss when the defect's lines were sent, and says how much of the file was", () => {
    const row = diagnosisFor(
      reportOf([], {
        trace: [
          sentTrace({
            request: { fileLines: 900, contextWindows: [{ startLine: 1, endLine: 300 }] },
          }),
        ],
      }),
      "D7",
    );

    expect(row?.claimDied).toBe("model-missed");
    expect(row?.context?.coversAnchor).toBe(true);
    expect(row?.detail).toContain("it was shown lines L1-300 of 900");
  });

  it("reports an answer cut off at the output cap as truncated, not as a model miss", () => {
    // The live case this comes from: a reasoning model spent the whole output
    // budget deliberating, so the provider ended the answer mid-thought with
    // `finish_reason=length` and nothing readable in it. That is a request that was
    // too small, and calling it a model miss would blame the wrong thing.
    const row = diagnosisFor(
      reportOf([], {
        trace: [
          traceOf("src/cart.ts", {
            modelOutcome: "invalid",
            response: {
              provider: "api.example.com",
              model: "reasoner",
              attempts: [
                {
                  attempt: 1,
                  outcome: "response",
                  status: 200,
                  finishReason: "length",
                  usage: { completionTokens: 4096 },
                },
              ],
            },
          }),
        ],
      }),
      "D7",
    );

    expect(row?.claimDied).toBe("model-response-truncated");
    expect(row?.truncated).toBe(true);
    expect(row?.detail).toContain("4096 completion tokens");
    // The answer was never readable, so nothing can be claimed about its content.
    expect(row?.mentioned).toBeNull();
  });

  it("reports entries the parser discarded as a parse loss, not as the model's silence", () => {
    const row = diagnosisFor(
      reportOf([], {
        trace: [
          sentTrace({
            parser: { shape: "review", entriesDropped: 2, candidateCount: 1 },
          }),
        ],
      }),
      "D7",
    );

    expect(row?.claimDied).toBe("parser-dropped");
    expect(row?.parserDroppedEntries).toBe(2);
    expect(row?.detail).toContain("2 entr(ies)");
  });

  it("does not claim the model said nothing when the trace kept no candidate list", () => {
    const row = diagnosisFor(
      reportOf([], { trace: [traceOf("src/cart.ts", { modelOutcome: "valid" })] }),
      "D7",
    );

    expect(row?.mentioned).toBeNull();
    expect(row?.claimDied).toBe("model-missed");
  });

  it("reports a partly-sent file as partial context, and a whole one as whole", () => {
    const partlySent = evaluateReview(
      reportOf([], {
        trace: [
          sentTrace({
            request: {
              fileLines: 900,
              contextWindows: [{ startLine: 1, endLine: 200 }, { startLine: 201, endLine: 400 }],
            },
          }),
        ],
      }),
      groundTruth,
    );

    // Windows are merged: two adjacent windows over one file are one range, and the
    // lines they cover are counted once.
    expect(partlySent.partialContext).toEqual([
      { file: "src/cart.ts", coveredLines: 400, fileLines: 900, windows: [{ start: 1, end: 400 }] },
    ]);
    expect(formatEvaluation(partlySent, groundTruth)).toContain("src/cart.ts: 400 of 900 lines");

    const whole = evaluateReview(
      reportOf([], {
        trace: [
          sentTrace({
            request: { fileLines: 34, contextWindows: [{ startLine: 1, endLine: 20 }, { startLine: 21, endLine: 34 }] },
          }),
        ],
      }),
      groundTruth,
    );

    expect(whole.partialContext).toEqual([]);
  });

  it("does not judge the context of a file that was never sent", () => {
    const evaluation = evaluateReview(
      reportOf([], {
        trace: [
          traceOf("src/cart.ts", {
            sentToModel: false,
            request: { fileLines: 900, contextWindows: [{ startLine: 1, endLine: 200 }] },
          }),
        ],
      }),
      groundTruth,
    );

    expect(evaluation.partialContext).toEqual([]);
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
