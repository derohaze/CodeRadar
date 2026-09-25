/**
 * Repository index catalog.
 *
 * These tables are a direct port of the Rust indexer's `config.rs`. The marker
 * lists and the hotspot weights are behaviour, not implementation detail, so
 * they are copied verbatim rather than adjusted: changing a weight would change
 * which files the review treats as risky, which is a product change.
 *
 * The Rust walker's ignore list is deliberately NOT ported. It lived in the
 * indexer because the indexer owned its own walk; here the walk is already owned
 * by `repository/discover.ts`, and a second, different ignore policy in the same
 * pipeline would mean two answers to "what is in this repository". The discovery
 * policy is a superset for one deliberate reason: it keeps test directories,
 * because a code review must be able to read tests. See the migration plan.
 */

/** Files that identify a project's dependencies and build. */
export const MANIFEST_FILES: readonly string[] = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "build.gradle",
  "pom.xml",
  "composer.json",
  "go.mod",
  "web.xml",
  "cargo.toml",
];

/** A file whose signals make it worth a reviewer's first attention. */
export const HOTSPOT_LIMIT = 24;

/** Content beyond this is not scanned for markers; the read is capped. */
export const MAX_INDEXED_FILE_BYTES = 512 * 1024;

/** Markers that indicate an inbound request handler. */
export const ROUTE_MARKERS: readonly string[] = [
  "@router.",
  "@app.",
  "app.get(",
  "app.post(",
  "router.get(",
  "router.post(",
  "@getmapping",
  "@postmapping",
  "@requestmapping",
  "handlefunc(",
  "@webservlet",
  "type query",
  "type mutation",
];

/** Markers that indicate an authentication, session, or token boundary. */
export const AUTH_MARKERS: readonly string[] = [
  "jwt",
  "token",
  "session",
  "auth",
  "bearer",
  "csrf",
  "login",
  "securitycontext",
  "principal",
  "oauth",
];

/** Markers that indicate data arriving from the caller. */
export const SOURCE_MARKERS: readonly string[] = [
  "request.",
  "req.body",
  "req.query",
  "req.params",
  "query_params",
  "path_params",
  "$_get",
  "$_post",
  "request.getparameter",
  "variables.",
  "input.",
];

/** Markers that indicate a resource-sensitive operation. */
export const SINK_MARKERS: readonly string[] = [
  "subprocess.",
  "os.system(",
  "child_process.exec",
  "runtime.getruntime().exec",
  "processbuilder",
  "requests.get(",
  "httpx.get(",
  "fetch(",
  "axios.",
  "open(",
  "send_file",
  "fileresponse",
  "pickle.load",
  "yaml.load",
  ".execute(",
  ".query(",
  "$where",
  "eval(",
];

/**
 * Hotspot weights, kept identical to the Rust indexer's `hotspot_reasons`.
 * A score is only a ranking signal; it never becomes a finding on its own.
 */
export const HOTSPOT_WEIGHTS = {
  route: 6,
  auth: 5,
  source: 3,
  sink: 4,
} as const;

export const HOTSPOT_REASONS = {
  route: "request entrypoint",
  auth: "auth boundary",
  source: "untrusted input",
  sink: "sensitive sink",
} as const;
