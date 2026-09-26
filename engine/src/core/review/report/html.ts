/**
 * The review report as a standalone document.
 *
 * A finished review is already JSON, and JSON is not what a person reads at a
 * desk with a colleague. This renders the same report as one self-contained HTML
 * page: the verdict, the findings with their evidence, where the dropped
 * candidates stopped, what the model was shown, and the repository's own shape —
 * with the counts drawn as diagrams rather than listed as numbers.
 *
 * Three properties are deliberate:
 *
 * - **It is self-contained.** One inline stylesheet, no script, no network, no
 *   font or image reference. It opens the same way on a plane as on a desk, and
 *   it can be attached to a message and still render.
 * - **It cannot execute anything the report carries.** Every interpolated value
 *   is escaped, and the document ships a `default-src 'none'` policy with no
 *   script source, so a title or a quoted line from a hostile file is text and
 *   nothing else. Reviewing untrusted code must not become a way to run it.
 * - **It states only what the run recorded.** No score is invented, no slot is
 *   filled with a plausible number, and an absent trace or a model that never ran
 *   is written as exactly that.
 */

import {
  REVIEW_SEVERITIES,
  type RepositoryIndex,
  type ReviewFinding,
  type ReviewReport,
  type ReviewSeverity,
} from "../../findings/model.ts";

export interface ReviewReportHtmlOptions {
  /** Title shown in the browser tab and at the top of the page. */
  title?: string;
  /** When the document was rendered, ISO 8601. Defaults to now. */
  generatedAt?: string;
  /** The path that was reviewed, as the caller knows it. */
  source?: string | null;
}

/** One label and count, ready to be drawn as a bar. */
interface BarRow {
  label: string;
  value: number;
  note?: string;
  tone?: string;
}

/**
 * A value interpolated into the document.
 *
 * The report carries text from the reviewed repository — file names, quoted
 * source, a model's prose — and none of it may become markup. The quote
 * characters are escaped too, so one implementation serves both a text node and
 * an attribute value.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `72%`, or `n/a` when there is nothing to divide by. Null is not zero. */
