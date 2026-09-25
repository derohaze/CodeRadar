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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
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

/**
 * Rendered only while a review is running, so seeing it proves one is in flight.
 *
 * The earlier version of this script waited for a "%", which the finished results
 * screen also prints ("100% COVERED"). That made the wait pass instantly against
 * the *previous* review's screen, so the next review was started while the current
 * one was still running — which the API correctly refused with 409. The refusal
 * was real; the reason was this harness, not the app.
 */
const RUNNING_MARKER = "Stop review";
/** Rendered only by the finished-results screen. */
const RESULTS_MARKER = "Validated findings";

const checks = [];
const notes = [];
/** Reviews the local API refused because another one was still claimed. */
const refusedReviews = [];
/** Reviews this run started without restarting the app. */
let startedReviews = 0;

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
    if (message.type() !== "error") return;
    const text = message.text();
    // The renderer logs the status it received, which is how a refused review is
    // told apart from one that simply took a while.
    if (/status: 409/.test(text)) refusedReviews.push(text.slice(0, 200));
    note(`renderer console error: ${text.slice(0, 200)}`);
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
    if (text.includes(RESULTS_MARKER)) return text;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`no results screen within ${REVIEW_TIMEOUT_MS}ms`);
}

/**
 * Waits for the progress screen, which only exists while a review is running.
 *
 * This is the gate that keeps every later step honest: nothing is read until a
 * review has demonstrably started, so a refused or refused-looking start is
 * reported as a failure instead of being read as the previous review's results.
 */
async function waitForReviewStarted(targetPath) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes(RUNNING_MARKER)) return text;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const seen = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "(unreadable)");
  throw new Error(`the review never started for ${targetPath}. body=${JSON.stringify(seen)}`);
}

/** The committed loop bound. The altered one below is what creates a changed line. */
const GIT_FIXTURE_PAGING_INITIAL = `/** Fixture: the loop bound is altered on a changed line. */

export function sumScores(scores: number[]): number {
  let total = 0;
  for (let index = 0; index < scores.length; index += 1) {
    total += scores[index];
  }
  return total;
}
`;

/** The working-tree version, deliberately left uncommitted. */
const GIT_FIXTURE_PAGING_CHANGED = GIT_FIXTURE_PAGING_INITIAL.replace("index < scores.length", "index <= scores.length");

/** A defect no commit in the fixture history touches. */
const GIT_FIXTURE_SORTING = `/** Fixture: a defect on an unchanged line. */

export function sortedScores(scores: number[]): number[] {
  const totals: number[] = [...scores];
  return totals.sort();
}
`;

/**
 * A real git repository, built by this run, outside the project.
 *
 * The git and changed-only checks need a history they control: one defect on a
 * line that changed since the base branch, and one on a line that did not. The
 * altered loop bound is left uncommitted on purpose, because that is what makes
 * it a changed line for `git diff <base>`.
 */
function createFixtureRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "coderadar-gui-git-"));
  const git = (args) => execSync(`git ${args}`, { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "paging.ts"), GIT_FIXTURE_PAGING_INITIAL);
  writeFileSync(path.join(root, "src", "sorting.ts"), GIT_FIXTURE_SORTING);
  writeFileSync(path.join(root, "README.md"), "# Fixture repository for the CodeRadar GUI smoke test\n");

  git("init -b main");
  git("config user.email smoke@example.invalid");
  git('config user.name "CodeRadar smoke"');
  git("add -A");
  git('commit -m "fixture: initial state"');

  writeFileSync(path.join(root, "src", "paging.ts"), GIT_FIXTURE_PAGING_CHANGED);
  return root;
}

/**
 * The files the ai-review fixture's own ground truth says are wrong.
 *
 * Read from the tracked table rather than copied here, so the check cannot drift
 * from the fixture it is scoring against. The fixture's `repo/` is the reviewed
 * scope and `GROUND_TRUTH.md` sits deliberately outside it.
 */
