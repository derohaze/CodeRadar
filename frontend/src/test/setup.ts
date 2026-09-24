import "@testing-library/jest-dom";

// jsdom ships no canvas backend, so getContext("2d") normally logs a
// "Not implemented" error and returns null. The thinking-orb renderer needs a
// context to initialize, so give component tests a no-op 2D context stub and let
// them exercise the real init path.
const noopCanvasContext = new Proxy(
  {},
  {
    get: (_target, property) => (property === "canvas" ? null : () => undefined),
    set: () => true,
  },
);

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  writable: true,
  value: () => noopCanvasContext,
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
