import { describe, expect, it } from "vitest";
import { thinkingOrbs } from "./thinking-orbs";
import type { ManagedOrbCanvas } from "./thinking-orbs";

/** Mirrors what ThinkingOrb renders: the canvas is the source of truth. */
function attachOrbCanvas(dataset: Record<string, string>, attributes: Record<string, string> = {}) {
  const canvas = document.createElement("canvas") as ManagedOrbCanvas;
  canvas.setAttribute("data-thinking-orb", "");
  Object.entries(dataset).forEach(([key, value]) => canvas.setAttribute(key, value));
  Object.entries(attributes).forEach(([key, value]) => canvas.setAttribute(key, value));
  document.body.appendChild(canvas);
  return canvas;
}

describe("thinkingOrbs", () => {
  it("sizes the canvas from data-orb-size and labels it from the state", () => {
    const canvas = attachOrbCanvas({ "data-orb-state": "searching", "data-orb-size": "20" });

    const destroy = thinkingOrbs(canvas);

    expect(canvas.width).toBe(20);
    expect(canvas.height).toBe(20);
    expect(canvas.style.width).toBe("20px");
    expect(canvas.getAttribute("role")).toBe("img");
    expect(canvas.getAttribute("aria-label")).toBe("Searching…");

    destroy();
    canvas.remove();
  });

  it("keeps a label supplied by the mounted markup", () => {
    const canvas = attachOrbCanvas(
      { "data-orb-state": "listening" },
      { "aria-label": "Review is listening for provider updates" },
    );

    const destroy = thinkingOrbs(canvas);

    expect(canvas.getAttribute("aria-label")).toBe("Review is listening for provider updates");

    destroy();
    canvas.remove();
  });

  it("falls back to the working orb for an unknown state", () => {
    const canvas = attachOrbCanvas({ "data-orb-state": "not-a-real-state" });

    const destroy = thinkingOrbs(canvas);

    expect(canvas.getAttribute("aria-label")).toBe("Working…");

    destroy();
    canvas.remove();
  });

  it("re-initializes a managed canvas without leaking the previous instance", () => {
    const canvas = attachOrbCanvas({ "data-orb-state": "solving", "data-orb-size": "64" });

    thinkingOrbs(canvas);
    const destroy = thinkingOrbs(canvas);

    expect(canvas.dataset.orbState).toBe("solving");
    expect(canvas.width).toBe(64);
    expect(typeof canvas.__thinkingOrbDestroy).toBe("function");

    destroy();

    // Destroy is idempotent: React can call it again on a later unmount.
    expect(() => destroy()).not.toThrow();
    expect(canvas.__thinkingOrbDestroy).toBeUndefined();

    canvas.remove();
  });

  it("renders a frozen frame when the orb is paused", () => {
    const canvas = attachOrbCanvas({ "data-orb-state": "working", "data-orb-paused": "true" });

    const destroy = thinkingOrbs(canvas);

    expect(canvas.dataset.orbPaused).toBe("true");

    destroy();
    canvas.remove();
  });
});
