'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DEMO_ANALYSIS_BRIEFS, type DemoFinding, type DemoRejectedCandidate, type DemoSession } from '../data';
import { CodeBlock, InfoCard, ScoreChip, SectionLabel, SeverityBadge } from '../parts';
import { card, faint, label, mono, muted, tile } from '../tokens';

function CopyButton({ value, label: buttonLabel }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          },
          () => setCopied(false),
        );
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--cr-border))] bg-[hsl(var(--cr-card))] px-2.5 py-1 text-[11.5px] font-medium text-[hsl(var(--cr-text-primary))] transition-colors hover:bg-[hsl(var(--cr-tile))]"
    >
      {copied ? <CheckCircle2 className="size-3" /> : <Copy className="size-3" />}
      {copied ? 'Copied' : buttonLabel}
    </button>
  );
}

function range(finding: DemoFinding) {
  return finding.lineEnd > finding.line ? `${finding.line}-${finding.lineEnd}` : `${finding.line}`;
}

function buildAgentFixPrompt(session: DemoSession, findings: DemoFinding[]) {
  if (findings.length === 0) {
    return `Code review: 5/5 — no fix needed, clean\n\nNo confirmed finding was retained for ${session.path}.`;
  }
  const hasCritical = findings.some((finding) => finding.severity === 'critical');
  const score = hasCritical ? '1/5' : findings.some((finding) => finding.severity === 'high') ? '2/5' : '3/5';
  const sections = findings
    .slice(0, 8)
    .map((finding, index) =>
      [
        `### ${index + 1}. ${finding.title}`,
        `Location: ${finding.file}:${range(finding)}`,
        `Severity: ${finding.severity} (confidence ${finding.confidence}%)`,
        `What is wrong: ${finding.summary}`,
        `Why it matters: ${finding.impact}`,
        `Evidence: ${finding.evidence}`,
        `Recommended fix: ${finding.fix}`,
      ].join('\n'),
    )
    .join('\n\n');

  return [
    `Code review: ${score} — fix the ${findings.length} finding(s) below`,
    '',
    sections,
    '',
    'Fix prompt for Codex / Claude / Cursor:',
    '- Read each file at the reported location and apply the recommended fix',
    '- Keep the change minimal and behavior-preserving; do not refactor unrelated code',
    '- Preserve existing tests and add coverage for every patched path',
    '- If a fix changes a public signature or return shape, update its callers',
    '- Run the project typecheck and tests, then report the diff for each finding',
  ].join('\n');
}

