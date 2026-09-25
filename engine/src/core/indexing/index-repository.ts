/**
 * Repository indexing.
 *
 * Ported from the Rust indexer's `analysis.rs` / `signals.rs` / `hotspots.rs`.
 * The outputs are the same numbers the Rust process produced — route files, auth
 * files, marker totals, and a bounded hotspot ranking — so the repository
 * intelligence the Python backend consumed is still available, now inside the
 * single Node/TypeScript runtime.
 *
 * What changed in the port, and why:
 *
 * - The walk is not reimplemented. Rust owned a private directory walker; here
 *   the file list already exists after discovery, so the index is computed over
 *   that list. One walk, one ignore policy.
 * - Markers are only counted for files whose content was read. Rust read every
 *   supported file for marker hits; reading a whole repository to count markers
 *   is exactly the cost the port exists to avoid, and the indexed read is capped
 *   at the same byte limit as before.
 * - The HTTP server Rust exposed (port 7100) is not recreated. It existed only so
 *   the Python backend could call it, and that consumer is gone.
 *
 * A hotspot is a ranking signal for where to look first. It is never a finding:
 * a marker match alone does not prove a defect, and the review bar forbids
 * reporting one as if it did.
 */

import { detectLanguage } from "../languages/detect.ts";
import { toPosixPath } from "../findings/model.ts";
import type { RepositoryHotspot, RepositoryIndex } from "../findings/model.ts";
import {
  AUTH_MARKERS,
  HOTSPOT_LIMIT,
  HOTSPOT_REASONS,
  HOTSPOT_WEIGHTS,
  MANIFEST_FILES,
  MAX_INDEXED_FILE_BYTES,
  ROUTE_MARKERS,
  SINK_MARKERS,
  SOURCE_MARKERS,
} from "./catalog.ts";

// The index shape is part of the report contract, so it is declared there and
// re-exported here for consumers that only need the indexing module.
export type { RepositoryHotspot, RepositoryIndex } from "../findings/model.ts";

export interface IndexInput {
  /** Every repository-relative path in scope, whether or not it was read. */
  paths: readonly string[];
  /** Content for the files that were read, keyed by the same relative path. */
  contents: ReadonlyMap<string, string>;
}

interface FileSignals {
  routeHit: boolean;
  authHit: boolean;
  sourceHits: number;
  sinkHits: number;
}

function containsAny(text: string, markers: readonly string[]): boolean {
  return markers.some((marker) => text.includes(marker));
}

/**
 * Counts the distinct markers present, not their occurrences. The Rust indexer
 * counted marker *types*, and the totals are reported to the user as such.
 */
function countMarkerHits(text: string, markers: readonly string[]): number {
  return markers.filter((marker) => text.includes(marker)).length;
}

/** Signals present in one file. Exported so the weights stay testable. */
export function fileSignals(relativePath: string, content: string): FileSignals {
  const loweredPath = relativePath.toLowerCase();
  const loweredContent = content.toLowerCase();

  return {
    routeHit: containsAny(loweredContent, ROUTE_MARKERS),
    // Auth is looked for in the path as well as the content: `auth/session.ts`
    // is an auth boundary even when the file itself only holds types.
    authHit: containsAny(loweredContent, AUTH_MARKERS) || containsAny(loweredPath, AUTH_MARKERS),
    sourceHits: countMarkerHits(loweredContent, SOURCE_MARKERS),
    sinkHits: countMarkerHits(loweredContent, SINK_MARKERS),
  };
}

/** The hotspot score and reasons for a file, identical to the Rust weights. */
export function hotspotFor(signals: FileSignals): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (signals.routeHit) {
    score += HOTSPOT_WEIGHTS.route;
    reasons.push(HOTSPOT_REASONS.route);
  }
  if (signals.authHit) {
    score += HOTSPOT_WEIGHTS.auth;
    reasons.push(HOTSPOT_REASONS.auth);
  }
  if (signals.sourceHits > 0) {
    score += HOTSPOT_WEIGHTS.source;
    reasons.push(HOTSPOT_REASONS.source);
  }
  if (signals.sinkHits > 0) {
    score += HOTSPOT_WEIGHTS.sink;
    reasons.push(HOTSPOT_REASONS.sink);
  }

  return { score, reasons };
}

/**
 * The weakest entry currently held, or null when the list is not full.
 *
 * Mirrors the Rust bounded insert: a new file displaces the weakest entry only
 * when it scores higher, or scores the same and sorts earlier by path. That
 * tie-break is what makes the ranking deterministic across runs.
 */
