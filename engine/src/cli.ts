#!/usr/bin/env bun
/**
 * `coderadar review <path>`
 *
 * The CLI is the smallest useful surface over the engine, and it exists so the
 * pipeline can be exercised and verified without the desktop app or the legacy
 * Python backend running.
 *
 * Exit codes: 0 when the review completed, 1 when `--fail-on` was given and a
 * finding at or above that severity was produced, 2 when the review could not
 * run. A failing review and a completed review with findings are different
 * outcomes, and CI needs to tell them apart.
 */

import path from "node:path";
import { createNodeFileSystem } from "./adapters/node-fs.ts";
import { createNodeGit } from "./adapters/node-git.ts";
import { createHttpAiReviewer, AiReviewerError } from "./core/review/ai-reviewer.ts";
import { ReviewEngine } from "./core/review/engine.ts";
import type { AiReviewerPort, ReviewEvent } from "./core/ports.ts";
import type { ReviewFinding, ReviewReport, ReviewSeverity } from "./core/findings/model.ts";
import { severityRank } from "./core/findings/model.ts";

const PROMPTS_DIR = path.join(import.meta.dir, "..", "prompts");
const SEVERITY_ORDER: readonly ReviewSeverity[] = ["critical", "high", "medium", "low"];

interface CliOptions {
  target: string;
  json: boolean;
  useAi: boolean;
  changedOnly: boolean;
  baseBranch: string | undefined;
  maxFindings: number;
  failOn: ReviewSeverity | null;
  quiet: boolean;
}

const USAGE = `coderadar review <path> [options]

Options:
  --json                 Emit the review report as JSON
  --no-ai                Run the deterministic detectors only
  --changed-only         Review only files that differ from the base branch
  --base <ref>           Branch or commit to compare against
  --max-findings <n>     Cap the number of findings (default 15)
  --fail-on <severity>   Exit 1 when a finding at or above this severity exists
  --quiet                Suppress progress events
  --help                 Show this message

AI configuration is read from the environment. Without all three variables the
review runs with the deterministic detectors only:
  CODE_RADAR_AI_ENDPOINT   Full chat-completions URL
  CODE_RADAR_AI_KEY        Provider API key
  CODE_RADAR_AI_MODEL      Model name`;

function parseArgs(argv: readonly string[]): CliOptions | null {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") return null;
  if (command !== "review") {
    throw new Error(`unknown command: ${command}`);
  }

  let target: string | null = null;
  const options: CliOptions = {
    target: "",
    json: false,
    useAi: true,
    changedOnly: false,
    baseBranch: undefined,
    maxFindings: 15,
    failOn: null,
    quiet: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === undefined) continue;

    if (argument === "--json") options.json = true;
    else if (argument === "--no-ai") options.useAi = false;
    else if (argument === "--changed-only") options.changedOnly = true;
    else if (argument === "--quiet") options.quiet = true;
    else if (argument === "--base") {
      index += 1;
      options.baseBranch = rest[index];
    } else if (argument === "--max-findings") {
      index += 1;
      const parsed = Number.parseInt(rest[index] ?? "", 10);
      if (Number.isFinite(parsed) && parsed > 0) options.maxFindings = parsed;
    } else if (argument === "--fail-on") {
      index += 1;
      const value = (rest[index] ?? "").toLowerCase();
      if (SEVERITY_ORDER.includes(value as ReviewSeverity)) options.failOn = value as ReviewSeverity;
    } else if (argument.startsWith("-")) {
      throw new Error(`unknown option: ${argument}`);
    } else if (target === null) {
      target = argument;
    } else {
      throw new Error(`unexpected argument: ${argument}`);
    }
  }

  if (target === null) throw new Error("a path to review is required");
  options.target = target;
  return options;
}

/** Builds the AI reviewer from the environment, or null when unconfigured. */
function buildAiReviewer(): AiReviewerPort | null {
  const endpoint = process.env.CODE_RADAR_AI_ENDPOINT;
  const apiKey = process.env.CODE_RADAR_AI_KEY;
  const model = process.env.CODE_RADAR_AI_MODEL;

  if (endpoint === undefined || apiKey === undefined || model === undefined) return null;
  if (endpoint === "" || apiKey === "" || model === "") return null;

  return createHttpAiReviewer({ endpoint, apiKey, model });
}

function printEvent(event: ReviewEvent): void {
  if (event.type === "ai:failed") {
    process.stderr.write(`  ! ${event.message}\n`);
    return;
  }
  process.stderr.write(`  ${event.message}\n`);
}

