import type { RejectedCandidateSummary } from "@/shared/api/security";

/**
 * Wording and grouping for candidates the review bar dropped.
 *
 * The engine refuses a candidate for one of a small set of reasons, and those
 * reasons mean different things to a reviewer: the evidence did not check out, or
 * the claim was a preference, or the same defect was already reported. Collapsing
 * them into one "candidate" count hides the only part that matters — whether
 * CodeRadar refused a claim or never saw the defect at all.
 *
 * The engine sends the machine reason and this module owns the wording, so the
 * vocabulary lives in one place instead of being spread over the engine and the
 * screen.
 */

/**
 * How a dropped candidate is filed.
 *
 * `rejected` is a refusal by the review bar. `merged` and `capped` are not
 * refusals: in both cases the candidate was good enough, and something else
 * decided its fate. Filing them together would read as "the claim was doubtful",
 * which is the opposite of what happened.
 */
export type RejectionClassification = "rejected" | "merged" | "capped";

const REASON_LABELS: Record<string, string> = {
  "evidence-not-in-source": "Evidence not found in source",
  "missing-field": "Incomplete candidate",
  "too-short": "Too short to be a claim",
  "excluded-concern": "Preference, not a defect",
  "low-confidence": "Below the confidence floor",
  "severity-not-supported": "Severity not supported",
  "line-out-of-range": "Anchor out of range",
  "file-not-in-scope": "File not in scope",
  "anchor-outside-changed-lines": "Outside the changed lines",
  "invalid-location": "Unusable anchor",
  "merged-duplicate": "Merged into an existing finding",
  "over-finding-cap": "Over the finding cap",
};

const REASON_EXPLANATIONS: Record<string, string> = {
  "evidence-not-in-source":
    "The code the claim quotes does not appear in the reviewed file, so there was nothing to check the claim against.",
  "missing-field":
    "A required field was missing. Filling it in would mean writing the claim ourselves, which the review bar does not do.",
  "too-short": "A required field was one-word filler rather than a statement of a defect.",
  "excluded-concern":
    "The claim described style, naming, formatting, or something tooling already catches. The review bar excludes those outright.",
  "low-confidence": "The claim arrived below the confidence floor, so it was treated as a guess rather than knowledge.",
  "severity-not-supported": "The severity claimed cannot be asserted on that review axis.",
  "line-out-of-range": "The reported lines are past the end of the file, or span more lines than an anchor may.",
  "file-not-in-scope": "The file was not part of the reviewed scope, so nothing about it could be verified.",
  "anchor-outside-changed-lines":
    "This review only reports on lines the change touched, and the anchor is elsewhere in the file.",
  "invalid-location": "The reported line was not a usable anchor.",
  "merged-duplicate": "The same defect was reported more than once, and the strongest version of it was kept.",
  "over-finding-cap": "It cleared the review bar, but the report caps how many findings it shows at once.",
};

export function classifyRejection(reason: string): RejectionClassification {
  if (reason === "merged-duplicate") return "merged";
  if (reason === "over-finding-cap") return "capped";
  return "rejected";
}

/** The reason, in the words a reviewer reads. Unknown reasons are de-slugged. */
export function getRejectionReasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason.replace(/-/g, " ");
}

/** One sentence a reviewer can act on: why this candidate was not reported. */
export function getRejectionExplanation(reason: string): string {
  return REASON_EXPLANATIONS[reason] ?? "The review bar dropped this candidate.";
}

export interface RejectedCandidateGroup {
  classification: RejectionClassification;
  /** The classification heading. Never the same words as a single row's reason. */
  heading: string;
  /** A short label for the summary chips. */
  shortLabel: string;
  candidates: RejectedCandidateSummary[];
}

const GROUP_ORDER: RejectionClassification[] = ["rejected", "merged", "capped"];

const GROUP_HEADINGS: Record<RejectionClassification, { heading: string; shortLabel: string }> = {
  rejected: { heading: "Refused by the review bar", shortLabel: "Refused" },
  merged: { heading: "Merged as a duplicate", shortLabel: "Merged" },
  capped: { heading: "Beyond the finding cap", shortLabel: "Capped" },
};

/**
 * Groups dropped candidates for display, refusals first.
 *
 * Order is fixed and empty groups are dropped, so the screen reads the same way
 * for every review instead of reordering itself around whichever reason happened
 * to be most common.
 */
export function groupRejectedCandidates(candidates: readonly RejectedCandidateSummary[]): RejectedCandidateGroup[] {
  const groups = new Map<RejectionClassification, RejectedCandidateSummary[]>();

  for (const candidate of candidates) {
    const classification = classifyRejection(candidate.reason);
    const bucket = groups.get(classification);
    if (bucket === undefined) groups.set(classification, [candidate]);
    else bucket.push(candidate);
  }

  return GROUP_ORDER.filter((classification) => groups.has(classification)).map((classification) => ({
    classification,
    ...GROUP_HEADINGS[classification],
    candidates: groups.get(classification) ?? [],
  }));
}

/** `src/app.ts:12` / `src/app.ts:12-18`, the anchor as the engine reported it. */
export function formatRejectedLocation(candidate: RejectedCandidateSummary): string {
  return candidate.lineEnd > candidate.line
    ? `${candidate.file}:${candidate.line}-${candidate.lineEnd}`
    : `${candidate.file}:${candidate.line}`;
}
