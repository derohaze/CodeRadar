import { useEffect, useRef } from "react";
import { twMerge } from "tailwind-merge";
import { thinkingOrbs } from "./thinking-orbs";
import type { ThinkingOrbState } from "./thinking-orbs";

const ORB_STATE_LABELS: Record<ThinkingOrbState, string> = {
  working: "Working…",
  searching: "Searching…",
  solving: "Solving…",
  listening: "Listening…",
  composing: "Composing…",
  shaping: "Shaping…",
};

export interface ThinkingOrbProps {
  /** Which of the six orb animations to render. */
  state: ThinkingOrbState;
  /** Rendered size in CSS pixels. The 20px and 64px designs are exact. */
  size?: number;
  /** Freeze on a deterministic frame, e.g. after the work has stopped. */
  paused?: boolean;
  /** Accessible name. Defaults to the state label so the orb is never unlabelled. */
  label?: string;
  className?: string;
  /** Decorative orbs (next to their own visible label) should be hidden from AT. */
  decorative?: boolean;
}

/**
 * Thinking Orbs canvas for long-running work. Wraps the dependency-free vanilla
 * renderer: the canvas carries the data-attribute contract and the module is
 * initialized after mount, then destroyed on unmount or when props change.
 */
export function ThinkingOrb({
  state,
  size = 64,
  paused = false,
  label,
  className,
  decorative = false,
}: ThinkingOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // thinkingOrbs returns its own destroy function; React calls it on unmount
    // and on every prop change so the canvas is re-read with the new attributes.
    return thinkingOrbs(canvas, { state, size, paused });
  }, [state, size, paused]);

  return (
    <canvas
      ref={canvasRef}
      data-thinking-orb
      data-orb-state={state}
      data-orb-size={size}
      data-orb-theme="auto"
      data-orb-paused={paused ? "true" : undefined}
      role="img"
      aria-label={label ?? ORB_STATE_LABELS[state]}
      aria-hidden={decorative ? true : undefined}
      className={twMerge("block", className)}
    />
  );
}
