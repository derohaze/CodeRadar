/**
 * The policy of a review run: how wide it casts, and how its stages are reported.
 *
 * `core/findings/policy.ts` is the bar one *claim* has to clear. This module is
 * the run-level policy around it — the breadth the user picks before a review
 * starts, and the stage plan every review event belongs to.
 *
 * Both were previously decided inside the HTTP adapter, which put product
 * judgement in the transport. The transport can be replaced without changing how
 * wide a review casts or what the progress screen is told, so neither decision
 * belongs there.
 */

import type { ReviewEventType } from "../ports.ts";

/**
 * The user's choice of how wide a net a run casts, as the Home screen offers it.
 *
 * The engine has no notion of "preset" beyond this: a preset is a named point on
 * the breadth ladder, and the only thing the ladder changes today is the finding
 * budget.
 */
export type ReviewBreadthPreset = "safe" | "balanced" | "aggressive";

/**
 * The finding budget a breadth preset asks for.
 *
 * The preset is the user's choice of how wide a net this run casts, and the
 * Settings screen describes it in exactly those terms: "safe" prioritises
 * high-confidence findings, "aggressive" pushes deeper for more risky edges.
 * `null` means "use the saved setting", so the balanced preset leaves the
 * configured cap alone rather than replacing it with a number of its own.
 */
const FINDING_BUDGET_BY_PRESET: Record<ReviewBreadthPreset, number | null> = {
  safe: 8,
  balanced: null,
  aggressive: 30,
};

export function findingBudgetForPreset(preset: ReviewBreadthPreset): number | null {
  return FINDING_BUDGET_BY_PRESET[preset];
}

/** Where a stage of a review sits, as the progress screen reads it. */
export interface ReviewPhase {
  phase: string;
  /**
   * Position of the stage on the progress bar, 0-100.
   *
   * `-1` means "this event reports no progress of its own": it is a retry or a
   * failure notice, and moving the bar for it would be a lie.
   */
  progress: number;
}

/**
 * The stage a review event belongs to, named the way the progress screen names
 * its phases so the activity indicator matches the work actually in flight.
 */
const PHASE_BY_EVENT: Record<ReviewEventType, ReviewPhase> = {
  "git:start": { phase: "Repository mapping", progress: 4 },
  "git:done": { phase: "Repository mapping", progress: 8 },
  "discovery:start": { phase: "Discovery", progress: 12 },
  "discovery:done": { phase: "Discovery", progress: 22 },
  "index:done": { phase: "Repository mapping", progress: 30 },
  "context:done": { phase: "Repository mapping", progress: 36 },
  "detectors:done": { phase: "Reviewing paths", progress: 52 },
  "ai:start": { phase: "Reviewing paths", progress: 58 },
  // A retry is not progress: it keeps the current position so the bar cannot
  // move backwards while the provider is being given another chance.
  "ai:retry": { phase: "Reviewing paths", progress: -1 },
  "ai:done": { phase: "Reviewing paths", progress: 82 },
  "ai:failed": { phase: "Reviewing paths", progress: -1 },
  "validation:done": { phase: "Validation", progress: 92 },
  done: { phase: "Completed", progress: 100 },
};

/**
 * The stage plan lookup. Returning `undefined` for an event type this build does
 * not know keeps an unknown event from being reported as a phase of its own.
 */
export function reviewPhaseForEvent(type: ReviewEventType): ReviewPhase | undefined {
  return PHASE_BY_EVENT[type];
}
