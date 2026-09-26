/**
 * Scores one or more models on the same fixture, through the same pipeline.
 *
 * The point of this script is interchangeability. Every row below runs the real
 * `ReviewEngine` — the same context builder, prompt policy, parser, validator,
 * dedupe, confidence policy and scorer the app uses — and only the provider
 * changes. A row is therefore a statement about a model *inside CodeRadar*, not
 * about a model on its own, and the rows are directly comparable because nothing
 * else moved.
 *
 * Two rules it does not break:
 *
 * - The evidence gate is never relaxed to make a model look better. A model that
 *   cannot prove a claim scores as a miss, not as a finding.
 * - Agreement between models is not evidence. There is no consensus column: three
 *   models repeating one claim prove nothing, and the code is still the authority.
 *
 * Usage, from `engine/`:
 *
 *   bun run benchmark                                  # detectors only
 *   CODE_RADAR_AI_KEY=... CODE_RADAR_AI_ENDPOINT=... bun run benchmark --models a,b
 *   bun run benchmark --models a --record .coderadar/replay
 *   bun run benchmark --replay .coderadar/replay --reviewer-name http:host   # offline
 *   bun run benchmark --models a --trace /tmp/trace.json   # per-file, why
 *   bun run benchmark --models a --diagnose                 # per-defect, where it died
 *
 * The environment names are the engine CLI's own (`CODE_RADAR_AI_*`), so a shell
 * already set up to run `bun run review` with a provider needs nothing new.
 *
 * A recording is keyed by the reviewer that made it, so an offline replay needs
 * that identity and no key: pass `--reviewer-name http:<host>` (the same string a
 * live run of that endpoint reports), or pass the same `--endpoint` again. The
 * identity is never guessed from the model id, because two providers can serve
 * one model id and one recording must not answer for both.
 *
 *   live:   bun run benchmark --models a --record .coderadar/replay --json > live.json
 *   replay: bun run benchmark --replay .coderadar/replay --reviewer-name http:host --json > replay.json
 *   compare the rows only: `--json` never carries per-call latency or a timestamp,
 *   so `diff <(jq -S .rows live.json) <(jq -S .rows replay.json)` must be empty.
 *
 * Without a key and without recordings a model row is reported as SKIPPED. It is
 * never reported as a pass with nothing behind it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { createNodeFileSystem } from "../src/adapters/node-fs.ts";
import { createNodeGit } from "../src/adapters/node-git.ts";
import { createNodeReplayKey, createNodeReplayStore } from "../src/adapters/node-replay.ts";
import { writeFileSync } from "node:fs";
import type { ReviewFileTrace, ReviewReport } from "../src/core/findings/model.ts";
import type { AiReviewerPort } from "../src/core/ports.ts";
import { createHttpAiReviewer } from "../src/clients/http-ai-reviewer.ts";
import { ReviewEngine } from "../src/core/review/engine.ts";
import {
  createRecordingReviewer,
  createReplayReviewer,
} from "../src/core/replay/replay.ts";
import {
  diagnoseReview,
  diagnosisToJson,
  evaluateReview,
  evaluationToJson,
  formatDiagnosis,
  parseGroundTruth,
} from "../src/eval/index.ts";
import type { DefectDiagnosis, GroundTruth, ReviewEvaluation } from "../src/eval/index.ts";

const ENGINE_DIR = path.join(import.meta.dir, "..");
const PROMPTS_DIR = path.join(ENGINE_DIR, "prompts");
const DEFAULT_FIXTURE = path.join(ENGINE_DIR, "test", "fixtures", "ai-review", "repo");
const DEFAULT_GROUND_TRUTH = path.join(ENGINE_DIR, "test", "fixtures", "ai-review", "GROUND_TRUTH.md");
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const DEFAULT_KEY_ENV = "CODE_RADAR_AI_KEY";
const DEFAULT_ENDPOINT_ENV = "CODE_RADAR_AI_ENDPOINT";

/**
 * Output budget for one benchmark call.
 *
 * A reasoning model can deliberate for thousands of tokens before it emits the
 * review, and an answer cut off at the cap (`finish_reason: length`) measures the
 * request, not the model's accuracy. The input is identical for every model and
 * unchanged by this: same prompt, same context, same fixture.
 */
