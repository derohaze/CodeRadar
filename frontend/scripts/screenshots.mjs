#!/usr/bin/env node
/**
 * README screenshots, taken from the real app.
 *
 * The README shows what the product looks like, so the images have to come from
 * the running Electron app and from a review the engine actually performed —
 * not from a mock-up. This script drives the same window a user drives, in the
 * same order a user would: pick a source, run the review, read the findings,
 * open one.
 *
 * It is deliberately not a second smoke test. `gui-smoke.mjs` asserts behaviour
 * and stays as it is; this one only walks the screens worth photographing, so it
 * finishes in a couple of minutes and can be re-run whenever the UI changes.
 *
 * Every capture asserts the marker that screen is known by, so a screenshot can
 * never be silently stale: if the progress screen or the findings list is not on
 * screen, the run fails instead of writing a picture of the wrong thing.
 *
 * Usage, from `frontend/` with the Vite dev server already running (`bun run dev`):
 *
 *   CODERADAR_AI_KEY=nvapi-... node scripts/screenshots.mjs
 *
 * Without a key the review still runs on the deterministic detectors, and the
 * provider screen is skipped.
 *
 * A capture that cannot be taken (no finding row to open, for instance) is
 * reported as skipped rather than left in place from an earlier run, so the
 * directory always describes one review.
 */

import { _electron as electron } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(FRONTEND_DIR, "..");
const FIXTURES = path.join(REPO_ROOT, "engine", "test", "fixtures");
const OUT_DIR = process.env["SCREENSHOT_DIR"] ?? path.join(REPO_ROOT, "docs", "screenshots");

const AI_KEY = process.env["CODERADAR_AI_KEY"] ?? "";
const AI_MODEL = process.env["CODERADAR_AI_MODEL"] ?? "nvidia/nemotron-3-super-120b-a12b";
const AI_BASE_URL = process.env["CODERADAR_AI_BASE_URL"] ?? "https://integrate.api.nvidia.com/v1";

/** A review with a model takes minutes; the window between the two markers does not. */
const REVIEW_TIMEOUT_MS = Number(process.env["SCREENSHOT_TIMEOUT_MS"] ?? 600_000);
/** Rendered only while a review is in flight. */
const RUNNING_MARKER = "Stop review";
/** Rendered only by the finished-results screen. */
const RESULTS_MARKER = "Validated findings";

/** Wide enough that the sidebar, the setup card, and the results all fit. */
const WIDTH = 1440;
const HEIGHT = 900;

let page;

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  // The set is replaced, not added to: a leftover file from an earlier run would
  // show a review that no longer matches the screenshots next to it.
  for (const entry of readdirSync(OUT_DIR)) {
    if (entry.endsWith(".png")) rmSync(path.join(OUT_DIR, entry));
  }
  process.stdout.write(`CodeRadar screenshots -> ${OUT_DIR}\n`);

  const app = await electron.launch({
    args: [FRONTEND_DIR],
    cwd: FRONTEND_DIR,
    env: { ...process.env, NODE_ENV: "development" },
  });

  try {
    page = await appWindow(app);
    // Bounded actionability waits: a selector that no longer matches should end
    // the run with an error, not sit there until the harness is killed.
    page.setDefaultTimeout(15_000);
    await page.waitForLoadState("domcontentloaded");
    await resize(app, WIDTH, HEIGHT);

    await waitForText(/start a code review/i, 60_000);
    // The source is chosen through the app's own "Recent" chips: Playwright cannot
    // drive a native file dialog, and this is a path the app already has.
    await seedRecent([
      { path: path.join(FIXTURES, "buggy"), type: "folder", workspace: "fixtures" },
      { path: path.join(FIXTURES, "ai-review", "repo"), type: "folder", workspace: "ai-review" },
      { path: path.join(FIXTURES, "clean"), type: "folder", workspace: "fixtures" },
    ]);

    await capture("01-review-setup");

    if (AI_KEY === "") {
      process.stdout.write("note    CODERADAR_AI_KEY was not set, so the provider screen was skipped\n");
    } else {
      await openProviders();
      await capture("02-providers");
      await saveProvider();
    }

    await backToHome();
    await startReview(path.join(FIXTURES, "buggy"));
    await capture("03-review-running");

    await waitForText(new RegExp(RESULTS_MARKER, "i"), REVIEW_TIMEOUT_MS);
    await capture("04-findings");
    await captureFindingDetail("05-finding-detail");
  } finally {
    await closeApp(app);
  }
}

/**
 * Writes one PNG and proves the screen behind it.
 *
 * The text is read back so the transcript records what was photographed, which is
 * the only way to tell a real results screen from an empty one without opening
 * the file.
 */
async function capture(name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  const body = await page.evaluate(() => document.body.innerText);
  if (body.trim().length === 0) throw new Error(`${name}: the page rendered no text, so the window was blank`);

  await page.screenshot({ path: file });
  process.stdout.write(`saved   ${path.relative(REPO_ROOT, file)}\n`);
  process.stdout.write(`        state: ${digestOf(body)}\n`);
}

