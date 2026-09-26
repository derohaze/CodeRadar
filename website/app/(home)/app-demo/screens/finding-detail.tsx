'use client';

import { useState } from 'react';
import { ArrowLeft, CircleAlert, Gauge, ShieldCheck, ShieldX, Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DemoFinding } from '../data';
import { CodeBlock, SectionLabel, SeverityBadge } from '../parts';
import { card, faint, label, mono, muted, severityTone, tile } from '../tokens';

function range(finding: DemoFinding) {
  return finding.lineEnd > finding.line ? `${finding.line}-${finding.lineEnd}` : `${finding.line}`;
}

function buildFixPrompt(finding: DemoFinding) {
  return [
    'Fix this code-review finding:',
    '',
    `Location: ${finding.file}:${finding.line}`,
    `Severity: ${finding.severity} (confidence ${finding.confidence}%)`,
    `Finding: ${finding.title}`,
    `What is wrong: ${finding.summary}`,
    `Why it matters: ${finding.impact}`,
    `Evidence: ${finding.evidence}`,
    `Recommended fix: ${finding.fix}`,
    '',
    'Instructions for the agent:',
    '- Apply a minimal fix that resolves the defect without changing intended behavior',
    '- Preserve existing tests and add coverage for the patched path',
    '- Keep the change scoped to this finding; do not refactor unrelated code',
    '- If the fix changes public signatures or return shapes, update callers',
  ].join('\n');
}

function StoryMiniCard({
  icon: Icon,
  title,
  value,
  tone = 'default',
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <div
      className={cn(
        tile,
        'rounded-2xl px-3.5 py-3',
        tone === 'danger' && 'border-[hsl(var(--cr-critical)/0.3)] bg-[hsl(var(--cr-critical-bg))]',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('size-3.5', tone === 'danger' ? 'text-[hsl(var(--cr-critical))]' : faint)} />
        <SectionLabel>{title}</SectionLabel>
      </div>
      <p className="mt-2 text-[11.5px] leading-5 text-[hsl(var(--cr-text-primary))] [overflow-wrap:anywhere]">
        {value}
      </p>
    </div>
  );
}

function StoryStep({
  step,
  title,
  text,
  tone = 'default',
}: {
  step: string;
  title: string;
  text: string;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-2xl border border-[hsl(var(--cr-border-soft))] px-3.5 py-3.5',
        tone === 'danger'
          ? 'bg-[hsl(var(--cr-critical-bg))]'
          : tone === 'warning'
            ? 'bg-[hsl(var(--cr-high-bg))]'
            : 'bg-[hsl(var(--cr-card))]',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn(tile, 'flex size-5 items-center justify-center rounded-full text-[10px] font-semibold')}>
          {step}
        </span>
        <p className="text-[12px] font-medium text-[hsl(var(--cr-text-primary))]">{title}</p>
      </div>
      <p className={cn('mt-2.5 min-w-0 break-words text-[11.5px] leading-5', muted)}>{text}</p>
    </div>
  );
}