function RejectedRow({ candidate }: { candidate: DemoRejectedCandidate }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="px-4 py-2.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <ChevronDown className={cn('size-3 shrink-0 transition-transform', !expanded && '-rotate-90')} />
            <span className="truncate text-[12px] font-medium text-[hsl(var(--cr-text-primary))]">{candidate.title}</span>
          </span>
          <span className={cn(mono, faint, 'mt-1 block truncate pl-[18px]')}>
            {candidate.file}:{candidate.line}
          </span>
        </span>
        <span className="shrink-0 rounded-md bg-[hsl(var(--cr-muted))] px-2 py-0.5 text-[10.5px] text-[hsl(var(--cr-text-secondary))]">
          {candidate.reasonLabel}
        </span>
      </button>
      {expanded && (
        <div className={cn(tile, 'mt-2.5 space-y-2.5 px-3 py-2.5')}>
          <div>
            <SectionLabel>Why it was dropped</SectionLabel>
            <p className="mt-1 text-[11.5px] leading-5 text-[hsl(var(--cr-text-primary))]">{candidate.explanation}</p>
            <p className={cn(mono, 'mt-1 text-[hsl(var(--cr-text-secondary))]')}>{candidate.detail}</p>
          </div>
          {candidate.quotes.length > 0 && (
            <div>
              <SectionLabel>Quotes checked</SectionLabel>
              <ul className="mt-1 space-y-1">
                {candidate.quotes.map((quote, index) => (
                  <li key={quote} className="text-[11px] leading-5">
                    <span className={cn(mono, 'break-words text-[hsl(var(--cr-text-primary))]')}>{quote}</span>
                    <span className={cn('mt-0.5 block', muted)}>
                      {candidate.quotesFound[index] ? 'found in the reviewed file' : 'not found in the reviewed file'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ResultsScreen({
  session,
  onSelectFinding,
  onOpenRepo,
}: {
  session: DemoSession;
  onSelectFinding: (finding: DemoFinding) => void;
  onOpenRepo: () => void;
}) {
  const approvalQueue = session.findings.filter((finding) => finding.needsApproval);
  const surfaced = session.findings.filter((finding) => !finding.needsApproval);
  const clean = session.findings.length === 0 && session.score === 100;
  const brief = DEMO_ANALYSIS_BRIEFS[session.id];
  const hasScore = typeof session.score === 'number';
  const prompt = buildAgentFixPrompt(session, surfaced);

  return (
    <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <div className="mx-auto max-w-[720px] space-y-3">
        {/* Header */}
        <div className={cn(card, 'flex items-center justify-between gap-3 px-4 py-3')}>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-[hsl(var(--cr-text-primary))]">{session.name}</p>
            <p className={cn(label, 'mt-1')}>
              Deep review | {session.time}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <CheckCircle2 className={cn('size-3.5', clean ? 'text-[hsl(var(--cr-success))]' : 'text-[hsl(var(--cr-text-secondary))]')} />
            <span className="text-[12px] font-medium text-[hsl(var(--cr-text-primary))]">
              {clean ? 'Reviewed' : 'Completed'}
            </span>
          </div>
        </div>

        {/* Verdict */}
        <div
          className={cn(
            card,
            'px-4 py-3.5',
            clean && 'border-[hsl(var(--cr-success)/0.3)] bg-[hsl(var(--cr-success-bg))]',
          )}
        >
          <p
            className={cn(
              'text-[12.5px] font-medium',
              clean ? 'text-[hsl(var(--cr-success))]' : 'text-[hsl(var(--cr-text-primary))]',
            )}
          >
            {clean
              ? 'No validated issue was confirmed in the selected scope'
              : 'Validated repository assessment'}
          </p>
          <p className={cn('mt-2 text-[12px] leading-5', muted)}>{session.summary}</p>
        </div>

        {/* Score */}
        <div className={cn(card, 'px-4 py-4')}>
          <div className="grid gap-3 xl:grid-cols-[220px_1fr]">
            <div className={cn(tile, 'px-3.5 py-3.5')}>
              <SectionLabel>Security score — Greptile 5-point</SectionLabel>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-[30px] font-semibold leading-none tracking-[-0.05em] text-[hsl(var(--cr-text-primary))]">
                  {hasScore ? session.score : '—'}
                </span>
                <span className={cn('pb-0.5 text-[11px]', faint)}>{hasScore ? '/100' : 'unavailable'}</span>
                {hasScore && (
                  <span className="ml-1.5 rounded-full bg-[hsl(var(--cr-primary))] px-1.5 py-0.5 text-[10.5px] font-medium text-[hsl(var(--cr-primary-foreground))]">
                    {Math.ceil((session.score ?? 0) / 20)}/5
                  </span>
                )}
              </div>
              {clean && (
                <p className="mt-2 text-[11px] leading-5 text-[hsl(var(--cr-success))]">
                  5/5 — clean, no action needed. No risky paths, no prompt required
                </p>
              )}
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--cr-tile))]">
                <div
                  className="h-full rounded-full bg-[hsl(var(--cr-primary))]"
                  style={{ width: `${hasScore ? session.score : 0}%` }}
                />
              </div>
            </div>

            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">AI score explanation</p>
              <div className={cn('mt-2 space-y-1.5 text-[11.5px] leading-5', muted)}>
                {session.scoreExplanation.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <ScoreChip label="Confirmed issues" value={surfaced.length} tone="high" />
                <ScoreChip label="Review queue" value={approvalQueue.length} tone="medium" />
                <ScoreChip label="Dropped candidates" value={session.rejected.length} tone="low" />
              </div>
            </div>
          </div>
        </div>

        {/* Coverage */}
        <div className={cn(card, 'px-4 py-3.5')}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">Review coverage</p>
            <span className={cn(label, 'shrink-0')}>{session.coveragePercent}% covered</span>
          </div>
          <p className={cn('mt-2 text-[12px] leading-5', muted)}>
            {session.coveragePercent === 100
              ? `${session.filesReviewed} of ${session.filesEligible} discovered files were read and reviewed.`
              : `${session.filesReviewed} of ${session.filesEligible} discovered files were read; ${session.filesEligible - session.filesReviewed} were outside the context window.`}
          </p>
          <div className={cn('mt-3 grid gap-1.5 text-[11.5px] sm:grid-cols-2', muted)}>
            <span>
              Files reviewed: {session.filesReviewed}/{session.filesEligible}
            </span>
            <span>
              Blocks reviewed: {session.blocksReviewed}/{session.blocksTotal}
            </span>
            <span>
              Paths traced: {session.pathsTraced}/{session.pathsTotal}
            </span>
            <span>Elapsed: {session.time}</span>
          </div>
          {session.coveragePercent < 100 && (
            <div className={cn(tile, 'mt-3 px-3 py-2.5')}>
              <SectionLabel>Excluded files</SectionLabel>
              <div className={cn('mt-1.5 space-y-1 text-[11.5px]', muted)}>
                <p>
                  <span className={mono}>src/pages/dashboard/widgets.tsx</span> - over the per-file context budget
                </p>
                <p>
                  <span className={mono}>src/generated/api-schema.ts</span> - generated, excluded by policy
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Technical signals */}
        <div className="grid gap-2 sm:grid-cols-3">
          <InfoCard label="Framework profile" value="unknown" note={session.path.includes('buggy') ? 'Classified from languages: typescript, python' : 'No explicit framework markers were recorded'} />
          <InfoCard label="Repository graph" value="11 import edges" note="0 route files and 1 auth file" />
          <InfoCard label="Path tracing" value="14 candidate paths" note="4 cross-file paths identified" />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <InfoCard label="Review mode" value="Deep review" note="Path-centric review" />
          <InfoCard label="Review queue" value="14 review items" note="6 ranked paths" />
          <InfoCard
            label="Score rationale"
            value={`${surfaced.length} open`}
            note={`Queue ${approvalQueue.length} item(s) - coverage ${session.coveragePercent} percent - candidate pressure ${session.rejected.length}`}
          />
        </div>

        {/* Analysis brief */}
        {brief && (
          <div className="grid gap-2 md:grid-cols-2">
            <BriefCard
              label="Potential risks"
              intro="Unconfirmed concerns derived from reviewed evidence, missing verification, or suspicious patterns"
              items={brief.potentialRisks}
            />
            <BriefCard
              label="Security observations"
              intro="Defensive patterns that appear to be present in the reviewed scope"
              items={brief.securityObservations}
            />
            <BriefCard
              label="What CodeRadar could not verify"
              intro="Real review limits from this run, not proof that the code is unsafe"
              items={brief.analysisLimitations}
            />
            <BriefCard
              label="If I were attacking this"
              intro="Attack probes CodeRadar would prioritize next against the reviewed surfaces"
              items={brief.attackThinking}
            />
            <BriefCard
              label="Recommended next steps"
              intro="Concrete follow-up actions generated from the current run"
              items={brief.nextSteps}
            />
          </div>
        )}

        {/* Validated findings */}
        <div className={cn(card, 'overflow-hidden')}>
          <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-4">
            <div>
              <p className="text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">Validated findings</p>
              {approvalQueue.length > 0 && <p className={cn(label, 'mt-1')}>Open findings only</p>}
            </div>
            <button
              type="button"
              onClick={onOpenRepo}
              className="shrink-0 rounded-lg border border-[hsl(var(--cr-border))] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--cr-text-secondary))] transition-colors hover:bg-[hsl(var(--cr-tile))]"
            >
              Repo overview
            </button>
          </div>
          <div className="divide-y divide-[hsl(var(--cr-border-soft))]">
            {surfaced.map((finding) => (
              <button
                key={finding.id}
                type="button"
                onClick={() => onSelectFinding(finding)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[hsl(var(--cr-muted))]"
              >
                <div className="mt-0.5">
                  <SeverityBadge severity={finding.severity} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-medium text-[hsl(var(--cr-text-primary))]">{finding.title}</p>
                  <p className={cn(mono, faint, 'mt-1 truncate')}>
                    {finding.file}:{range(finding)} - {finding.category}
                  </p>
                </div>
              </button>
            ))}
            {surfaced.length === 0 && (
              <div className={cn('px-4 py-5 text-[12px] leading-5', muted)}>
                {clean
                  ? `The review finished with a score of ${session.score}/100 — no high-confidence, confirmed issue was found in the reviewed scope`
                  : 'Every validated finding in this session is already tracked in the approval queue below'}
              </div>
            )}
          </div>
        </div>

        {/* Approval queue */}
        {approvalQueue.length > 0 && (
          <div className={cn(card, 'px-4 py-4')}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">Approval queue</p>
                <p className={cn(label, 'mt-1')}>Review-required items</p>
              </div>
              <span className={cn(label, 'shrink-0')}>{approvalQueue.length} queued</span>
            </div>
            <div className="mt-3 space-y-2">
              {approvalQueue.map((finding) => (
                <button
                  key={finding.id}
                  type="button"
                  onClick={() => onSelectFinding(finding)}
                  className={cn(tile, 'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[hsl(var(--cr-card))]')}
                >
                  <div className="mt-0.5">
                    <SeverityBadge severity={finding.severity} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-[12px] font-medium text-[hsl(var(--cr-text-primary))]">{finding.title}</p>
                      <span className={cn(label, 'shrink-0')}>Review required</span>
                    </div>
                    <p className={cn(mono, faint, 'mt-1 truncate')}>{finding.file}</p>
                    <p className={cn('mt-1.5 text-[11.5px] leading-5', muted)}>
                      A critical finding needs a human decision before a patch is generated.
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Rejected candidates */}
        {session.rejected.length > 0 && (
          <div className={cn(card, 'overflow-hidden')}>
            <div className="px-4 pb-2.5 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">Rejected candidates</p>
                  <p className={cn(label, 'mt-1')}>Dropped by the review bar</p>
                </div>
                <span className={cn(label, 'shrink-0')}>{session.rejected.length} dropped</span>
              </div>
              <p className={cn('mt-2 text-[11.5px] leading-5', muted)}>
                None of these is a reported defect. Each row says why it was not, so a refused claim is not mistaken
                for a defect the review never saw.
              </p>
            </div>
            <div className="divide-y divide-[hsl(var(--cr-border-soft))]">
              {session.rejected.map((candidate) => (
                <RejectedRow key={candidate.id} candidate={candidate} />
              ))}
            </div>
          </div>
        )}

        {/* Agent fix prompt */}
        <div className={cn(card, 'px-4 py-3.5')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">
                Agent fix prompt — copy to Codex / Claude / Cursor
              </p>
              <p className={cn('mt-1 text-[10.5px]', faint)}>
                Greptile-style: 1-4/5 shows file:line + prompt, 5/5 shows no fix needed
              </p>
            </div>
            <CopyButton value={prompt} label="Copy prompt" />
          </div>
          <CodeBlock>{prompt}</CodeBlock>
        </div>
      </div>
    </div>
  );
}

function BriefCard({ label: cardLabel, intro, items }: { label: string; intro: string; items: string[] }) {
  return (
    <div className={cn(card, 'px-3.5 py-3.5')}>
      <SectionLabel>{cardLabel}</SectionLabel>
      <p className={cn('mt-2 text-[11.5px] leading-5', muted)}>{intro}</p>
      <div className="mt-2.5 space-y-1.5">
        {items.map((item, index) => (
          <p key={item} className="text-[11.5px] leading-5 text-[hsl(var(--cr-text-primary))]">
            {index + 1}. {item}
          </p>
        ))}
      </div>
    </div>
  );
}