function formatFinding(finding: ReviewFinding): string {
  const lines: string[] = [];
  const { location } = finding;
  const range = location.lineEnd > location.line ? `${location.line}-${location.lineEnd}` : `${location.line}`;

  lines.push(`${finding.severity.toUpperCase()}  ${location.file}:${range}  [${finding.axis}]`);
  lines.push(`  ${finding.title}`);
  lines.push("");
  lines.push(`  Problem:  ${finding.problem}`);
  lines.push(`  Why:      ${finding.why}`);
  lines.push(`  Impact:   ${finding.impact}`);
  lines.push(`  Evidence: ${finding.evidence}`);
  lines.push(`  Fix:      ${finding.fix}`);
  if (finding.suggestedPatch !== null) {
    lines.push("  Patch:");
    for (const patchLine of finding.suggestedPatch.split("\n")) lines.push(`    ${patchLine}`);
  }
  if (finding.suggestedTest !== null) lines.push(`  Test:     ${finding.suggestedTest}`);
  lines.push(`  Confidence: ${finding.confidence}  Origin: ${finding.origin}`);

  return lines.join("\n");
}

function printReport(report: ReviewReport, options: CliOptions): void {
  const heading = report.verdict === "approve" ? "No issues found" : `${report.findings.length} issues found`;
  process.stdout.write(`\n${heading}\n`);
  process.stdout.write(`${report.summary}\n\n`);

  const scopeBits = [`root: ${report.scope.root}`, `kind: ${report.scope.kind}`];
  if (report.scope.pathBase !== report.scope.root) {
    scopeBits.push(`paths relative to: ${report.scope.pathBase}`);
  }
  if (report.scope.diffAware) {
    scopeBits.push(`diff against: ${report.scope.baseBranch ?? "unknown"}`);
  }
  if (report.scope.branch !== null) scopeBits.push(`branch: ${report.scope.branch}`);
  process.stdout.write(`Scope: ${scopeBits.join("  |  ")}\n`);

  const { stats } = report;
  process.stdout.write(
    `Reviewed ${stats.filesReviewed} of ${stats.filesDiscovered} discovered files. ` +
      `${stats.candidatesProduced} candidates, ${stats.findingsKept} kept, ` +
      `${stats.candidatesRejected} dropped by the bar, ${stats.duplicatesMerged} duplicates merged.\n`,
  );

  if (options.json) {
    process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  for (const finding of report.findings) {
    process.stdout.write(`\n${formatFinding(finding)}\n`);
  }

  const rejectionCounts = Object.entries(stats.rejectionsByReason).sort((a, b) => b[1] - a[1]);
  if (rejectionCounts.length > 0) {
    process.stdout.write("\nDropped candidates by reason:\n");
    for (const [reason, count] of rejectionCounts) {
      process.stdout.write(`  ${reason}: ${count}\n`);
    }
  }
}

async function main(): Promise<number> {
  let options: CliOptions | null;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "invalid arguments"}\n\n${USAGE}\n`);
    return 2;
  }

  if (options === null) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const aiReviewer = options.useAi ? buildAiReviewer() : null;
  if (options.useAi && aiReviewer === null && !options.quiet) {
    process.stderr.write(
      "No AI provider configured. Set CODE_RADAR_AI_ENDPOINT, CODE_RADAR_AI_KEY, and CODE_RADAR_AI_MODEL to enable it.\n",
    );
  }

  const engine = new ReviewEngine({
    fs: createNodeFileSystem(),
    git: createNodeGit(),
    promptsDir: PROMPTS_DIR,
    ...(aiReviewer !== null ? { aiReviewer } : {}),
    ...(options.baseBranch !== undefined ? { baseBranch: options.baseBranch } : {}),
    changedOnly: options.changedOnly,
    maxFindings: options.maxFindings,
    ...(options.quiet ? {} : { onEvent: printEvent }),
  });

  const report = await engine.review({ target: options.target });
  printReport(report, options);

  if (options.failOn !== null) {
    const threshold = severityRank(options.failOn);
    const failing = report.findings.some((finding) => severityRank(finding.severity) <= threshold);
    return failing ? 1 : 0;
  }

  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof AiReviewerError) {
    process.stderr.write(`ai provider error: ${error.message}\n`);
  } else {
    process.stderr.write(`review failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  }
  process.exitCode = 2;
}