const BENCHMARK_MAX_OUTPUT_TOKENS = 16_384;
/**
 * Per-call timeout for one benchmark call.
 *
 * A large reasoning model can take minutes to answer one file, and the live runs
 * that produced this value timed out at the transport default (120s) with the
 * answer still coming. Same for every model.
 */
const BENCHMARK_TIMEOUT_MS = 300_000;
/** The retry policy the app uses. A 503 is a provider outage, not a model miss. */
const BENCHMARK_MAX_ATTEMPTS = 3;
const BENCHMARK_RETRY_DELAY_MS = 1_500;

/** A model's score, or the reason there is no score. */
interface BenchmarkRow {
  model: string;
  status: "scored" | "skipped";
  /** Why it was skipped. Empty when it was scored. */
  reason?: string;
  evaluation?: ReviewEvaluation;
  report?: ReviewReport;
  /** Present only when `--trace` was given. */
  trace?: ReviewFileTrace[] | undefined;
  /** Where each planted defect's claim stopped. Always computed. */
  diagnosis?: DefectDiagnosis[] | undefined;
}

const args = process.argv.slice(2);

function flagValue(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const fixture = path.resolve(flagValue("--fixture") ?? DEFAULT_FIXTURE);
const groundTruthPath = path.resolve(flagValue("--ground-truth") ?? DEFAULT_GROUND_TRUTH);
const recordDirectory = flagValue("--record");
const replayDirectory = flagValue("--replay");
const tracePath = flagValue("--trace");
const reviewerName = flagValue("--reviewer-name");
const keyEnv = flagValue("--key-env") ?? DEFAULT_KEY_ENV;
const apiKey = process.env[keyEnv] ?? "";
const endpoint = flagValue("--endpoint") ?? process.env[DEFAULT_ENDPOINT_ENV] ?? "";
const detectorsOnly = args.includes("--detectors-only") || args.includes("--no-ai");
const asJson = args.includes("--json");
const diagnose = args.includes("--diagnose");

const requestedModels = (flagValue("--models") ?? process.env["CODE_RADAR_AI_MODEL"] ?? DEFAULT_MODEL)
  .split(",")
  .map((model) => model.trim())
  .filter((model) => model !== "");

const truth: GroundTruth = parseGroundTruth(readFileSync(groundTruthPath, "utf8"));
if (truth.defects.length === 0) fail(`no defect table was found in ${groundTruthPath}`);

/**
 * The identity a recording is keyed under, in both directions.
 *
 * It is the reviewer that made the recording, stated explicitly or derived from
 * the configured endpoint. It is never the model id: two providers serve the same
 * model id, and a recording made against one must not silently answer for the
 * other.
 */
function recordingIdentity(): string | null {
  if (reviewerName !== undefined && reviewerName !== "") return reviewerName;
  if (endpoint === "") return null;
  try {
    return `http:${new URL(endpoint).host}`;
  } catch {
    return null;
  }
}

/**
 * Builds the reviewer for one model, or explains why the row cannot be scored.
 *
 * The live path is the same one the app takes: an OpenAI-compatible
 * chat-completions call with the review policy as the system prompt. The replay
 * path holds no key and touches no network.
 */
function reviewerFor(model: string): { reviewer: AiReviewerPort } | { reason: string } {
  if (replayDirectory !== undefined) {
    const identity = recordingIdentity();
    if (identity === null) {
      return {
        reason:
          "--replay needs --reviewer-name (or --endpoint) so the recording's key can be reproduced; a recording is keyed by the reviewer that made it",
      };
    }
    return {
      reviewer: createReplayReviewer({
        store: createNodeReplayStore(path.resolve(replayDirectory)),
        keyOf: createNodeReplayKey,
        reviewerName: identity,
        model,
        maxOutputTokens: BENCHMARK_MAX_OUTPUT_TOKENS,
      }),
    };
  }

  if (apiKey === "") {
    return { reason: `${keyEnv} is not set, and no --replay directory was given` };
  }
  if (endpoint === "") {
    return { reason: `${DEFAULT_ENDPOINT_ENV} is not set; pass the full chat-completions URL with --endpoint` };
  }

  const live = createHttpAiReviewer({
    endpoint,
    apiKey,
    model,
    maxOutputTokens: BENCHMARK_MAX_OUTPUT_TOKENS,
    timeoutMs: BENCHMARK_TIMEOUT_MS,
    maxAttempts: BENCHMARK_MAX_ATTEMPTS,
    retryDelayMs: BENCHMARK_RETRY_DELAY_MS,
  });

  if (recordDirectory === undefined) return { reviewer: live };

  const identity = recordingIdentity() ?? live.name;
  if (identity !== live.name) {
    return {
      reason: `--reviewer-name (${identity}) does not match the reviewer this endpoint creates (${live.name}); a recording under a different name could never be replayed`,
    };
  }

  return {
    reviewer: createRecordingReviewer({
      store: createNodeReplayStore(path.resolve(recordDirectory)),
      keyOf: createNodeReplayKey,
      reviewerName: identity,
      model,
      maxOutputTokens: BENCHMARK_MAX_OUTPUT_TOKENS,
      inner: live,
    }),
  };
}

async function scoreModel(model: string, reviewer: AiReviewerPort | null): Promise<BenchmarkRow> {
  const engine = new ReviewEngine({
    fs: createNodeFileSystem(),
    git: createNodeGit(),
    promptsDir: PROMPTS_DIR,
    ...(reviewer === null ? {} : { aiReviewer: reviewer }),
    // The diagnosis reads the trace, so asking for one implies collecting it.
    ...(tracePath === undefined && !diagnose ? {} : { collectTrace: true }),
  });

  const report = await engine.review({ target: fixture });
  const evaluation = evaluateReview(report, truth);
  const diagnosis = diagnoseReview(report, truth);

  return { model, status: "scored", evaluation, report, trace: report.trace, diagnosis };
}

function formatRow(row: BenchmarkRow): string[] {
  if (row.status === "skipped") {
    return [`${row.model}: SKIPPED — ${row.reason ?? "no reviewer"}`];
  }

  const evaluation = row.evaluation;
  const report = row.report;
  if (evaluation === undefined || report === undefined) return [`${row.model}: no result`];

  const ai = evaluation.ai;
  const lines = [
    `${row.model}`,
    `  state: ${evaluation.reviewState ?? "not recorded"}`,
    `  detected: ${evaluation.totals.detectedDefects}/${evaluation.totals.plantedDefects}  missed: ${evaluation.missedDefectIds.join(", ") || "none"}`,
    `  precision: ${rate(evaluation.totals.precision)}  recall: ${rate(evaluation.totals.recall)}  ` +
      `TP: ${evaluation.totals.truePositives}  FP: ${evaluation.totals.falsePositives} ` +
      `(unsupported ${evaluation.totals.unsupported}, on controls ${evaluation.totals.falsePositiveOnNegatives})`,
    `  controls leaked: ${evaluation.leakedNegativeIds.join(", ") || "none"}  duplicate anchors: ${evaluation.totals.duplicateAnchors}  unanchorable: ${evaluation.totals.unanchorable}`,
    `  candidates: produced ${evaluation.candidates.produced} kept ${evaluation.candidates.kept} rejected ${evaluation.candidates.rejected} merged ${evaluation.candidates.merged}`,
  ];

  lines.push(
    ai === null
      ? "  model stage: did not run (detectors only)"
      : `  model stage: calls ${ai.attempted} valid ${ai.valid} empty ${ai.empty} partial ${ai.partial} ` +
          `invalid(parser) ${ai.invalid} unavailable(provider) ${ai.unavailable} not-sent ${ai.notSent} coverage ${rate(ai.coverage)}`,
  );
  lines.push(`  limitations: ${evaluation.limitationCodes.join(" ") || "none"}`);
  // A file that was sent is not a file that was shown in full, and a miss in a
  // partly-sent file is not a miss the model made in the code.
  lines.push(
    `  partial context: ${
      evaluation.partialContext.length === 0
        ? "none"
        : evaluation.partialContext
            .map((entry) => `${entry.file} ${entry.coveredLines}/${entry.fileLines} lines`)
            .join(" ")
    }`,
  );

  const rejections = Object.entries(evaluation.rejectionBreakdown).sort(([, a], [, b]) => b - a);
  lines.push(
    `  rejections: ${rejections.length === 0 ? "none" : rejections.map(([reason, count]) => `${reason}=${count}`).join(" ")}`,
  );

  return lines;
}

function rate(value: number | null): string {
  return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}

const rows: BenchmarkRow[] = [];

// The deterministic half is always measured, because it is what a run falls back
// to and because a model can only be credited for what it adds on top of it.
rows.push(await scoreModel("detectors-only", null));

if (!detectorsOnly) {
  for (const model of requestedModels) {
    const resolved = reviewerFor(model);
    if ("reason" in resolved) {
      rows.push({ model, status: "skipped", reason: resolved.reason });
      continue;
    }
    rows.push(await scoreModel(model, resolved.reviewer));
  }
}

if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        fixture,
        ground_truth: groundTruthPath,
        replay: replayDirectory ?? null,
        recorded: recordDirectory ?? null,
        rows: rows.map((row) =>
          row.status === "skipped"
            ? { model: row.model, status: row.status, reason: row.reason }
            : { model: row.model, status: row.status, ...evaluationToJson(row.evaluation as ReviewEvaluation) },
        ),
      },
      null,
      2,
    )}\n`,
  );
} else {
  process.stdout.write(`fixture: ${path.relative(ENGINE_DIR, fixture)}\n`);
  process.stdout.write(`ground truth: ${path.relative(ENGINE_DIR, groundTruthPath)}\n`);
  process.stdout.write(`${"-".repeat(72)}\n`);
  for (const row of rows) process.stdout.write(`${formatRow(row).join("\n")}\n\n`);

  const scored = rows.filter((row) => row.status === "scored");
  const withModel = scored.filter((row) => row.evaluation?.ai !== null && row.model !== "detectors-only");
  if (withModel.length === 0) {
    process.stdout.write(
      "MODEL MATRIX: NOT RUN — no model row was scored. Set an API key or point --replay at recordings.\n",
    );
    process.stdout.write("Deterministic quality above is real; model quality is unmeasured, not zero.\n");
  }
}

if (diagnose) {
  for (const row of rows) {
    if (row.status !== "scored" || row.diagnosis === undefined) continue;
    process.stdout.write(`\n${row.model}\n${formatDiagnosis(row.diagnosis)}\n`);
  }
}

if (tracePath !== undefined) {
  // The artifact that answers "why is this defect not in the report": per file,
  // whether it was selected, sent, what the model answered, and what was dropped
  // and for which reason. Counts and reasons only — no source, no prompts.
  const traces = rows
    .filter((row) => row.status === "scored")
    .map((row) => ({
      model: row.model,
      review_state: row.evaluation?.reviewState ?? null,
      limitations: row.evaluation?.limitationCodes ?? [],
      missed_defects: row.evaluation?.missedDefectIds ?? [],
      // The forensics: for each planted defect, whether the file was sent, what
      // the model answered, and which boundary stopped the claim. Answers "why",
      // never "how many" — the score is `evaluateReview`'s alone.
      defect_diagnosis: diagnosisToJson(row.diagnosis ?? []),
      files: row.trace ?? [],
    }));

  writeFileSync(path.resolve(tracePath), `${JSON.stringify({ fixture, ground_truth: groundTruthPath, traces }, null, 2)}\n`);
  process.stdout.write(`\ntrace: ${tracePath}\n`);
}

const unusable = rows.filter((row) => row.status === "scored" && row.evaluation?.reviewState === "degraded");
if (unusable.length > 0 && asJson === false) {
  process.stdout.write(
    `\nWARNING: ${unusable.map((row) => row.model).join(", ")} produced a degraded review. ` +
      "The score above is a floor on what the model found, not a measurement of its accuracy.\n",
  );
}
