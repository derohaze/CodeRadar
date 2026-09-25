#!/usr/bin/env node
/**
 * GUI smoke test: the whole CodeRadar runtime, observed through the real
 * Electron window instead of a unit test.
 *
 * It exists because "the engine's tests pass" and "the app works" are different
 * claims. This drives the renderer the way a user does — pick a source, run the
 * review, read the results, click a finding — and reports PASS/FAIL per
 * requirement, plus a JSON report for the record.
 *
 * The only boundary that is not real is the OS file dialog: Playwright cannot
 * drive a native picker, so the source is chosen through the app's own "Recent"
 * chips, which is a path the app already has. The engine, the local API, the
 * model provider, and the review are untouched.
 *
 * Usage, from `frontend/`:
 *
 *   CODERADAR_AI_KEY=nvapi-... node scripts/gui-smoke.mjs
 *
 * Without a key the AI review step is reported as NOT RUN instead of PASS.
 */

import { _electron as electron } from "playwright";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(FRONTEND_DIR, "..");
const FIXTURES = path.join(REPO_ROOT, "engine", "test", "fixtures");
const REPORT_PATH = process.env["GUI_SMOKE_REPORT"] ?? path.join(FRONTEND_DIR, "gui-smoke-report.json");

const AI_KEY = process.env["CODERADAR_AI_KEY"] ?? "";
const AI_MODEL = process.env["CODERADAR_AI_MODEL"] ?? "nvidia/nemotron-3-super-120b-a12b";
const AI_BASE_URL = process.env["CODERADAR_AI_BASE_URL"] ?? "https://integrate.api.nvidia.com/v1";

/** A review of the whole repository with a model can legitimately take minutes. */
const REVIEW_TIMEOUT_MS = Number(process.env["GUI_SMOKE_TIMEOUT_MS"] ?? 600_000);
const BOOT_TIMEOUT_MS = 60_000;

const checks = [];
const notes = [];

/** The window under test, shared by the step helpers. */
let page;
let electronApp;

function record(name, status, detail) {
  checks.push({ name, status, detail });
  process.stdout.write(`${status.padEnd(7)} ${name} :: ${detail}\n`);
}

function note(line) {
  notes.push(line);
  process.stdout.write(`note    ${line}\n`);
}

async function main() {
  process.stdout.write(`\nCodeRadar GUI smoke test\n${"-".repeat(72)}\n`);

  electronApp = await electron.launch({
    args: [FRONTEND_DIR],
    cwd: FRONTEND_DIR,
    // Development keeps the Vite dev server as the document origin, which is the
    // layout `electron:dev` and `dev:all` both use.
    env: { ...process.env, NODE_ENV: "development" },
  });

  const app = electronApp;
  page = await appWindow(app);
  await page.waitForLoadState("domcontentloaded");

  try {
    await boot(page, app);
    await runChecks(page);
  } catch (error) {
    record("smoke run", "FAIL", `aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    const summary = {
      ranAt: new Date().toISOString(),
      model: AI_KEY === "" ? null : { baseUrl: AI_BASE_URL, model: AI_MODEL },
      checks,
      notes,
    };
    writeFileSync(REPORT_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    process.stdout.write(`${"-".repeat(72)}\nreport: ${REPORT_PATH}\n`);
    await closeApp(app);
  }

  const failed = checks.filter((entry) => entry.status === "FAIL");
  process.stdout.write(`${checks.length - failed.length}/${checks.length} checks passed\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

async function boot(page, app) {
  page.on("console", (message) => {
    if (message.type() === "error") note(`renderer console error: ${message.text().slice(0, 200)}`);
  });
  page.on("pageerror", (error) => note(`renderer page error: ${String(error).slice(0, 200)}`));

  const home = page.getByText("Start a code review", { exact: false });
  try {
    await home.waitFor({ timeout: 30_000 });
  } catch {
    // The dev-server document occasionally loads blank on a cold start. One
    // reload is the same recovery a user would try, so it is not papering over a
    // product failure — a second failure is still reported.
    note("the first load rendered nothing; reloading once");
    await page.reload();
    try {
      await home.waitFor({ timeout: BOOT_TIMEOUT_MS });
    } catch (error) {
      const seen = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => "(unreadable)");
      throw new Error(`the home screen never rendered. url=${page.url()} body=${JSON.stringify(seen)} (${String(error)})`);
    }
  }
  const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? "");
  const body = await page.evaluate(() => document.body.innerText);
  record("Electron GUI", "PASS", `window opened, title "${title}", home screen rendered`);
  // The renderer uppercases this label in CSS, so innerText comes back as REVIEW SETUP.
  const wired = /review setup/i.test(body) && body.trim().length > 0;
  record(
    "Renderer wired to the engine",
    wired ? "PASS" : "FAIL",
    wired ? "review setup screen and sidebar rendered with no start-up error" : "the renderer did not render",
  );
}

/**
 * The app's own window, never the DEVTOOLS window.
 *
 * The development build opens DevTools detached, which means there are two
 * windows and `firstWindow()` returns whichever appeared first. Driving the
 * DevTools window looks exactly like an app that renders nothing.
 */
async function appWindow(app) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const found = app.windows().find((candidate) => /^(https?:|file:)/.test(candidate.url()));
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`the app window never appeared; saw: ${app.windows().map((w) => w.url()).join(", ")}`);
}