function share(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${Math.round((part / whole) * 100)}%`;
}

/** `file.ts:12-18` / `file.ts:12`, the way a reviewer points at code. */
function anchor(finding: ReviewFinding): string {
  const { file, line, lineEnd } = finding.location;
  return lineEnd > line ? `${file}:${line}-${lineEnd}` : `${file}:${line}`;
}

function severityClass(severity: ReviewSeverity): string {
  return `sev-${severity}`;
}

function countBySeverity(findings: readonly ReviewFinding[]): Record<ReviewSeverity, number> {
  const counts: Record<ReviewSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/** Rows sorted by count, largest first, with a stable order for equal counts. */
function ranked(tally: Record<string, number>): Array<[string, number]> {
  return Object.entries(tally).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

/**
 * One measured bar.
 *
 * A bar whose length means nothing is decoration, so every bar here is scaled
 * against a stated maximum and prints its own value next to it.
 */
function bar(row: BarRow, max: number): string {
  // A zero reads as zero: a minimum-width sliver would draw a bar where there is
  // nothing, which is the one thing a count must never do.
  const width = max <= 0 || row.value <= 0 ? 0 : Math.max(2, Math.round((row.value / max) * 100));
  const tone = row.tone ?? "tone-neutral";
  return [
    `<div class="bar-row">`,
    `<span class="bar-label mono">${escapeHtml(row.label)}</span>`,
    `<span class="bar-track"><span class="bar-fill ${tone}" style="width:${width}%"></span></span>`,
    `<span class="bar-value mono">${row.value}${row.note === undefined ? "" : `<span class="bar-note">${escapeHtml(row.note)}</span>`}</span>`,
    `</div>`,
  ].join("");
}

/** A label/value pair in the summary strip. */
function metric(label: string, value: string, note: string, tone = ""): string {
  return [
    `<div class="card metric">`,
    `<p class="metric-label">${escapeHtml(label)}</p>`,
    `<p class="metric-value ${tone}">${escapeHtml(value)}</p>`,
    `<p class="metric-note">${escapeHtml(note)}</p>`,
    `</div>`,
  ].join("");
}

/**
 * The run as a chain of stages.
 *
 * It answers the first question a reader has about a report with few findings:
 * was the code not looked at, or was it read and found clean? A stage whose count
 * collapsed is visible before any prose is read.
 */
function stageFlow(report: ReviewReport): string {
  const stats = report.stats;
  // A ratio is stated only where one stage really contains the next: files are
  // reviewed out of the files discovered, and findings are kept out of the
  // candidates produced. Candidates per file is not a ratio, so it states none.
  const stages: Array<{ label: string; value: number; note?: string }> = [
    { label: "Discovered", value: stats.filesDiscovered },
    {
      label: "Reviewed",
      value: stats.filesReviewed,
      note: ` ${share(stats.filesReviewed, stats.filesDiscovered)} of discovered`,
    },
    { label: "Candidates", value: stats.candidatesProduced },
    {
      label: "Cleared the bar",
      value: report.findings.length,
      note: ` ${share(report.findings.length, stats.candidatesProduced)} of candidates`,
    },
  ];

  const nodes = stages
    .map(
      (stage) =>
        `<div class="flow-node"><span class="flow-label">${escapeHtml(stage.label)}</span><span class="flow-value mono">${stage.value}</span></div>`,
    )
    .join(`<div class="flow-arrow">›</div>`);

  const flow = `<div class="flow">${nodes}</div>`;
  const max = Math.max(...stages.map((stage) => stage.value), 0);
  const rows: BarRow[] = stages.map((stage) => ({ ...stage, tone: "tone-step" }));

  const dropped: BarRow[] = [
    { label: "Dropped by the review bar", value: stats.candidatesRejected, tone: "tone-dropped" },
    { label: "Merged as duplicates", value: stats.duplicatesMerged, tone: "tone-dropped" },
    { label: "Kept as findings", value: report.findings.length, tone: "tone-kept" },
  ];
  const droppedMax = Math.max(...dropped.map((row) => row.value), 0);

  return [
    `<section class="card section">`,
    `<h2>How the run went</h2>`,
    `<p class="section-note">Every stage is what the pipeline recorded, not an estimate. A stage that dropped to zero is where the review stopped looking.</p>`,
    flow,
    `<div class="bars">${rows.map((row) => bar(row, max)).join("")}</div>`,
    `<h3>Where the candidates went</h3>`,
    `<div class="bars">${dropped.map((row) => bar(row, droppedMax)).join("")}</div>`,
    `</section>`,
  ].join("");
}

/** The findings, strongest first, each with the evidence that proved it. */
function findingsSection(report: ReviewReport): string {
  const findings = report.findings;
  if (findings.length === 0) {
    return [
      `<section class="card section">`,
      `<h2>Findings</h2>`,
      `<p class="empty">No candidate cleared the review bar in this scope. That is only a clean result when the review state below is <span class="mono">complete</span>: a degraded or partial review found nothing because it did not look everywhere it was asked to.</p>`,
      `</section>`,
    ].join("");
  }

  const counts = countBySeverity(findings);
  const max = Math.max(...REVIEW_SEVERITIES.map((severity) => counts[severity]), 0);
  const severityRows = REVIEW_SEVERITIES.map((severity) => ({
    label: severity,
    value: counts[severity],
    tone: severityClass(severity),
  }));

  const cards = findings.map((finding) => {
    const patch =
      finding.suggestedPatch === null
        ? ""
        : `<details class="detail"><summary>Suggested patch</summary><pre class="code">${escapeHtml(finding.suggestedPatch)}</pre></details>`;
    const test =
      finding.suggestedTest === null
        ? ""
        : `<details class="detail"><summary>Regression test</summary><pre class="code">${escapeHtml(finding.suggestedTest)}</pre></details>`;

    return [
      `<article class="card finding">`,
      `<div class="finding-head">`,
      `<span class="badge ${severityClass(finding.severity)}">${escapeHtml(finding.severity)}</span>`,
      `<span class="badge tone-neutral">${escapeHtml(finding.axis)}</span>`,
      `<span class="badge tone-neutral">confidence ${finding.confidence}</span>`,
      `<span class="badge tone-neutral">${escapeHtml(finding.origin)}</span>`,
      `<span class="finding-anchor mono">${escapeHtml(anchor(finding))}</span>`,
      `</div>`,
      `<h3 class="finding-title">${escapeHtml(finding.title)}</h3>`,
      `<p class="finding-id mono">${escapeHtml(finding.id)}</p>`,
      `<dl class="finding-body">`,
      `<dt>What is wrong</dt><dd>${escapeHtml(finding.problem)}</dd>`,
      `<dt>Why it is a defect</dt><dd>${escapeHtml(finding.why)}</dd>`,
      `<dt>Impact if it ships</dt><dd>${escapeHtml(finding.impact)}</dd>`,
      `<dt>Fix</dt><dd>${escapeHtml(finding.fix)}</dd>`,
      `</dl>`,
      `<div class="evidence"><p class="evidence-label">Evidence, quoted from the file</p><pre class="code">${escapeHtml(finding.evidence)}</pre></div>`,
      patch,
      test,
      `</article>`,
    ].join("");
  });

  return [
    `<section class="card section">`,
    `<h2>Findings</h2>`,
    `<p class="section-note">Every finding carries the quote that proved it: the review bar re-read each one against the file before it was kept.</p>`,
    `<div class="bars">${severityRows.map((row) => bar(row, max)).join("")}</div>`,
    `<div class="findings">${cards.join("")}</div>`,
    `</section>`,
  ].join("");
}

/**
 * The candidates the bar refused.
 *
 * They are shown, and they are shown as refusals: a rejected candidate has no
 * severity, no impact and no fix, and presenting one as a finding would be the
 * exact lie the review bar exists to prevent.
 */
function rejectedSection(report: ReviewReport): string {
  const rejected = report.rejected;
  if (rejected.length === 0 && Object.keys(report.stats.rejectionsByReason).length === 0) {
    return "";
  }

  const tally = report.stats.rejectionsByReason;
  const max = Math.max(...Object.values(tally), 0);
  const groups = ranked(tally).map(([reason, count]) => {
    const rows = rejected.filter((candidate) => candidate.reason === reason);
    const items = rows
      .map(
        (candidate) =>
          `<li><span class="mono">${escapeHtml(candidate.file)}:${candidate.line}${candidate.lineEnd > candidate.line ? `-${candidate.lineEnd}` : ""}</span> — ${escapeHtml(candidate.title)}<br /><span class="muted">${escapeHtml(candidate.detail)}</span></li>`,
      )
      .join("");
    return [
      `<details class="detail">`,
      `<summary>${escapeHtml(reason.replace(/-/g, " "))} <span class="mono">(${count})</span></summary>`,
      rows.length === 0 ? `<p class="muted">The reasoning behind this tally was not recorded per candidate.</p>` : `<ul class="rejections">${items}</ul>`,
      `</details>`,
    ].join("");
  });

  return [
    `<section class="card section">`,
    `<h2>Dropped candidates</h2>`,
    `<p class="section-note">A refusal is not a defect and not a miss. The reason each candidate stopped is what makes the difference visible: an unquoted claim, a quote that was not in the file, a duplicate, or a limit of the run's own cap.</p>`,
    `<div class="bars">${ranked(tally).map(([reason, count]) => bar({ label: reason, value: count, tone: "tone-dropped" }, max)).join("")}</div>`,
    `<div class="groups">${groups.join("")}</div>`,
    `</section>`,
  ].join("");
}