function readGroundTruthFiles() {
  const groundTruth = path.join(FIXTURES, "ai-review", "GROUND_TRUTH.md");
  if (!existsSync(groundTruth)) return [];

  return [...readFileSync(groundTruth, "utf8").matchAll(/^\|\s*D\d+\s*\|\s*`([^`]+)`/gm)].map((match) => match[1]);
}

/** The engine's address and launch token, exactly as the renderer received them. */
async function readEngineAccess() {
  return page.evaluate(() => ({
    baseUrl: window.electronAPI?.apiBaseUrl ?? null,
    token: window.electronAPI?.apiToken ?? null,
  }));
}

async function engineGet(access, pathname) {
  const response = await fetch(`${access.baseUrl}${pathname}`, {
    headers: access.token === null ? {} : { "X-CodeRadar-Token": access.token },
  });
  return response.json();
}

/** The ids of the sessions the engine is holding, oldest first. */
async function sessionIds() {
  const sessions = await engineGet(await readEngineAccess(), "/sessions");
  return sessions.map((session) => session.id);
}

/**
 * The session a review just created, plus the findings the engine returned for it.
 *
 * The results screen splits findings into an open list and an approval queue, and
 * only the open list renders file:line. So the screen cannot say whether a defect
 * the review dropped was dropped on purpose — a changed-only review and a broken
 * review can look identical on it. The engine's own response can tell them apart,
 * and it is the same response the renderer rendered.
 */
async function readFinishedSession(idsBeforeStart) {
  const access = await readEngineAccess();
  const sessions = await engineGet(access, "/sessions");
  const created = sessions.find((session) => !idsBeforeStart.includes(session.id));
  if (created === undefined) throw new Error("the review did not create a session");

  return engineGet(access, `/scans/${created.id}`);
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

/**
 * Chooses a Preset / Review mode value through the app's own Select.
 *
 * Both controls are comboboxes with no test id, so the right one is found by the
 * value it currently shows — the preset trigger shows a preset name, the mode
 * trigger shows "Deep review" or "Fast review".
 */
async function chooseFromSelect(triggerPattern, optionLabel) {
  const trigger = page.locator('button[role="combobox"]').filter({ hasText: triggerPattern }).first();
  await trigger.click();
  await page.getByRole("option", { name: new RegExp(`^${escapeRegExp(optionLabel)}$`) }).click();
}

async function startReview(targetPath, kind, options = {}) {
  if (options.preset !== undefined) await chooseFromSelect(/Safe mode|Balanced|Aggressive/, options.preset);
  if (options.scanMode !== undefined) await chooseFromSelect(/Deep review|Fast review/, options.scanMode);

  await targetToggle(page, kind === "file" ? "File" : "Folder").click();
  // The app's own "Recent" chip: select by the full path it carries as its title,
  // so a Windows path never goes through a CSS attribute selector.
  await page.getByTitle(targetPath, { exact: true }).first().click();
  const pathShown = await page.evaluate(() => document.body.innerText.includes("No source selected"));
  if (pathShown) throw new Error(`the source was not selected: ${targetPath}`);

  await page.getByRole("button", { name: /Run review/ }).click();
  const progress = await waitForReviewStarted(targetPath);
  startedReviews += 1;
  note(`review started: ${targetPath} (${options.preset ?? "default preset"}, ${options.scanMode ?? "default mode"})`);
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
  const fixtureRepo = createFixtureRepository();
  await seedRecent([
    { path: FIXTURES + "\\buggy", type: "folder", workspace: "fixtures" },
    { path: FIXTURES + "\\clean", type: "folder", workspace: "fixtures" },
    { path: FIXTURES + "\\buggy\\src\\render.ts", type: "file", workspace: "src" },
    { path: fixtureRepo, type: "folder", workspace: "git-fixture" },
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
  const folderIdsBefore = await sessionIds();
  await startReview(path.join(FIXTURES, "buggy"), "folder", { preset: "Balanced", scanMode: "Deep review" });
  const watcher = setInterval(() => {
    for (const name of pythonOrRustRunning()) foreignProcesses.push(name);
  }, 1500);

  const folderResults = await waitForResults();
  const folderDetail = await readFinishedSession(folderIdsBefore);
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

  // ---- 4. A second review, started from the finished review's screen ------
  // The results screen on view is exactly the state a user presses Review in
  // next, so the second run happens with no reload and nothing in between. The
  // progress screen must be the one that appears: if the previous review still
  // held the engine, the app would have been refused and the old results would
  // still be on screen.
  await navigateHome(page);
  const fileStarted = await startReview(path.join(FIXTURES, "buggy", "src", "render.ts"), "file");
  record(
    "Second review starts from the finished review's screen",
    fileStarted.includes(RUNNING_MARKER) && !fileStarted.includes(RESULTS_MARKER) ? "PASS" : "FAIL",
    "a new review started with the previous results still the last screen, and nothing was refused",
  );

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
  await startReview(path.join(FIXTURES, "clean"), "folder", { preset: "Balanced", scanMode: "Deep review" });
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
  const repoIdsBefore = await sessionIds();
  await startReview(fixtureRepo, "folder", { preset: "Balanced", scanMode: "Deep review" });
  const repoResults = await waitForResults();
  const repoDetail = await readFinishedSession(repoIdsBefore);
  const repoFiles = repoDetail.findings.map((finding) => finding.file);
  const escaped = repoFiles.filter((file) => file.includes("..") || file.includes("GROUND_TRUTH"));
  const sawChangedFile = repoFiles.some((file) => file.endsWith("src/paging.ts"));
  const sawUnchangedFile = repoFiles.some((file) => file.endsWith("src/sorting.ts"));
  record(
    "Git repository review",
    sawChangedFile && sawUnchangedFile && escaped.length === 0 ? "PASS" : "FAIL",
    `both planted defects came back from a real repository the engine found its own root in: ${repoDetail.findings.length} finding(s) (${repoFiles.join(", ") || "none"}), ${readReviewed(repoResults)} reviewed, ${repoDetail.session.candidate_findings_count} candidate(s), ${escaped.length} outside the selected scope`,
  );
  note(`fixture repository digest: ${resultsDigest(repoResults)}`);

  // ---- 7. Changed-only, requested through the review mode control ---------
  await navigateHome(page);
  const fastIdsBefore = await sessionIds();
  await startReview(fixtureRepo, "folder", { preset: "Balanced", scanMode: "Fast review" });
  const fastResults = await waitForResults();
  const fastDetail = await readFinishedSession(fastIdsBefore);
  const fastFiles = fastDetail.findings.map((finding) => finding.file);
  const anchored = /anchored to lines changed against \S+/.test(fastResults);
  const keptChanged = fastFiles.some((file) => file.endsWith("src/paging.ts"));
  const droppedUnchanged = !fastFiles.some((file) => file.endsWith("src/sorting.ts"));
  record(
    "Review mode changes scope (Fast vs Deep)",
    anchored && keptChanged && droppedUnchanged && fastDetail.findings.length < repoDetail.findings.length ? "PASS" : "FAIL",
    `Fast reviewed only the changed file and reported its defect (${fastDetail.findings.length} finding(s): ${fastFiles.join(", ") || "none"}, ${readReviewed(fastResults)} reviewed), while Deep reported ${repoDetail.findings.length} from the whole repository; anchoring note: ${anchored}`,
  );
  note(`changed-only digest: ${resultsDigest(fastResults)}`);

  // ---- 8. The preset reaches the engine -----------------------------------
  await navigateHome(page);
  const safeIdsBefore = await sessionIds();
  await startReview(path.join(FIXTURES, "buggy"), "folder", { preset: "Safe mode", scanMode: "Deep review" });
  const safeResults = await waitForResults();
  const safeDetail = await readFinishedSession(safeIdsBefore);
  // The app's state summary counts a capped-out defect separately from a
  // validated one, and says so as a candidate. The budget is therefore compared
  // against the findings the engine actually returned, not that mixed total: the
  // defects Safe mode chooses not to assert are still visible as candidates.
  record(
    "Preset changes the finding budget",
    safeDetail.findings.length > 0 && safeDetail.findings.length < folderDetail.findings.length ? "PASS" : "FAIL",
    `Safe mode returned ${safeDetail.findings.length} finding(s) where Balanced returned ${folderDetail.findings.length} for the same folder; the difference is visible as candidates (${safeDetail.session.candidate_findings_count} vs ${folderDetail.session.candidate_findings_count})`,
  );
  note(`safe mode digest: ${resultsDigest(safeResults)}`);

  // ---- 9. Real model accuracy against the fixture's own ground truth ------
  const groundTruth = readGroundTruthFiles();
  const groundTruthRepo = path.join(FIXTURES, "ai-review", "repo");
  if (groundTruth.length === 0 || !existsSync(groundTruthRepo)) {
    record("Real AI accuracy against ground truth", "NOT RUN", "the ai-review fixture repository is not present");
  } else {
    // The setup screen lists three recent sources at a time, so the source this
    // check needs is seeded immediately before it, sorted first.
    await seedRecent([
      { path: FIXTURES + "\\ai-review\\repo", type: "folder", workspace: "ai-review" },
      { path: FIXTURES + "\\buggy", type: "folder", workspace: "fixtures" },
    ]);
    const truthIdsBefore = await sessionIds();
    await startReview(groundTruthRepo, "folder", { preset: "Balanced", scanMode: "Deep review" });
    const truthResults = await waitForResults();
    const truthDetail = await readFinishedSession(truthIdsBefore);
    const reportedFiles = truthDetail.findings.map((finding) => finding.file);
    const covered = groundTruth.filter((file) => reportedFiles.some((seen) => seen.endsWith(file)));
    const missed = groundTruth.filter((file) => !covered.includes(file));
    // The ground truth file sits above the reviewed scope on purpose, so a
    // finding that mentions it (or walks out of the scope) escaped the selection.
    const escaped = reportedFiles.filter((file) => file.includes("GROUND_TRUTH") || file.includes(".."));

    record(
      "Real AI accuracy against ground truth",
      covered.length > 0 && escaped.length === 0 ? "PASS" : "FAIL",
      `${covered.length}/${groundTruth.length} planted defects surfaced in ${truthDetail.findings.length} finding(s) with ${truthDetail.session.candidate_findings_count} candidate(s) dropped by the review bar; missed: ${missed.join(", ") || "none"}; ${escaped.length} finding(s) referenced code outside the selected scope`,
    );
    // Why the review bar dropped a candidate is the difference between "the model
    // found nothing" and "the model's finding did not survive validation", so the
    // reasons the app prints are recorded next to the score.
    const candidateReasons =
      resultsDigest(truthResults)
        .split(" | ")
        .filter((line) => /dropped|not in source|over finding cap/i.test(line))
        .join(" | ") || "no candidate reason was printed";
    note(`ground truth candidate reasons: ${candidateReasons}`);
    note(`ground truth digest: ${resultsDigest(truthResults)}`);
    note(`ground truth missed files: ${missed.join(", ") || "none"}`);
  }

  // ---- 10. Every review this session started ------------------------------
  record(
    "No review was refused while another was claimed",
    refusedReviews.length === 0 ? "PASS" : "FAIL",
    refusedReviews.length === 0
      ? `${startedReviews} review(s) ran back to back in one app session with no 409`
      : `${refusedReviews.length} refusal(s): ${refusedReviews.join(" | ")}`,
  );
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