/**
 * Closes the app and makes sure the process tree is gone either way.
 *
 * The app hides to the tray instead of exiting, so a plain close can leave an
 * instance alive holding the user-data profile. The next launch then opens a
 * window that renders nothing, which is exactly the failure that wasted an
 * afternoon here, so the tree is always killed explicitly.
 */
async function closeApp(app) {
  const { pid } = app.process();
  await app.close().catch(() => {});
  try {
    execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore", windowsHide: true });
  } catch {
    // Already gone.
  }
}

/** Waits for the results screen, which always renders the findings card. */
async function waitForResults() {
  const deadline = Date.now() + REVIEW_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes("Validated findings")) return text;
    if (text.includes("The review could not") || text.includes("failed")) {
      // Keep polling: a failed session still renders the results screen.
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`no results screen within ${REVIEW_TIMEOUT_MS}ms`);
}

async function waitForProgress() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes("%") || /reviewing|progress|analysing|analyzing/i.test(text)) return text;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

/** Remembers sources the way the app remembers them, so its own chips can pick them. */
async function seedRecent(entries) {
  await page.evaluate((list) => {
    window.localStorage.setItem(
      "coderadar.recent-sources",
      JSON.stringify(list.map((entry) => ({ ...entry, pickedAt: Date.now() }))),
    );
  }, entries);
  await page.reload();
  await page.getByText("Start a code review", { exact: false }).waitFor({ timeout: BOOT_TIMEOUT_MS });
}

async function startReview(targetPath, kind) {
  await targetToggle(page, kind === "file" ? "File" : "Folder").click();
  // The app's own "Recent" chip: select by the full path it carries as its title,
  // so a Windows path never goes through a CSS attribute selector.
  await page.getByTitle(targetPath, { exact: true }).first().click();
  const pathShown = await page.evaluate(() => document.body.innerText.includes("No source selected"));
  if (pathShown) throw new Error(`the source was not selected: ${targetPath}`);

  await page.getByRole("button", { name: /Run review/ }).click();
  const progress = await waitForProgress();
  return progress;
}

function pythonOrRustRunning() {
  try {
    const listing = execSync("tasklist", { encoding: "utf8", windowsHide: true });
    return listing
      .split(/\r?\n/)
      .filter((line) => /python|rust-indexer|uvicorn/i.test(line))
      .map((line) => line.trim().split(/\s+/)[0]);
  } catch {
    return [];
  }
}