/** What the review could not establish, kept apart from what it found. */
function limitationsSection(report: ReviewReport): string {
  const limitations = report.limitations;
  return [
    `<section class="card section">`,
    `<h2>Review state and limitations</h2>`,
    `<div class="state-row">`,
    `<span class="badge state-${escapeHtml(report.state)}">${escapeHtml(report.state)}</span>`,
    `<span class="badge tone-neutral">verdict ${escapeHtml(report.verdict)}</span>`,
    `<span class="badge tone-neutral">${escapeHtml(report.schema)}</span>`,
    `</div>`,
    `<p class="section-note">${escapeHtml(report.summary)}</p>`,
    limitations.length === 0
      ? `<p class="empty">No limitation was recorded: every file in scope was read and every model answer was readable.</p>`
      : `<ul class="limitations">${limitations
          .map(
            (limitation) =>
              `<li><span class="badge tone-neutral mono">${escapeHtml(limitation.code)}</span> ${escapeHtml(limitation.detail)}${limitation.count === undefined ? "" : ` <span class="mono muted">(${limitation.count})</span>`}</li>`,
          )
          .join("")}</ul>`,
    `</section>`,
  ].join("");
}

/** What the model did, as a coverage bar rather than a sentence. */
function modelSection(report: ReviewReport): string {
  const ai = report.stats.aiReview;
  if (ai === null) {
    return [
      `<section class="card section">`,
      `<h2>The model stage</h2>`,
      `<p class="empty">The model was not part of this run, so this review is the deterministic half only: patterns in the code and the evidence gate. Nothing here was judged by a model.</p>`,
      `</section>`,
    ].join("");
  }

  const segmented: Array<{ label: string; value: number; tone: string }> = [
    { label: "valid", value: ai.valid, tone: "tone-kept" },
    { label: "empty", value: ai.empty, tone: "tone-neutral" },
    { label: "partial", value: ai.partial, tone: "tone-dropped" },
    { label: "invalid", value: ai.invalid, tone: "tone-bad" },
    { label: "unavailable", value: ai.unavailable, tone: "tone-bad" },
    { label: "not sent", value: ai.notSent, tone: "tone-dropped" },
  ];
  const total = segmented.reduce((sum, segment) => sum + segment.value, 0);
  const covered = ai.attempted;

  const strip = segmented
    .filter((segment) => segment.value > 0)
    .map(
      (segment) =>
        `<span class="segment ${segment.tone}" style="width:${total === 0 ? 0 : (segment.value / total) * 100}%" title="${escapeHtml(segment.label)}: ${segment.value}"></span>`,
    )
    .join("");

  const legend = segmented
    .map(
      (segment) =>
        `<span class="legend-item"><span class="swatch ${segment.tone}"></span>${escapeHtml(segment.label)} <span class="mono">${segment.value}</span></span>`,
    )
    .join("");

  return [
    `<section class="card section">`,
    `<h2>The model stage</h2>`,
    `<p class="section-note">Only <span class="mono">valid</span> and <span class="mono">empty</span> are answers about the code. <span class="mono">invalid</span> and <span class="mono">unavailable</span> mean the model's judgement is missing rather than negative, and a file that was never sent was never judged at all.</p>`,
    `<div class="strip">${strip}</div>`,
    `<p class="strip-note">${covered} of ${covered + ai.notSent} reviewed ${covered + ai.notSent === 1 ? "file" : "files"} sent to the model — ${share(covered, covered + ai.notSent)} coverage${ai.entriesDropped === 0 ? "" : `, ${ai.entriesDropped} answer entr${ai.entriesDropped === 1 ? "y" : "ies"} unusable and dropped`}.</p>`,
    `<div class="legend">${legend}</div>`,
    `</section>`,
  ].join("");
}