function InfoTile({ name, value, mono: isMono = false }: { name: string; value: string; mono?: boolean }) {
  return (
    <div className={cn(tile, 'min-w-0 rounded-2xl px-3.5 py-2.5')}>
      <SectionLabel>{name}</SectionLabel>
      <p
        className={cn(
          'mt-1.5 min-w-0 break-words text-[11.5px] leading-5 text-[hsl(var(--cr-text-primary))] [overflow-wrap:anywhere]',
          isMono && mono,
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function FindingDetailScreen({
  finding,
  onBack,
}: {
  finding: DemoFinding;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<'summary' | 'decision'>('summary');
  const [preparing, setPreparing] = useState(false);
  const prompt = buildFixPrompt(finding);

  const riskScore = Math.min(
    99,
    Math.round(finding.confidence * (finding.severity === 'critical' ? 1.12 : finding.severity === 'high' ? 1.02 : 0.82)),
  );
  const riskLabel =
    riskScore >= 85
      ? 'High residual risk — patch before the next release'
      : 'Moderate residual risk — schedule the fix';

  return (
    <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <div className="mx-auto max-w-[620px]">
        <button
          type="button"
          onClick={onBack}
          className={cn('mb-4 inline-flex items-center gap-1.5 text-[11.5px]', muted, 'hover:text-[hsl(var(--cr-text-primary))]')}
        >
          <ArrowLeft className="size-3.5" />
          Back to results
        </button>

        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold leading-snug text-[hsl(var(--cr-text-primary))]">
              {finding.title}
            </h2>
            <p className={cn(mono, faint, 'mt-2')}>
              {finding.file}:{range(finding)}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className={cn(label, 'rounded-full bg-[hsl(var(--cr-muted))] px-2.5 py-1')}>
                {finding.needsApproval ? 'Open · review required' : 'Open'}
              </span>
              <span
                className={cn(
                  'inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em]',
                  severityTone[finding.severity],
                )}
              >
                {finding.severity} risk
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setPreparing(true);
              window.setTimeout(() => setPreparing(false), 900);
            }}
            className="shrink-0 rounded-lg border border-[hsl(var(--cr-border))] bg-[hsl(var(--cr-card))] px-3.5 py-2 text-[12px] font-medium text-[hsl(var(--cr-text-primary))] transition-colors hover:bg-[hsl(var(--cr-tile))]"
          >
            {preparing ? 'Preparing fix…' : 'Create fix'}
          </button>
        </div>

        {/* Confidence */}
        <div className={cn(card, 'mb-5 rounded-[18px] px-4 py-3.5')}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Gauge className={cn('size-4', faint)} />
              <p className="text-[12.5px] font-medium text-[hsl(var(--cr-text-primary))]">AI confidence</p>
            </div>
            <span className="text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">
              {finding.confidence}%
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--cr-tile))]">
            <div
              className="h-full rounded-full bg-[hsl(var(--cr-primary))] transition-[width] duration-300"
              style={{ width: `${finding.confidence}%` }}
            />
          </div>
          <p className={cn('mt-3 text-[11px] leading-5', faint)}>
            {finding.confidence >= 90
              ? 'High confidence — the trigger and the wrong result are both grounded in the supplied code'
              : finding.confidence >= 70
                ? 'Moderate confidence — the mechanism is quoted but the runtime state could not be fully verified'
                : 'Reviewer confidence — verify against the actual runtime state before applying the fix'}
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-5 inline-flex rounded-2xl bg-[hsl(var(--cr-tile))] p-1">
          {(
            [
              { id: 'summary', labelText: 'Summary' },
              { id: 'decision', labelText: 'Decision' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                'rounded-xl px-4 py-1.5 text-[12px] transition-colors',
                tab === item.id
                  ? 'bg-[hsl(var(--cr-primary))] font-medium text-[hsl(var(--cr-primary-foreground))]'
                  : 'text-[hsl(var(--cr-text-secondary))] hover:text-[hsl(var(--cr-text-primary))]',
              )}
            >
              {item.labelText}
            </button>
          ))}
        </div>

        {tab === 'summary' ? (
          <div className="space-y-3">
            <div className={cn(card, 'rounded-[18px] px-3.5 py-3.5')}>
              <div className="grid gap-3.5 md:grid-cols-[1.15fr_0.85fr]">
                <div>
                  <SectionLabel>What is wrong</SectionLabel>
                  <p className={cn('mt-2 text-[12px] leading-5', muted)}>{finding.summary}</p>
                </div>
                <div className="grid gap-2">
                  <StoryMiniCard icon={CircleAlert} title="Why it matters" value={finding.impact} tone="danger" />
                  <StoryMiniCard icon={ShieldX} title="Root cause" value={finding.explanation} />
                </div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <InfoTile name="Severity" value={finding.severity} />
                <InfoTile name="Category" value={finding.category} />
                <InfoTile name="Location" value={`${finding.file}:${range(finding)}`} mono />
                <InfoTile name="Evidence" value={finding.evidence} mono />
              </div>
            </div>

            <div className={cn(card, 'rounded-[18px] px-3.5 py-3.5')}>
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <p className="text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">Attack path</p>
                <span className={cn('text-[10.5px]', faint)}>Entry point to impact</span>
              </div>
              <div className="grid gap-2.5 md:grid-cols-3">
                <StoryStep step="1" title="Entry point" text={finding.attack.input} />
                <StoryStep step="2" title="Unsafe execution" text={finding.attack.execution} tone="warning" />
                <StoryStep step="3" title="Impact" text={finding.attack.result} tone="danger" />
              </div>
            </div>

            <div className={cn(card, 'rounded-[18px] px-3.5 py-3.5')}>
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">Recommended fix</p>
                  <p className={cn('mt-1 text-[10.5px]', faint)}>Copy to Codex / Claude / Cursor</p>
                </div>
                <CopyButtonInline value={prompt} />
              </div>
              <p className={cn('text-[12px] leading-5', muted)}>{finding.fix}</p>
              <CodeBlock>{prompt}</CodeBlock>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className={cn(card, 'rounded-[18px] px-3.5 py-3.5')}>
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <p className="text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">Decision center</p>
                <span className={cn('text-[10.5px]', faint)}>Recommended path forward</span>
              </div>
              <div className="grid gap-2.5 md:grid-cols-2">
                <StoryMiniCard
                  icon={ShieldCheck}
                  title="Evidence verified"
                  value="The quoted code was found in the file it names, at the reported lines."
                />
                <StoryMiniCard
                  icon={Gauge}
                  title={`Risk score ${riskScore}/100`}
                  value={riskLabel}
                  tone={riskScore >= 85 ? 'danger' : 'default'}
                />
                <StoryMiniCard
                  icon={Zap}
                  title="Recommended action"
                  value={finding.needsApproval ? 'Collect approval, then generate the patch' : 'Generate the patch and apply it locally'}
                />
                <StoryMiniCard
                  icon={ShieldX}
                  title="Approval path"
                  value={
                    finding.needsApproval
                      ? 'Critical severity — a reviewer must approve before any patch is written'
                      : 'Auto-eligible under the current preset'
                  }
                  tone={finding.needsApproval ? 'danger' : 'default'}
                />
              </div>
            </div>

            <div className={cn(card, 'rounded-[18px] px-3.5 py-3.5')}>
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <p className="text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">
                  Why CodeRadar recommends a fix
                </p>
                <span className={cn('text-[10.5px]', faint)}>Evidence-specific guidance</span>
              </div>
              <div className="space-y-2">
                <ExplainRow label="Fix strategy" value={finding.fix} />
                <ExplainRow label="Factor 1" value={`Severity is ${finding.severity}, so the fix is not optional before release.`} />
                <ExplainRow
                  label="Factor 2"
                  value={`Confidence is ${finding.confidence}%, so the mechanism is quoted rather than assumed.`}
                />
                <ExplainRow
                  label="Factor 3"
                  value="The evidence is inside the reviewed scope, so no follow-up read is required before patching."
                  tone="danger"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CopyButtonInline({ value }: { value: string }) {
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
      className="rounded-lg border border-[hsl(var(--cr-border))] bg-[hsl(var(--cr-card))] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--cr-text-primary))] transition-colors hover:bg-[hsl(var(--cr-tile))]"
    >
      {copied ? 'Copied' : 'Copy fix prompt'}
    </button>
  );
}

function ExplainRow({ label: rowLabel, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' }) {
  return (
    <div className={cn(tile, 'grid min-w-0 gap-2 rounded-2xl px-3.5 py-2.5 md:grid-cols-[92px_minmax(0,1fr)]')}>
      <SectionLabel>{rowLabel}</SectionLabel>
      <p
        className={cn(
          'min-w-0 break-words text-[11.5px] leading-5 [overflow-wrap:anywhere]',
          tone === 'danger' ? 'text-[hsl(var(--cr-critical))]' : muted,
        )}
      >
        {value}
      </p>
    </div>
  );
}
