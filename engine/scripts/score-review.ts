/**
 * Scores a saved review run against the fixture's ground truth.
 *
 * A run says how many findings it kept. This says whether they were the right
 * ones: which planted defects it surfaced, which it missed, and which claims
 * nothing in the fixture supports. It is the same scorer the test suite uses, so
 * a number quoted from a run and a number asserted in a test come from one
 * implementation.
 *
 * Usage, from `engine/`:
 *
 *   bun run score /tmp/gt-run.json
 *   bun run score /tmp/gt-run.json --ground-truth test/fixtures/ai-review/GROUND_TRUTH.md
 *
 * The input may be the CLI's own `--json` output, summary lines and all.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  evaluateReview,
  evaluationToJson,
  formatEvaluation,
  parseGroundTruth,
  readReviewReport,
} from "../src/eval/ground-truth.ts";

const ENGINE_DIR = path.join(import.meta.dir, "..");
const args = process.argv.slice(2);

const reportPath = args.find((arg) => !arg.startsWith("--"));
if (reportPath === undefined) {
  process.stderr.write("usage: bun run score <review-report.json> [--ground-truth <path>]\n");
  process.exit(2);
}

const groundTruthFlag = args.indexOf("--ground-truth");
const groundTruthPath =
  groundTruthFlag === -1
    ? path.join(ENGINE_DIR, "test", "fixtures", "ai-review", "GROUND_TRUTH.md")
    : path.resolve(args[groundTruthFlag + 1] ?? "");

const truth = parseGroundTruth(readFileSync(groundTruthPath, "utf8"));
if (truth.defects.length === 0) {
  process.stderr.write(`no defect table was found in ${groundTruthPath}\n`);
  process.exit(2);
}

const report = readReviewReport(readFileSync(reportPath, "utf8"));
const evaluation = evaluateReview(report, truth);

if (args.includes("--json")) {
  process.stdout.write(`${JSON.stringify(evaluationToJson(evaluation), null, 2)}\n`);
} else {
  process.stdout.write(`${path.relative(ENGINE_DIR, reportPath)}\n${"-".repeat(72)}\n`);
  process.stdout.write(`${formatEvaluation(evaluation, truth)}\n`);
}