/**
 * Every reviewed file and how far it got.
 *
 * This is the section that answers "why is this defect not in the report": a file
 * that was never selected, a file the model judged clean, and a file whose answer
 * could not be read look identical in a findings count.
 */
function traceSection(report: ReviewReport): string {
  const trace = report.trace;
  if (trace === undefined) {
    return [
      `<section class="card section">`,
      `<h2>Files reviewed</h2>`,
      `<p class="empty">This run did not collect a per-file trace, so which files reached the model cannot be stated from this report alone.</p>`,
      `</section>`,
    ].join("");
  }

  const rows = trace
    .map((entry) => {
      const outcome =
        entry.sentToModel === false ? `<span class="muted">not sent</span>` : escapeHtml(entry.modelOutcome ?? "-");
      const attempts = entry.response?.attempts ?? [];
      const last = attempts[attempts.length - 1];
      const tokens = last?.usage?.totalTokens ?? null;
      const rejections = ranked(entry.rejections).map(([reason, count]) => `${reason} × ${count}`).join(", ");
      return [
        `<tr>`,
        `<td class="mono">${escapeHtml(entry.file)}</td>`,
        `<td>${entry.selectedForModel ? "yes" : "no"}</td>`,
        `<td>${outcome}</td>`,
        `<td class="mono">${entry.candidates.detector + entry.candidates.ai}</td>`,
        `<td class="mono">${entry.findings}</td>`,
        `<td class="muted">${escapeHtml(rejections)}</td>`,
        `<td class="mono">${tokens === null ? "-" : tokens.toLocaleString("en-US")}</td>`,
        `</tr>`,
      ].join("");
    })
    .join("");

  const sent = trace.filter((entry) => entry.sentToModel).length;
  return [
    `<section class="card section">`,
    `<h2>Files reviewed</h2>`,
    `<p class="section-note">${sent} of ${trace.length} reviewed ${trace.length === 1 ? "file" : "files"} reached the model. A file that was not sent was not judged by the model — its findings, when it has any, are the deterministic checks only — and a file that was sent with no candidates in the answer was answered for and found clean.</p>`,
    `<div class="table-wrap"><table>`,
    `<thead><tr><th>File</th><th>In model budget</th><th>Answer</th><th>Candidates</th><th>Findings</th><th>Dropped</th><th>Tokens</th></tr></thead>`,
    `<tbody>${rows}</tbody>`,
    `</table></div>`,
    `</section>`,
  ].join("");
}

