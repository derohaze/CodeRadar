import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { detectLanguage } from "../src/core/languages/detect.ts";
import { createSourceFile, createSourceIndex } from "../src/core/repository/source.ts";
import type { SourceFile } from "../src/core/repository/source.ts";
import { ALL_DETECTORS, detectorsFor, runDetectors } from "../src/core/review/detectors/index.ts";
import { validateCandidate } from "../src/core/findings/validate.ts";

/**
 * Reads a fixture from disk rather than inlining its text, so the detectors are
 * proven against real files with real line endings, and a fixture edit cannot
 * silently drift away from what the test believes it contains.
 */
async function fixtureSource(relative: string): Promise<SourceFile> {
  const url = new URL(`./fixtures/${relative}`, import.meta.url);
  return createSourceFile(relative, await readFile(url, "utf8"));
}

/** The line number a human would point at, computed independently of the detector. */
function lineOf(source: SourceFile, needle: string): number {
  const index = source.lines.findIndex((line) => line.includes(needle));
  expect(index).toBeGreaterThanOrEqual(0);
  return index + 1;
}

function detect(source: SourceFile) {
  return runDetectors(source, detectLanguage(source.path, source.content));
}

describe("javascript detectors", () => {
  it("anchors the off-by-one to the loop header, not the function", async () => {
    const source = await fixtureSource("buggy/src/collections.ts");
    const finding = detect(source).candidates.find((entry) => entry.detector === "js.off-by-one-loop-bound");

    expect(finding).toBeDefined();
    expect(finding?.line).toBe(lineOf(source, "index <= scores.length"));
    expect(finding?.severity).toBe("high");
    expect(finding?.axis).toBe("correctness");
    expect(finding?.suggestedPatch).toContain("+++ b/buggy/src/collections.ts");
  });

  it("anchors the lexicographic sort to the sort call", async () => {
    const source = await fixtureSource("buggy/src/collections.ts");
    const finding = detect(source).candidates.find(
      (entry) => entry.detector === "js.numeric-sort-without-comparator",
    );

    expect(finding).toBeDefined();
    expect(finding?.line).toBe(lineOf(source, "totals.sort()"));
    expect(finding?.suggestedPatch).toContain("sort((a, b) => a - b)");
  });

  it("flags a NaN comparison with a usable patch", async () => {
    const source = await fixtureSource("buggy/src/validation.ts");
    const finding = detect(source).candidates.find((entry) => entry.detector === "js.nan-comparison");

    expect(finding).toBeDefined();
    expect(finding?.line).toBe(lineOf(source, "score === NaN"));
    expect(finding?.suggestedPatch).toContain("Number.isNaN(score)");
  });

  it("flags a hardcoded credential as critical", async () => {
    const source = await fixtureSource("buggy/src/config.ts");
    const finding = detect(source).candidates.find((entry) => entry.detector === "js.hardcoded-secret");

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("critical");
    expect(finding?.axis).toBe("security");
    expect(finding?.line).toBe(lineOf(source, "apiKey:"));
  });

  it("flags SQL built by interpolation", async () => {
    const source = await fixtureSource("buggy/src/data-access.ts");
    const finding = detect(source).candidates.find(
      (entry) => entry.detector === "js.sql-string-interpolation",
    );

    expect(finding).toBeDefined();
    expect(finding?.line).toBe(lineOf(source, "SELECT id, email"));
  });

  it("flags markup assigned from an interpolated template", async () => {
    const source = await fixtureSource("buggy/src/render.ts");
    const finding = detect(source).candidates.find((entry) => entry.detector === "js.html-injection");

    expect(finding).toBeDefined();
    expect(finding?.line).toBe(lineOf(source, "host.innerHTML"));
  });

  it("flags a shell command built from a value", async () => {
    const source = await fixtureSource("buggy/src/runner.ts");
    const finding = detect(source).candidates.find(
      (entry) => entry.detector === "js.shell-command-interpolation",
    );

    expect(finding).toBeDefined();
    expect(finding?.line).toBe(lineOf(source, "execSync(`tar"));
  });

  it("flags a security-sensitive value from Math.random", async () => {
    const source = await fixtureSource("buggy/src/tokens.ts");
    const finding = detect(source).candidates.find((entry) => entry.detector === "js.weak-random-secret");

    expect(finding).toBeDefined();
    expect(finding?.line).toBe(lineOf(source, "Math.random()"));
  });
});

describe("python detectors", () => {
  it("flags a mutable default argument on the definition line", async () => {
    const source = await fixtureSource("buggy/py/reports.py");
    const finding = detect(source).candidates.find(
      (entry) => entry.detector === "py.mutable-default-argument",
    );

    expect(finding).toBeDefined();
    expect(finding?.axis).toBe("correctness");
    expect(finding?.line).toBe(lineOf(source, "def collect_totals"));
  });

  it("flags os.system with an f-string", async () => {
    const source = await fixtureSource("buggy/py/deploy.py");
    const finding = detect(source).candidates.find(
      (entry) => entry.detector === "py.shell-command-interpolation",
    );

    expect(finding).toBeDefined();
    expect(finding?.line).toBe(lineOf(source, "os.system"));
  });

  it("does not run JavaScript detectors on Python files", () => {
    const pythonOnly = detectorsFor({ family: "python" }).map((detector) => detector.id);

    expect(pythonOnly).toContain("py.mutable-default-argument");
    expect(pythonOnly).not.toContain("js.nan-comparison");
    expect(detectorsFor({ family: "rust" })).toEqual([]);
  });
});

describe("false positive control", () => {
  it("reports nothing in the correct fixture", async () => {
    for (const relative of ["clean/src/session.ts", "clean/src/retry.ts"]) {
      const source = await fixtureSource(relative);
      const result = detect(source);

      expect(result.failed).toEqual([]);
      expect(result.candidates).toEqual([]);
    }
  });
});

describe("detector output integrity", () => {
  const FIXTURE_FILES = [
    "buggy/src/collections.ts",
    "buggy/src/validation.ts",
    "buggy/src/config.ts",
    "buggy/src/data-access.ts",
    "buggy/src/render.ts",
    "buggy/src/runner.ts",
    "buggy/src/tokens.ts",
    "buggy/py/reports.py",
    "buggy/py/deploy.py",
  ];

  it("emits evidence the validator can verify, for every fixture", async () => {
    // A detector that quotes something it did not read would look correct in
    // isolation and be dropped in production. This proves the quotes are real.
    const index = createSourceIndex(await Promise.all(FIXTURE_FILES.map(fixtureSource)));

    for (const relative of FIXTURE_FILES) {
      const source = await fixtureSource(relative);
      for (const candidate of detect(source).candidates) {
        const outcome = validateCandidate(candidate, index, { origin: "detector" });
        if (!outcome.ok) {
          throw new Error(`${candidate.detector} on ${relative} was rejected: ${outcome.rejected.reason}`);
        }
        expect(outcome.finding.location.file).toBe(relative);
      }
    }
  });

  it("produces at least one candidate per buggy fixture", async () => {
    for (const relative of FIXTURE_FILES) {
      const source = await fixtureSource(relative);
      expect(detect(source).candidates.length).toBeGreaterThan(0);
    }
  });

  it("gives every detector a unique id, so a report can name the one that fired", () => {
    // A detector that serves several families must be declared once, or the
    // same id would appear twice and two different patterns would be
    // indistinguishable in the rejection counts.
    const ids = ALL_DETECTORS.map((detector) => detector.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
