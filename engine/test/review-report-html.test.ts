/**
 * The report as a document a person opens.
 *
 * Two properties matter more than the layout, and both are tested against a real
 * run rather than a hand-built object: the page must show every finding the
 * report holds (not a summary of them), and nothing the report quotes out of the
 * reviewed code may become markup in it.
 */

import { describe, expect, it } from "bun:test";
import path from "node:path";
import { createNodeFileSystem } from "../src/adapters/node-fs.ts";
import type { ReviewReport } from "../src/core/findings/model.ts";
import { ReviewEngine } from "../src/core/review/engine.ts";
import { renderReviewReportHtml } from "../src/core/review/report/html.ts";

const PROMPTS_DIR = path.join(import.meta.dir, "..", "prompts");
const BUGGY = path.join(import.meta.dir, "fixtures", "buggy");
const CLEAN = path.join(import.meta.dir, "fixtures", "clean");
const RENDERED_AT = "2026-01-01T00:00:00.000Z";

function reviewOf(target: string, collectTrace = true): Promise<ReviewReport> {
  return new ReviewEngine({ fs: createNodeFileSystem(), promptsDir: PROMPTS_DIR, collectTrace }).review({ target });
}

/**
 * The text as the page must carry it.
 *
 * The expectation is written here rather than imported from the renderer: an
 * escaping test that reuses the escaping code only proves the code equals itself.
 */
function asText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

describe("the review report as an HTML document", () => {
  it("shows every finding the report holds, with its evidence and anchor", async () => {
    const report = await reviewOf(BUGGY);
    const html = renderReviewReportHtml(report, { generatedAt: RENDERED_AT });

    expect(report.findings.length).toBeGreaterThan(0);
    for (const finding of report.findings) {
      expect(html).toContain(asText(finding.title));
      expect(html).toContain(asText(finding.evidence));
      expect(html).toContain(`${finding.location.file}:${finding.location.line}`);
    }

    expect(html).toContain(report.schema);
    expect(html).toContain(report.state);
    expect(html).toContain(RENDERED_AT);
  });

  it("renders one self-contained page: no script, no second request", async () => {
    const report = await reviewOf(BUGGY);
    const html = renderReviewReportHtml(report);

    // Nothing in the document may need the network, and nothing in it may run.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("src=");
    expect(html).not.toContain("@import");
    // The policy is the belt to the escaping's braces: no script source, no
    // connection, no frame. A quoted line from a hostile file stays text.
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("<style>");
  });

  it("keeps a hostile title or quote out of the markup", async () => {
    const report = await reviewOf(BUGGY);
    const finding = report.findings[0];
    if (finding === undefined) throw new Error("expected the fixture to produce a finding");

    const hostile: ReviewReport = {
      ...report,
      summary: `<img src=x onerror="alert('summary')">`,
      findings: [
        {
          ...finding,
          title: `<script>alert("title")</script>`,
          evidence: `const a = "</pre><script>alert(1)</script>";`,
        },
      ],
    };
    const html = renderReviewReportHtml(hostile);

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;/pre&gt;&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(&#39;summary&#39;)&quot;&gt;");
  });

  it("states that the model did not run instead of implying it judged the code", async () => {
    const report = await reviewOf(CLEAN);
    const html = renderReviewReportHtml(report);

    // The deterministic half only: no provider was configured for this run. A
    // coverage bar here would claim a judgement nothing made.
    expect(report.stats.aiReview).toBeNull();
    expect(html).toContain("The model was not part of this run");
    expect(html).not.toContain('class="strip"');
  });

  it("says a run without a trace cannot be read as a full one", async () => {
    const report = await reviewOf(BUGGY);
    const traced = renderReviewReportHtml(report);
    const untraced = renderReviewReportHtml({ ...report, trace: undefined });

    // A run that collected a trace lists its files; one that did not says so
    // rather than leaving the reader to assume every file was judged.
    expect(report.trace).toBeDefined();
    expect(traced).toContain("Files reviewed");
    expect(traced).not.toContain("did not collect a per-file trace");
    expect(untraced).toContain("did not collect a per-file trace");
  });
});