/** What the repository is made of, so a coverage claim can be read in context. */
function repositorySection(index: RepositoryIndex): string {
  const languages = ranked(index.languages).slice(0, 12);
  const max = Math.max(...languages.map(([, count]) => count), 0);

  const manifests =
    index.manifests.length === 0
      ? `<p class="muted">No dependency manifest was found.</p>`
      : `<ul class="plain mono">${index.manifests.slice(0, 20).map((manifest) => `<li>${escapeHtml(manifest)}</li>`).join("")}</ul>`;

  const hotspots =
    index.hotspots.length === 0
      ? `<p class="muted">No file scored as a hotspot.</p>`
      : `<div class="table-wrap"><table><thead><tr><th>File</th><th>Score</th><th>Why</th></tr></thead><tbody>${index.hotspots
          .map(
            (hotspot) =>
              `<tr><td class="mono">${escapeHtml(hotspot.file)}</td><td class="mono">${hotspot.score}</td><td class="muted">${escapeHtml(hotspot.reasons.join(", "))}</td></tr>`,
          )
          .join("")}</tbody></table></div>`;

  return [
    `<section class="card section">`,
    `<h2>What was reviewed</h2>`,
    `<p class="section-note">${index.filesIndexed} ${index.filesIndexed === 1 ? "file" : "files"} indexed, ${index.bytesIndexed.toLocaleString("en-US")} bytes read${index.truncatedFiles === 0 ? "" : `, ${index.truncatedFiles} too large to index in full`}.${index.contentUnavailable ? " No file content was available, so the markers below could not be counted." : ""}</p>`,
    `<div class="bars">${languages.map(([language, count]) => bar({ label: language, value: count, tone: "tone-step" }, max)).join("")}</div>`,
    `<div class="split">`,
    `<div><h3>Markers</h3><ul class="plain"><li>Route files <span class="mono">${index.routeFiles}</span></li><li>Auth files <span class="mono">${index.authFiles}</span></li><li>Source markers <span class="mono">${index.sourceMarkers}</span></li><li>Sink markers <span class="mono">${index.sinkMarkers}</span></li></ul></div>`,
    `<div><h3>Manifests</h3>${manifests}</div>`,
    `</div>`,
    `<h3>Files worth the first attention</h3>`,
    hotspots,
    `</section>`,
  ].join("");
}

