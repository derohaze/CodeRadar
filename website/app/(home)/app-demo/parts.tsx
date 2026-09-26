import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { DemoSeverity } from './data';
import { card, faint, label, mono, muted, severityTone, tile } from './tokens';

export function SeverityBadge({ severity }: { severity: DemoSeverity }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-lg border px-2 py-0.5 text-[11px] font-medium capitalize',
        severityTone[severity],
      )}
    >
      {severity}
    </span>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn(label, className)}>{children}</p>;
}

/** The app's `InfoSummaryCard`: a label, a value, and a line of context. */
export function InfoCard({
  label: cardLabel,
  value,
  note,
  className,
}: {
  label: string;
  value: string;
  note: string;
  className?: string;
}) {
  return (
    <div className={cn(card, 'min-w-0 px-3.5 py-3', className)}>
      <p className={cn(label, 'truncate')}>{cardLabel}</p>
      <p className="mt-1.5 truncate text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]" title={value}>
        {value}
      </p>
      <p className={cn('mt-1 line-clamp-2 text-[11px] leading-5', muted)} title={note}>
        {note}
      </p>
    </div>
  );
}

export function ScoreChip({
  label: chipLabel,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: DemoSeverity;
}) {
  const valueTone =
    tone === 'critical'
      ? 'text-[hsl(var(--cr-critical))]'
      : tone === 'high'
        ? 'text-[hsl(var(--cr-high))]'
        : tone === 'medium'
          ? 'text-[hsl(var(--cr-text-secondary))]'
          : 'text-[hsl(var(--cr-text-tertiary))]';

  return (
    <div className={cn(tile, 'min-w-0 px-3 py-3')}>
      <p className={cn(label, 'truncate')}>{chipLabel}</p>
      <div className="mt-2 flex min-h-[36px] items-center justify-center">
        <span className={cn('font-mono text-[24px] font-semibold leading-none tracking-[-0.05em] tabular-nums', valueTone)}>
          {value}
        </span>
      </div>
    </div>
  );
}

/** A code excerpt with the app's own dark surface, in either site theme. */
export function CodeBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      className={cn(
        'mt-2 max-h-[150px] overflow-auto rounded-lg bg-[#0f0f0f] p-3 text-[10.5px] leading-5 text-white/80',
        className,
      )}
    >
      {children}
    </pre>
  );
}

export function KeyValueRow({ name, value }: { name: string; value: string }) {
  return (
    <div className={cn(tile, 'flex items-center justify-between gap-3 px-3 py-2.5')}>
      <span className={cn('text-[12px]', muted)}>{name}</span>
      <span className="truncate text-right text-[12px] font-medium text-[hsl(var(--cr-text-primary))]">
        {value}
      </span>
    </div>
  );
}

export function MonoPath({ path, className }: { path: string; className?: string }) {
  return (
    <span className={cn(mono, faint, 'truncate', className)} title={path}>
      {path}
    </span>
  );
}