/**
 * The lines that say what the screen is doing, so the transcript records the
 * state that was photographed. The window's own menu bar is the bulk of the raw
 * text and would otherwise drown it out.
 */
function digestOf(body) {
  const interesting = /(finding|review|risk|coverage|files?\b|\d+%|running|scanning|analyz|model|provider|active)/i;
  const noise = /^(File|Edit|View|Window|Help|Close Window|Quit|Undo|Redo|Cut|Copy|Paste|Delete|Select All)/;

  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && interesting.test(line) && !noise.test(line))
    .slice(0, 8)
    .join(" | ");
}

/** The app window, never the detached DevTools window development opens. */
async function appWindow(app) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const found = app.windows().find((candidate) => /^(https?:|file:)/.test(candidate.url()));
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`the app window never appeared; saw: ${app.windows().map((w) => w.url()).join(", ")}`);
}

/** The window is 1120x720 by default; the README shots are taken wider. */
async function resize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === "CodeRadar");
    if (window === undefined) return;
    window.setSize(size.width, size.height);
    window.center();
  }, { width, height });
  await page.waitForTimeout(700);
}

/** Polls the rendered text, because the app renders asynchronously at every step. */
async function waitForText(pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = await page.evaluate(() => document.body.innerText).catch(() => "");
    if (pattern.test(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`"${pattern}" never rendered. last body=${JSON.stringify(last.slice(0, 300))}`);
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
  await waitForText(/start a code review/i, 60_000);
}

async function openProviders() {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Providers", exact: false }).first().click();
  await page.getByRole("button", { name: /NVIDIA/ }).first().click();

  const keyInput = page.locator('input[type="password"]');
  const placeholder = (await keyInput.getAttribute("placeholder")) ?? "";
  if (!placeholder.startsWith("Stored:")) await keyInput.fill(AI_KEY);

  const modelInput = page.locator('input[placeholder*="Select or type model"]');
  if (((await modelInput.inputValue()) ?? "") === "") await modelInput.fill(AI_MODEL);

  // The live verdict is the point of this screen, so it is waited for, not assumed.
  await page.getByRole("button", { name: "Test connection" }).click();
  const verdict = await waitForText(/answered with/i, 90_000);
  process.stdout.write(`note    provider test: ${/(.{0,120}answered with.{0,80})/i.exec(verdict)?.[1] ?? "answered"}\n`);
}

async function saveProvider() {
  await page.getByRole("button", { name: "Save provider" }).click();
  await page.waitForTimeout(2500);
}

async function backToHome() {
  await page.reload();
  await waitForText(/start a code review/i, 60_000);
}

/** Picks a source and runs the review with the model, exactly as the smoke test does. */
async function startReview(target) {
  await page.locator("button.min-w-\\[84px\\]", { hasText: /^Folder$/ }).click();
  await page.getByTitle(target, { exact: true }).first().click();
  await page.getByRole("button", { name: /Run review/ }).click();

  await waitForText(new RegExp(RUNNING_MARKER, "i"), 45_000);
  process.stdout.write(`note    review started: ${target}\n`);
  // A few seconds of progress is what makes the shot show a review in flight
  // rather than the first frame after the button was pressed.
  await page.waitForTimeout(6000);
}

/** Opens the first finding so the detail panel, with its quoted evidence, is on screen. */
async function captureFindingDetail(name) {
  // The open list is the only list that renders a row as `file:line - category`,
  // and that row is the one worth opening. Matching that shape rather than the
  // first `file:line` in the page keeps the model's own prose out of the search.
  const rowPattern = /^(.+?):(\d+)(?:-(\d+))? - (.+)$/;
  const body = await page.evaluate(() => document.body.innerText);
  const rowMatch = body
    .split("\n")
    .map((line) => line.trim())
    .map((line) => rowPattern.exec(line))
    .find((match) => match !== null);

  if (rowMatch === null || rowMatch === undefined) {
    process.stdout.write(`skip    ${name}: no finding row was on screen to open\n`);
    return;
  }

  const label = `${rowMatch[1]}:${rowMatch[2]}`;
  try {
    await page.locator("button", { hasText: label }).first().click({ timeout: 10_000 });
  } catch {
    // The row is a button in the open list, but the text itself is clickable
    // wherever the app renders it, so this is the same interaction, looser.
    try {
      await page.getByText(label, { exact: false }).first().click({ timeout: 10_000 });
    } catch (error) {
      // The detail panel is a nice-to-have: a row that would not open must not
      // cost the screenshots that already succeeded.
      process.stdout.write(`skip    ${name}: ${String(error).split("\n")[0].slice(0, 160)}\n`);
      return;
    }
  }

  await page.waitForTimeout(1500);
  await capture(name);
}

/**
 * Closes the app and makes sure the process tree is gone either way: the app hides
 * to the tray instead of exiting, and an instance left behind holds the user-data
 * profile so the next launch renders nothing.
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

await main();