/** The stylesheet, inline and complete: the page must render with no network. */
function stylesheet(): string {
  return `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: radial-gradient(1200px 600px at 20% -10%, #141a26 0%, #0b0d12 60%);
  color: #e2e8f0;
  font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
main { max-width: 1080px; margin: 0 auto; padding: 40px 20px 80px; }
h1 { font-size: 30px; margin: 0; letter-spacing: -0.02em; }
h2 { font-size: 20px; margin: 0 0 6px; letter-spacing: -0.01em; }
h3 { font-size: 15px; margin: 22px 0 8px; color: #cbd5e1; }
p { margin: 0 0 10px; }
a { color: #7dd3fc; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 12.5px; }
.muted { color: #94a3b8; }
.empty { color: #94a3b8; margin: 0; }
.eyebrow { text-transform: uppercase; letter-spacing: 0.25em; font-size: 11px; color: #34d399; margin: 0 0 8px; }
.lede { color: #94a3b8; max-width: 70ch; }
.card { background: linear-gradient(180deg, #12151d, #0e1117); border: 1px solid #232936; border-radius: 14px; }
header.card { padding: 26px 26px 22px; margin-bottom: 16px; }
.section { padding: 22px 26px; margin-bottom: 16px; }
.section-note { color: #94a3b8; font-size: 13.5px; max-width: 92ch; }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); margin-bottom: 16px; }
.metric { padding: 16px 18px; }
.metric-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: #64748b; margin: 0 0 6px; }
.metric-value { font-size: 24px; font-weight: 600; margin: 0; }
.metric-note { font-size: 12px; color: #94a3b8; margin: 6px 0 0; }
.ok { color: #34d399; }
.warn { color: #fbbf24; }
.bad { color: #f87171; }
.flow { display: flex; align-items: stretch; gap: 8px; overflow-x: auto; padding: 4px 0 10px; }
.flow-node { flex: 1 1 0; min-width: 120px; background: #0e1117; border: 1px solid #232936; border-radius: 10px; padding: 12px 14px; }
.flow-label { display: block; font-size: 12px; color: #94a3b8; }
.flow-value { display: block; font-size: 20px; font-weight: 600; margin-top: 4px; }
.flow-arrow { align-self: center; color: #334155; font-size: 22px; }
.bars { display: grid; gap: 6px; margin: 10px 0 4px; }
.bar-row { display: grid; grid-template-columns: minmax(120px, 220px) 1fr 150px; gap: 10px; align-items: center; }
.bar-label { color: #cbd5e1; overflow-wrap: anywhere; }
.bar-track { background: #171b24; border: 1px solid #232936; border-radius: 5px; height: 14px; overflow: hidden; }
.bar-fill { display: block; height: 100%; border-radius: 4px 0 0 4px; }
.bar-value { color: #e2e8f0; text-align: right; }
.bar-note { color: #64748b; }
.tone-neutral { background: #334155; }
.tone-step { background: linear-gradient(90deg, #0ea5e9, #22d3ee); }
.tone-kept { background: linear-gradient(90deg, #059669, #34d399); }
.tone-dropped { background: linear-gradient(90deg, #92400e, #f59e0b); }
.tone-bad { background: linear-gradient(90deg, #991b1b, #f87171); }
.sev-critical { background: #7f1d1d; }
.sev-high { background: #9a3412; }
.sev-medium { background: #1e40af; }
.sev-low { background: #334155; }
.badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; color: #e5e7eb; border: 1px solid #00000055; }
.state-complete, .verdict-approve { background: #065f46; }
.state-partial { background: #92400e; }
.state-degraded { background: #7c2d12; }
.state-failed, .verdict-attention { background: #7f1d1d; }
.state-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.findings { display: grid; gap: 14px; margin-top: 14px; }
.finding { padding: 18px 20px; }
.finding-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.finding-anchor { color: #94a3b8; margin-left: auto; }
.finding-title { font-size: 17px; margin: 0 0 2px; }
.finding-id { color: #475569; margin: 0 0 12px; }
.finding-body { margin: 0; }
.finding-body dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: #64748b; margin-top: 12px; }
.finding-body dd { margin: 4px 0 0; color: #dbeafe; }
.evidence { margin-top: 14px; border-top: 1px solid #1f2530; padding-top: 12px; }
.evidence-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: #64748b; }
.code { background: #0a0c11; border: 1px solid #1f2530; border-radius: 8px; padding: 12px 14px; margin: 6px 0 0; overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; color: #cbd5e1; }
.detail { margin-top: 10px; }
.detail > summary { cursor: pointer; color: #94a3b8; font-size: 13px; }
.detail > summary::marker { color: #475569; }
.groups { display: grid; gap: 6px; margin-top: 10px; }
.rejections { margin: 8px 0 0; padding-left: 18px; }
.rejections li { margin-bottom: 8px; }
.limitations { margin: 0; padding-left: 18px; }
.limitations li { margin-bottom: 8px; }
.strip { display: flex; height: 22px; border-radius: 6px; overflow: hidden; border: 1px solid #232936; margin: 12px 0 8px; }
.segment { display: block; height: 100%; }
.strip-note { color: #cbd5e1; font-size: 13px; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; color: #94a3b8; font-size: 12px; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.table-wrap { overflow-x: auto; border: 1px solid #232936; border-radius: 10px; margin-top: 10px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th { text-align: left; font-weight: 500; color: #94a3b8; background: #0f131b; padding: 9px 12px; white-space: nowrap; }
td { padding: 9px 12px; border-top: 1px solid #1b202a; vertical-align: top; }
.split { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-top: 6px; }
.plain { margin: 0; padding-left: 18px; color: #cbd5e1; }
footer { color: #64748b; font-size: 12px; margin-top: 22px; }
@media print {
  body { background: #fff; color: #111; }
  .card { background: #fff; border-color: #d4d4d8; }
  .code { background: #f7f7f8; color: #18181b; border-color: #e4e4e7; }
  .metric-value, .finding-body dd, .strip-note { color: #111; }
  .section-note, .muted, .metric-note, .empty { color: #52525b; }
  .bar-track { border-color: #e4e4e7; background: #f4f4f5; }
  th { color: #3f3f46; background: #fafafa; }
  td { border-color: #e4e4e7; }
}`;
}

