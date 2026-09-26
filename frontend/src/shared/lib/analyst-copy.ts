/**
 * The rewrites, each a pattern and its replacement. Typed as pairs so the
 * replacement is always a string: `String.replace` takes a function as its
 * second argument, and an untupled array literal infers `RegExp | string` for
 * both members.
 */
const COPY_REWRITES: readonly (readonly [RegExp, string])[] = [
  [/\[Security Scan\]/g, "[Code Review]"],
  [/\bSecurity Scan\b/g, "Code Review"],
  [/\bsecurity scan\b/g, "code review"],
  [/\bSecurity scan\b/g, "Code review"],
  [/\bscan sessions\b/g, "review sessions"],
  [/\bscan session\b/g, "review session"],
  [/\bDeep Scan\b/g, "Deep review"],
  [/\bFast Scan\b/g, "Fast review"],
  [/\bdeep scan\b/g, "deep review"],
  [/\bfast scan\b/g, "fast review"],
  [/\bScan completed\b/g, "Review completed"],
  [/\bScan failed\b/g, "Review failed"],
  [/\bscan completed\b/g, "review completed"],
  [/\bscan failed\b/g, "review failed"],
  [/\bScanning\b/g, "Reviewing"],
  [/\bscanning\b/g, "reviewing"],
  [/\breal scan evidence\b/g, "real review evidence"],
  [/\breal scan result\b/g, "real review result"],
  [/\breal scan trace\b/g, "real review trace"],
  [/^Scan\s+/g, "Review "],
];

export function toAnalystCopy(text: string | null | undefined): string {
  if (!text) return "";

  return COPY_REWRITES.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}