async function runChecks(page) {
  await seedRecent([
    { path: FIXTURES + "\\buggy", type: "folder", workspace: "fixtures" },
    { path: FIXTURES + "\\clean", type: "folder", workspace: "fixtures" },
    { path: FIXTURES + "\\buggy\\src\\render.ts", type: "file", workspace: "src" },
    { path: REPO_ROOT, type: "folder", workspace: "CodeGuard" },
  ]);

  // ---- 1. Real AI provider configured through the Settings GUI -------------
  if (AI_KEY === "") {
    record("Provider configured via GUI", "NOT RUN", "CODERADAR_AI_KEY was not set");
  } else {
    try {
      await configureProvider(page);
    } catch (error) {
      record("Provider configured via GUI", "FAIL", `the settings flow threw: ${String(error).slice(0, 200)}`);
      await backToHome(page);
    }
  }

  // ---- 2. Folder review with the real model -------------------------------
  const foreignProcesses = [];
  await startReview(path.join(FIXTURES, "buggy"), "folder");
  const watcher = setInterval(() => {
    for (const name of pythonOrRustRunning()) foreignProcesses.push(name);
  }, 1500);

  const folderResults = await waitForResults();
  clearInterval(watcher);
  record("Folder review reaches results", "PASS", "the review started, showed progress, and rendered results");
  record(
    "No Python or Rust in the runtime",
    foreignProcesses.length === 0 ? "PASS" : "FAIL",
    foreignProcesses.length === 0
      ? "no python/uvicorn/rust-indexer process existed while the review ran"
      : `foreign processes: ${[...new Set(foreignProcesses)].join(", ")}`,
  );

  const folderSummary = readSummary(folderResults);
  const findings = readFindings(folderResults);
  record(
    "Folder review reports findings",
    folderSummary.total > 0 ? "PASS" : "FAIL",
    `${folderSummary.total} finding(s) in the app's own summary (${folderSummary.open} open, ${folderSummary.queued} queued, ${folderSummary.candidates} candidate)`,
  );
  record(
    "Folder review stays inside the chosen folder",
    readReviewed(folderResults).includes("9/9") ? "PASS" : "FAIL",
    `coverage reads "${readReviewed(folderResults)}" for a 9-file fixture`,
  );
  reportFindingAnchors(findings);
  note(`results digest: ${resultsDigest(folderResults)}`);

  // ---- 3. Click a finding and read the anchored detail --------------------
  await assertFindingDetail(page, findings);

  // ---- 4. Single-file review does not become a repository review ----------
  await navigateHome(page);
  await startReview(path.join(FIXTURES, "buggy", "src", "render.ts"), "file");
  const fileResults = await waitForResults();
  const fileSummary = readSummary(fileResults);
  const scopeEvidence = readReviewed(fileResults);
  const foreignFiles = readFindings(fileResults).filter((finding) => !finding.file.includes("render.ts"));
  record(
    "Single-file review stays scoped to the file",
    scopeEvidence.includes("1/1") && foreignFiles.length === 0 ? "PASS" : "FAIL",
    `coverage reads "${scopeEvidence}" (one file), ${foreignFiles.length} finding(s) outside the selected file`,
  );
  record(
    "Single-file review reports the file's defect",
    fileSummary.total > 0 ? "PASS" : "FAIL",
    `${fileSummary.total} finding(s): ${fileSummary.open} open, ${fileSummary.queued} queued, ${fileSummary.candidates} candidate`,
  );
  note(`single-file digest: ${resultsDigest(fileResults)}`);

  // ---- 5. Correct code produces no findings -------------------------------
  await navigateHome(page);
  await startReview(path.join(FIXTURES, "clean"), "folder");
  const cleanResults = await waitForResults();
  const cleanSummary = readSummary(cleanResults);
  record(
    "False positives: correct code yields 0 findings",
    cleanSummary.total === 0 ? "PASS" : "FAIL",
    cleanSummary.total === 0
      ? `no finding was invented for correct code (${readReviewed(cleanResults)} reviewed)`
      : `unexpected findings: ${cleanSummary.total} (${resultsDigest(cleanResults)})`,
  );

  // ---- 6. A real git repository ------------------------------------------
  await navigateHome(page);
  await startReview(REPO_ROOT, "folder");
  const repoResults = await waitForResults();
  const repoSummary = readSummary(repoResults);
  const escaped = readFindings(repoResults).filter((finding) => finding.file.includes(".."));
  record(
    "Git repository review",
    repoResults.length > 0 && escaped.length === 0 ? "PASS" : "FAIL",
    `the repository root was reviewed in git (${readReviewed(repoResults)}), ${repoSummary.total} finding(s), ${escaped.length} outside the scope`,
  );
  note(`repository digest: ${resultsDigest(repoResults)}`);
}