/**
 * Renders one report as a complete HTML document.
 *
 * The result is a string with no dependency on a server, a file system, or the
 * clock beyond the timestamp it writes: the caller decides where it goes.
 */
export function renderReviewReportHtml(report: ReviewReport, options: ReviewReportHtmlOptions = {}): string {
  const title = options.title ?? report.scope.pathBase.split(/[\\/]/).filter(Boolean).pop() ?? "Review";
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const source = options.source ?? report.scope.root;
  const counts = countBySeverity(report.findings);
  const severityNote = REVIEW_SEVERITIES.filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(", ");
  const complete = report.state === "complete";
  const decision = report.verdict === "approve" && complete;

  const metrics = [
    metric(
      "Findings",
      String(report.findings.length),
      severityNote === "" ? "none cleared the review bar" : severityNote,
      report.findings.length === 0 ? "ok" : complete ? "warn" : "bad",
    ),
    metric(
      "Coverage",
      share(report.stats.filesReviewed, report.stats.filesDiscovered),
      `${report.stats.filesReviewed} of ${report.stats.filesDiscovered} discovered files read`,
      report.stats.filesReviewed >= report.stats.filesDiscovered ? "ok" : "warn",
    ),
    metric(
      "Model coverage",
      report.stats.aiReview === null ? "not run" : share(report.stats.aiReview.attempted, report.stats.aiReview.attempted + report.stats.aiReview.notSent),
      report.stats.aiReview === null
        ? "the deterministic checks only"
        : `${report.stats.aiReview.valid} readable ${report.stats.aiReview.valid === 1 ? "answer" : "answers"}, ${report.stats.aiReview.invalid + report.stats.aiReview.unavailable} without one`,
      report.stats.aiReview === null ? "warn" : report.stats.aiReview.invalid + report.stats.aiReview.unavailable > 0 ? "warn" : "ok",
    ),
    metric(
      "Dropped candidates",
      String(report.rejected.length),
      report.stats.candidatesProduced === 0 ? "nothing was produced" : `of ${report.stats.candidatesProduced} candidates produced`,
      report.rejected.length === 0 ? "ok" : "warn",
    ),
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'" />
<meta name="referrer" content="no-referrer" />
<title>${escapeHtml(title)} — CodeRadar review report</title>
<style>${stylesheet()}</style>
</head>
<body>
<main>
<header class="card">
<p class="eyebrow">CodeRadar review report</p>
<h1>${escapeHtml(title)}</h1>
<p class="lede">${escapeHtml(report.summary)}</p>
<div class="state-row">
<span class="badge ${decision ? "verdict-approve" : "verdict-attention"}">${escapeHtml(report.verdict)}</span>
<span class="badge state-${escapeHtml(report.state)}">review ${escapeHtml(report.state)}</span>
<span class="badge tone-neutral mono">${escapeHtml(report.schema)}</span>
</div>
<p class="muted mono">scope ${escapeHtml(source)} · ${escapeHtml(report.scope.kind)}${report.scope.branch === null ? "" : ` · ${escapeHtml(report.scope.branch)}${report.scope.diffAware && report.scope.baseBranch !== null ? ` vs ${escapeHtml(report.scope.baseBranch)}` : ""}`}${report.scope.diffAware ? " · changed lines only" : ""} · rendered ${escapeHtml(generatedAt)}</p>
</header>
<div class="grid">${metrics.join("")}</div>
${stageFlow(report)}
${findingsSection(report)}
${rejectedSection(report)}
${modelSection(report)}
${limitationsSection(report)}
${traceSection(report)}
${repositorySection(report.repositoryIndex)}
<footer>
<p>Every count on this page comes from the report the engine produced for this run; nothing is recomputed for display. A finding is only listed when a quoted line from the reviewed file proved it, and a dropped candidate is listed as a refusal, never as a defect.</p>
</footer>
</main>
</body>
</html>
`;
}
