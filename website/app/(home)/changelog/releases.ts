export type ReleaseTag = 'New' | 'Improved' | 'Fixed';

export interface ReleaseEntry {
  tag: ReleaseTag;
  text: string;
}

export interface ReleaseHighlight {
  title: string;
  description: string;
}

export interface Release {
  version: string;
  date: string;
  title: string;
  summary: string;
  /** Headline features, rendered as their own subsections. */
  highlights: ReleaseHighlight[];
  /** Smaller tagged changes, rendered as a compact list. */
  entries: ReleaseEntry[];
}

/** Newest first — the page renders this list top-down as a timeline. */
export const releases: Release[] = [
  {
    version: '1.4',
    date: 'June 28, 2026',
    title: 'Ground-truth scoring & benchmark harness',
    summary:
      'Review accuracy becomes measurable: planted-defect fixtures, per-model benchmark rows, and offline replay of real model answers.',
    highlights: [
      {
        title: 'Anchor-scored accuracy fixture',
        description:
          'Nine planted defects and ten look-wrong-but-correct controls. A finding scores only when it names the right file and its range overlaps the defect anchor — file-right-line-wrong is a miss.',
      },
      {
        title: 'Record once, replay offline',
        description:
          'Model answers are recorded locally and replayed with no provider and no key, so parser, validator, and scorer changes are checked against real answers deterministically.',
      },
    ],
    entries: [
      { tag: 'Improved', text: 'Per-defect diagnosis follows the whole chain: sent, parsed, evidenced, validated, deduped.' },
      { tag: 'Improved', text: 'Benchmark prints MODEL MATRIX: NOT RUN instead of zero when no key or recording exists.' },
      { tag: 'Fixed', text: 'Context-truncated defects report as truncated, never as model misses.' },
    ],
  },
  {
    version: '1.3',
    date: 'May 19, 2026',
    title: 'Six Thinking Orbs review states',
    summary:
      'Progress stops being a generic spinner: every live phase shows the orb animation that matches the work in flight.',
    highlights: [
      {
        title: 'Phase-mapped orb animations',
        description:
          'Discovery, mapping, segmentation, path tracing, review, validation, and scoring each get their own dependency-free Canvas 2D state — working, searching, shaping, composing, solving, listening.',
      },
      {
        title: 'Reduced-motion static frames',
        description:
          'Users who prefer reduced motion receive a deterministic static frame instead of animation, with full labels preserved.',
      },
    ],
    entries: [
      { tag: 'New', text: 'Orb states reused 1:1 between the Electron app and this site.' },
      { tag: 'Improved', text: 'Offscreen and hidden-tab rendering pauses automatically.' },
      { tag: 'Fixed', text: 'Reinitialization cleans up the previous canvas instance before mounting.' },
    ],
  },
  {
    version: '1.2',
    date: 'April 7, 2026',
    title: 'Dropped candidates & honest states',
    summary:
      'Rejected claims stay visible with their reasons, and every report states what ran and what did not.',
    highlights: [
      {
        title: 'The review bar, made visible',
        description:
          'Evidence mismatches, low-confidence claims, and policy rejections are listed with the comparison that refused them. Nothing vanishes silently.',
      },
      {
        title: 'Complete / partial / degraded / failed',
        description:
          'A limitation is not a finding: it has no severity, file, or fix. Incomplete reviews are never presented as clean ones.',
      },
    ],
    entries: [
      { tag: 'Improved', text: 'Coverage panel reports files, blocks, paths, and elapsed time per run.' },
      { tag: 'Improved', text: 'Agent fix prompts ship Greptile-style scores with file:line locations.' },
    ],
  },
  {
    version: '1.1',
    date: 'February 23, 2026',
    title: 'Local API & CLI reviews',
    summary: 'The same engine serves the desktop app, a loopback API, and one-shot command-line reviews.',
    highlights: [
      {
        title: 'Loopback API with per-launch token',
        description:
          'Binds to 127.0.0.1 only, requires a generated token on every data route, validates Origin and Host, and allows https provider URLs unless loopback.',
      },
      {
        title: 'One-shot CLI gating',
        description:
          'Review any path with --changed-only against a base branch, --fail-on severities for CI gates, and --json for machine-readable output.',
      },
    ],
    entries: [
      { tag: 'Improved', text: 'Provider base URLs validated before use: no credentials, no private addresses.' },
      { tag: 'Fixed', text: 'API keys refused in clear on machines without an OS key store.' },
    ],
  },
  {
    version: '1.0',
    date: 'January 12, 2026',
    title: 'CodeRadar 1.0 — reviews with proof',
    summary:
      'The first public release: local-first Electron app, deterministic detectors, opt-in AI review, and the evidence gate with no bypass.',
    highlights: [
      {
        title: 'Evidence gate, enforced by the engine',
        description:
          'A finding must quote code that is actually in the file it names, at a line that is actually in range. No bypass for detectors, the model, or future adapters.',
      },
      {
        title: 'One runtime, fully testable',
        description:
          'Electron + Node.js + TypeScript only. The engine core imports no fs, no path, never shells out — the pipeline is testable against fixtures: 261 engine tests, 74 frontend tests.',
      },
    ],
    entries: [
      { tag: 'New', text: 'Review setup: pick a file or folder, choose a preset, run.' },
      { tag: 'New', text: 'Provider settings with live connection test before save.' },
    ],
  },
];