/** Returns to the review setup screen through the sidebar action the app exposes. */
/**
 * The Folder/File pill in the review setup card.
 *
 * Matched by its own minimum width rather than by its label, because the title
 * bar also has a "File" menu button and the label alone is ambiguous.
 */
function targetToggle(page, label) {
  return page.locator("button.min-w-\\[84px\\]", { hasText: new RegExp(`^${label}$`) });
}

async function navigateHome(page) {
  if (await page.getByText("Start a code review", { exact: false }).count()) return;
  const sidebarEntry = page.getByRole("button", { name: "Code Review" });
  if (await sidebarEntry.count()) await sidebarEntry.first().click({ force: true });
  if (!(await page.getByText("Start a code review", { exact: false }).count())) await page.reload();
  await page.getByText("Start a code review", { exact: false }).waitFor({ timeout: 45_000 });
}

async function configureProvider(page) {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Providers", exact: false }).first().click();
  await page.getByRole("button", { name: /NVIDIA/ }).first().click();

  const keyInput = page.locator('input[type="password"]');
  const keyPlaceholder = (await keyInput.getAttribute("placeholder")) ?? "";
  const alreadyStored = keyPlaceholder.startsWith("Stored:");
  if (!alreadyStored) await keyInput.fill(AI_KEY);

  const modelInput = page.locator('input[placeholder*="Select or type model"]');
  if (((await modelInput.inputValue()) ?? "") === "") await modelInput.fill(AI_MODEL);

  note(`provider key ${alreadyStored ? "was already stored" : "entered through the GUI"}`);

  await page.getByRole("button", { name: "Test connection" }).click();
  const testMessage = await waitForTestMessage(page);
  record(
    "Provider test connection (live call)",
    testMessage !== null && /answered with/i.test(testMessage) ? "PASS" : "FAIL",
    testMessage ?? "the provider never answered",
  );

  await page.getByRole("button", { name: "Save provider" }).click();
  await page.waitForTimeout(2500);
  await backToHome(page);

  // What proves the save is that the next visit reads it back from disk, not
  // that a particular line rendered on the first pass.
  const persisted = await readStoredProvider(page);
  const savedOk = persisted.active && persisted.model === AI_MODEL && persisted.keyStored;
  record(
    "Provider saved through the GUI",
    savedOk ? "PASS" : "FAIL",
    `stored provider reads back as ${persisted.provider ?? "none"} / ${persisted.model || "no model"} / ${persisted.keyStored ? "key stored" : "no key"}`,
  );
  await backToHome(page);
}

/** Opens Settings/Providers and reports what the app has stored. */
async function readStoredProvider(page) {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Providers", exact: false }).first().click();
  await page.waitForTimeout(1200);

  const model = await page.locator('input[placeholder*="Select or type model"]').inputValue();
  const keyPlaceholder = (await page.locator('input[type="password"]').getAttribute("placeholder")) ?? "";
  const active = /answered with|Active/i.test(await page.evaluate(() => document.body.innerText));
  const providerLine = (await page.evaluate(() => document.body.innerText))
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^Active:/i.test(line));

  return {
    active,
    model,
    keyStored: keyPlaceholder.startsWith("Stored:"),
    provider: providerLine ?? null,
  };
}

/**
 * The provider test writes one short verdict into the panel. Reading that line is
 * more precise than searching the whole page, which is how an earlier version of
 * this script mistook an unrelated message for a passing test.
 */
async function waitForTestMessage(page) {
  const verdict = /(answered with|could not be reached|did not answer in time|rate limit|not wired|No API key|Unknown provider|needs a base URL)/i;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.body.innerText);
    const line = text
      .split("\n")
      .map((entry) => entry.trim())
      .find((entry) => verdict.test(entry));
    if (line !== undefined) return line;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

