import type { DemoSeverity } from './data';

/**
 * Class helpers for the app demo.
 *
 * Everything reads from the `--cr-*` custom properties defined in
 * `app/global.css`, which are the desktop app's own tokens. Nothing here
 * hard-codes a light or dark value, so the demo follows the site's theme
 * toggle the same way the app follows its own.
 */

export const appRoot =
  'coderadar-app bg-[hsl(var(--cr-workspace))] text-[hsl(var(--cr-text-primary))]';

export const card = 'rounded-xl border border-[hsl(var(--cr-border-soft))] bg-[hsl(var(--cr-card))]';

export const tile = 'rounded-lg border border-[hsl(var(--cr-border-soft))] bg-[hsl(var(--cr-tile))]';

export const field =
  'h-8 rounded-lg border border-[hsl(var(--cr-border))] bg-[hsl(var(--cr-tile))] px-3 text-[12.5px] text-[hsl(var(--cr-text-primary))]';

export const label =
  'text-[10px] font-medium uppercase tracking-[0.16em] text-[hsl(var(--cr-text-tertiary))]';

export const heading = 'font-semibold tracking-[-0.02em] text-[hsl(var(--cr-text-primary))]';

export const muted = 'text-[hsl(var(--cr-text-secondary))]';
export const faint = 'text-[hsl(var(--cr-text-tertiary))]';
export const mono = 'font-mono text-[11px]';

export const severityTone: Record<DemoSeverity, string> = {
  critical:
    'border-[hsl(var(--cr-critical)/0.25)] bg-[hsl(var(--cr-critical-bg))] text-[hsl(var(--cr-critical))]',
  high: 'border-[hsl(var(--cr-high)/0.25)] bg-[hsl(var(--cr-high-bg))] text-[hsl(var(--cr-high))]',
  medium:
    'border-[hsl(var(--cr-border))] bg-[hsl(var(--cr-tile))] text-[hsl(var(--cr-text-secondary))]',
  low: 'border-[hsl(var(--cr-border-soft))] bg-[hsl(var(--cr-tile))] text-[hsl(var(--cr-text-tertiary))]',
};

export const severityValueTone: Record<DemoSeverity, string> = {
  critical: 'text-[hsl(var(--cr-critical))]',
  high: 'text-[hsl(var(--cr-high))]',
  medium: 'text-[hsl(var(--cr-text-secondary))]',
  low: 'text-[hsl(var(--cr-text-tertiary))]',
};

/** The staggered fade the app's own screens use for their sections. */
export const reveal = 'animate-fd-fade-in';
