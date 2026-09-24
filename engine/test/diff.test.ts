import { describe, expect, it } from "bun:test";
import {
  addedLineNumbers,
  changedLineNumbers,
  diffPaths,
  parseUnifiedDiff,
} from "../src/core/diff/unified.ts";

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,5 +1,6 @@
 export function sum(items: number[]): number {
   let total = 0;
-  for (let i = 0; i < items.length; i += 1) {
+  for (let i = 0; i <= items.length; i += 1) {
     total += items[i];
   }
+  return total;
 }
diff --git a/src/removed.ts b/src/removed.ts
deleted file mode 100644
--- a/src/removed.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const a = 1;
-const b = 2;
diff --git a/src/old.ts b/src/renamed.ts
similarity index 100%
rename from src/old.ts
rename to src/renamed.ts
diff --git a/assets/logo.png b/assets/logo.png
index 3333333..4444444 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
`;

describe("parseUnifiedDiff", () => {
  const parsed = parseUnifiedDiff(DIFF);

  it("finds every file the diff touched", () => {
    expect(parsed.hasContent).toBe(true);
    expect(diffPaths(parsed)).toEqual([
      "src/app.ts",
      "src/removed.ts",
      "src/renamed.ts",
      "assets/logo.png",
    ]);
  });

  it("models the hunk header and its lines", () => {
    const file = parsed.files[0];
    expect(file?.path).toBe("src/app.ts");
    expect(file?.hunks).toHaveLength(1);

    const hunk = file?.hunks[0];
    expect(hunk?.oldStart).toBe(1);
    expect(hunk?.oldCount).toBe(5);
    expect(hunk?.newStart).toBe(1);
    expect(hunk?.newCount).toBe(6);

    const additions = hunk?.lines.filter((line) => line.kind === "add") ?? [];
    expect(additions.map((line) => line.text)).toEqual([
      "  for (let i = 0; i <= items.length; i += 1) {",
      "  return total;",
    ]);
    expect(additions.map((line) => line.newLine)).toEqual([3, 6]);

    const deletions = hunk?.lines.filter((line) => line.kind === "del") ?? [];
    expect(deletions.map((line) => line.oldLine)).toEqual([3]);
    expect(deletions[0]?.newLine).toBeNull();
  });

  it("reports the exact lines a review may anchor to", () => {
    const file = parsed.files[0];
    if (file === undefined) throw new Error("expected src/app.ts in the diff");

    expect([...addedLineNumbers(file)].sort((a, b) => a - b)).toEqual([3, 6]);
  });

  it("keeps changed-line expansion inside the hunk", () => {
    const file = parsed.files[0];
    if (file === undefined) throw new Error("expected src/app.ts in the diff");

    const lines = [...changedLineNumbers(file)].sort((a, b) => a - b);
    // The hunk covers new lines 1 to 6. Expansion must not reach line 7.
    expect(lines[0]).toBe(1);
    expect(lines[lines.length - 1]).toBe(6);
    expect(lines).not.toContain(7);
  });

  it("treats a deleted file as absent on the new side and keeps its old path", () => {
    const file = parsed.files[1];
    expect(file?.path).toBe("src/removed.ts");
    expect(file?.newExists).toBe(false);
    expect(file?.oldExists).toBe(true);

    const additions = file === undefined ? new Set<number>() : addedLineNumbers(file);
    expect(additions.size).toBe(0);
  });

  it("marks a rename and uses the new path", () => {
    const file = parsed.files[2];
    expect(file?.isRename).toBe(true);
    expect(file?.oldPath).toBe("src/old.ts");
    expect(file?.path).toBe("src/renamed.ts");
  });

  it("marks a binary file without inventing hunks", () => {
    const file = parsed.files[3];
    expect(file?.isBinary).toBe(true);
    expect(file?.hunks).toHaveLength(0);
  });

  it("returns nothing usable for empty input", () => {
    const empty = parseUnifiedDiff("");
    expect(empty.hasContent).toBe(false);
    expect(empty.files).toEqual([]);
  });

  it("ignores the no-newline marker instead of treating it as content", () => {
    const parsedNoNewline = parseUnifiedDiff(
      [
        "diff --git a/x.txt b/x.txt",
        "--- a/x.txt",
        "+++ b/x.txt",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "\\ No newline at end of file",
      ].join("\n"),
    );

    const file = parsedNoNewline.files[0];
    expect(file?.hunks[0]?.lines).toHaveLength(2);
    expect(file?.hunks[0]?.lines[1]?.text).toBe("new");
  });

  it("parses a plain diff that has no git header", () => {
    const parsedPlain = parseUnifiedDiff(
      ["--- a/plain.ts", "+++ b/plain.ts", "@@ -1,1 +1,2 @@", " keep", "+added"].join("\n"),
    );

    expect(parsedPlain.files[0]?.path).toBe("plain.ts");
    const file = parsedPlain.files[0];
    if (file === undefined) throw new Error("expected plain.ts");
    expect([...addedLineNumbers(file)]).toEqual([2]);
  });

  it("defaults a hunk count that git omitted", () => {
    const parsedSingle = parseUnifiedDiff(
      ["diff --git a/y.txt b/y.txt", "--- a/y.txt", "+++ b/y.txt", "@@ -1 +1 @@", "-a", "+b"].join("\n"),
    );

    expect(parsedSingle.files[0]?.hunks[0]?.oldCount).toBe(1);
    expect(parsedSingle.files[0]?.hunks[0]?.newCount).toBe(1);
  });
});