/**
 * Returns to the review setup screen.
 *
 * A reload is used rather than the Settings nav because the nav sits inside a
 * panel that collapses to zero width, and the app's own "Back to app" control is
 * then genuinely unclickable — a UI detail, not something this harness should
 * hang on. The reload lands on the same screen a user gets on next launch.
 */
async function backToHome(page) {
  await page.reload();
  await page.getByText("Start a code review", { exact: false }).waitFor({ timeout: 45_000 });
}

async function waitForPattern(page, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.body.innerText);
    if (pattern.test(text)) return text;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

/** Rows read from the rendered findings list: "file:line - category" plus the severity badge. */
function readFindings(bodyText) {
  const lines = bodyText.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const findings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(.+?):(\d+)(?:-(\d+))? - (.+)$/.exec(lines[index]);
    if (match === null) continue;
    const severity = /^(critical|high|medium|low)$/.test(lines[index - 2] ?? "") ? lines[index - 2] : null;
    findings.push({
      title: lines[index - 1] ?? "",
      file: match[1],
      line: Number(match[2]),
      lineEnd: match[3] === undefined ? Number(match[2]) : Number(match[3]),
      category: match[4],
      severity,
    });
  }
  return findings;
}

/**
 * The review state the app prints for the run.
 *
 * Read from the UI rather than reassembled from the rows: the results screen
 * splits findings across an open list and an approval queue, so counting rows
 * alone under-reports what the review found.
 */
function readSummary(text) {
  const match = /Current review state: (\d+) open finding\(s\), (\d+) queued approval item\(s\), (\d+) candidate finding\(s\)/.exec(
    text,
  );
  if (match === null) return { open: 0, queued: 0, candidates: 0, total: 0 };
  const open = Number(match[1]);
  const queued = Number(match[2]);
  const candidates = Number(match[3]);
  return { open, queued, candidates, total: open + queued + candidates };
}

/** "Files reviewed: 9/9" — the app's own statement of the scope it walked. */
function readReviewed(text) {
  return /Files reviewed:\s*(\S+)/.exec(text)?.[1] ?? "unknown";
}

function reportFindingAnchors(findings) {
  const duplicates = findings.filter(
    (finding, index) =>
      findings.findIndex((other) => other.file === finding.file && other.line === finding.line) !== index,
  );
  record(
    "No duplicate finding anchors",
    duplicates.length === 0 ? "PASS" : "FAIL",
    duplicates.length === 0
      ? `${findings.length} anchor(s) read from the open list, each reported once`
      : `duplicated: ${duplicates.map((d) => d.file).join(", ")}`,
  );
  for (const finding of findings) {
    note(`finding: ${finding.file}:${finding.line} ${finding.title} (${finding.category})`);
  }
}

async function assertFindingDetail(page, findings) {
  if (findings.length === 0) {
    record("Finding click -> detail", "FAIL", "there was no finding to click");
    return;
  }
  const target = findings.find((finding) => finding.file.includes("data-access.ts")) ?? findings[0];
  const row = page.locator("button", { hasText: `${target.file}:${target.line}` }).first();
  await row.click();
  const detail = await waitForPattern(page, new RegExp(`${escapeRegExp(target.file)}:${target.line}`), 15_000);
  const locationOk = detail !== null && detail.includes(`${target.file}:${target.line}`);
  const evidenceOk = detail !== null && /SELECT|innerHTML|os\.system|query|sanitize/i.test(detail);
  record(
    "Finding click -> detail anchored to the right line",
    locationOk ? "PASS" : "FAIL",
    locationOk ? `detail panel shows ${target.file}:${target.line}` : "the detail panel did not show the anchor",
  );
  record(
    "Finding detail carries evidence from the source",
    evidenceOk ? "PASS" : "FAIL",
    evidenceOk ? "the detail panel quotes code from the file" : "no quoted source was found in the detail panel",
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The lines of the results screen that carry a number or a finding, so a run can
 * be read back from the report without a screenshot.
 */
function resultsDigest(text) {
  const interesting = /(finding|finding\(s\)|queued|risk|coverage|score|open|review item|files?\b|\d+%)/i;
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && interesting.test(line))
    .slice(0, 24)
    .join(" | ");
}

await main();