function weakestIndex(hotspots: readonly RepositoryHotspot[]): number | null {
  if (hotspots.length < HOTSPOT_LIMIT) return null;

  let index = 0;
  for (let candidate = 1; candidate < hotspots.length; candidate += 1) {
    const current = hotspots[candidate];
    const weakest = hotspots[index];
    if (current === undefined || weakest === undefined) continue;
    if (current.score < weakest.score || (current.score === weakest.score && current.file > weakest.file)) {
      index = candidate;
    }
  }
  return index;
}

function pushBounded(hotspots: RepositoryHotspot[], hotspot: RepositoryHotspot): void {
  const weakest = weakestIndex(hotspots);
  if (weakest === null) {
    hotspots.push(hotspot);
    return;
  }

  const weakestEntry = hotspots[weakest];
  if (weakestEntry === undefined) return;
  const better =
    hotspot.score > weakestEntry.score ||
    (hotspot.score === weakestEntry.score && hotspot.file < weakestEntry.file);
  if (better) hotspots[weakest] = hotspot;
}

/**
 * Languages are grouped exactly the way the Rust indexer grouped them: `.tsx`
 * counts as TypeScript and `.jsx` as JavaScript, because a repository summary
 * counts a language once, not once per dialect. `detectLanguage` deliberately
 * keeps the dialect — the reviewer prompt names it — so the grouping belongs to
 * the report rather than to detection.
 */
const INDEX_LANGUAGE_GROUPS: Record<string, string> = {
  tsx: "typescript",
  jsx: "javascript",
};

function isManifest(relativePath: string): boolean {
  const name = relativePath.split("/").pop() ?? "";
  return MANIFEST_FILES.includes(name.toLowerCase());
}

/**
 * Indexes the repository the review is running over.
 *
 * Deterministic for a given input: paths are processed in the order given, and
 * the hotspot ranking has a total order, so two runs over one tree agree.
 */
export function indexRepository(input: IndexInput): RepositoryIndex {
  const languages: Record<string, number> = {};
  const manifests: string[] = [];
  const hotspots: RepositoryHotspot[] = [];

  let routeFiles = 0;
  let authFiles = 0;
  let sourceMarkers = 0;
  let sinkMarkers = 0;
  let truncatedFiles = 0;
  let bytesIndexed = 0;

  for (const rawPath of input.paths) {
    const path = toPosixPath(rawPath);

    if (isManifest(path)) manifests.push(path);

    const language = detectLanguage(path);
    if (language.id !== "") {
      const grouped = INDEX_LANGUAGE_GROUPS[language.id] ?? language.id;
      languages[grouped] = (languages[grouped] ?? 0) + 1;
    }

    const content = input.contents.get(rawPath) ?? input.contents.get(path);
    if (content === undefined) continue;

    // The Rust reader truncated at the cap rather than skipping the file, and
    // counted it as oversized. A truncated read still yields useful signals.
    const truncated = content.length > MAX_INDEXED_FILE_BYTES;
    const scanned = truncated ? content.slice(0, MAX_INDEXED_FILE_BYTES) : content;
    if (truncated) truncatedFiles += 1;
    bytesIndexed += scanned.length;

    const signals = fileSignals(path, scanned);
    if (signals.routeHit) routeFiles += 1;
    if (signals.authHit) authFiles += 1;
    sourceMarkers += signals.sourceHits;
    sinkMarkers += signals.sinkHits;

    const hotspot = hotspotFor(signals);
    if (hotspot.score > 0) pushBounded(hotspots, { file: path, score: hotspot.score, reasons: hotspot.reasons });
  }

  hotspots.sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));
  manifests.sort((left, right) => left.localeCompare(right));

  return {
    filesIndexed: input.paths.length,
    languages,
    manifests,
    routeFiles,
    authFiles,
    sourceMarkers,
    sinkMarkers,
    hotspots,
    truncatedFiles,
    bytesIndexed,
    contentUnavailable: input.contents.size === 0,
  };
}

/**
 * A one-line description of the repository for the reviewer's prompt.
 * The hotspot paths are the useful part: they tell the model where the entry
 * points are, which is what a human reviewer would be handed first.
 */
export function describeRepositoryIndex(index: RepositoryIndex): string {
  const parts: string[] = [`${index.filesIndexed} files indexed`];

  const languages = Object.entries(index.languages)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([id, count]) => `${id} (${count})`);
  if (languages.length > 0) parts.push(`languages: ${languages.join(", ")}`);

  if (index.manifests.length > 0) parts.push(`manifests: ${index.manifests.slice(0, 4).join(", ")}`);
  if (index.routeFiles > 0) parts.push(`${index.routeFiles} request entry files`);
  if (index.authFiles > 0) parts.push(`${index.authFiles} auth-boundary files`);

  return parts.join(", ");
}
