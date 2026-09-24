# @codeguard/engine

The CodeGuard review engine. Local-first code review with a versioned finding
contract, real evidence checks, and no dependency on the legacy Python backend.

This package is Phase 1 of `docs/review-engine-migration-plan.md`. It reviews a
file, a folder, or a repository and produces findings that each carry a defect,
the reason it is a defect, its impact, quoted evidence from the file, and a fix.

## Running it

```bash
cd engine
bun install          # dev types and the TypeScript compiler only

bun test             # the test suite, against real fixtures on disk
bun run typecheck    # tsc --noEmit, strict

# Review a folder, deterministically, with no model involved
bun run review ../frontend/src --no-ai

# Review only what changed against a base branch
bun run review . --changed-only --base main

# Machine-readable output
bun run review . --no-ai --json
```

Exit codes: `0` when the review completed, `2` when it could not run. Add
`--fail-on <severity>` to get `1` when a finding at or above that severity
exists, which is what a CI gate needs.

### Enabling the model

The deterministic detectors need no configuration. The model stage turns on when
all three variables are set:

```bash
export CODEGUARD_AI_ENDPOINT="https://integrate.api.nvidia.com/v1/chat/completions"
export CODEGUARD_AI_KEY="..."
export CODEGUARD_AI_MODEL="deepseek-ai/deepseek-v4.1-flash"
```

The runtime has zero dependencies. The model is reached over plain HTTP with
`fetch`, so no provider SDK is installed for any provider.

## Layout

```
src/core/
  findings/     the finding model, the review bar, validation, deduplication
  languages/    language, project kind, and package manager detection
  repository/   discovery, scope selection, context, tooling detection
  diff/         unified diff parsing and changed-line mapping
  review/       the pipeline, prompt building, model output, the detectors
src/adapters/   node filesystem and git, the only modules that touch the outside
src/cli.ts      the command line surface
prompts/        the review policy and the reviewer persona, as markdown
test/fixtures/  code with deliberate, unambiguous defects, read from disk
```

The core never imports `node:fs`, `node:path`, or a git binary. Everything from
the outside world arrives through a port in `src/core/ports.ts`, which is why the
pipeline is testable against fixtures and why the Electron main process and an
HTTP adapter can share it unchanged.

## The pipeline

```
git or filesystem
      |
repository discovery        bounded walk, secret files excluded before any read
      |
scope selection             changed files first, then entry points, then path
      |
context assembly            numbered windows, imports, exports, related files
      |
detectors  +  model         deterministic patterns, and the reviewer, in parallel
      |
validation                  the bar: shape, evidence, anchoring, confidence
      |
deduplication               one defect reported once
      |
confidence filtering        severity lowered to what the confidence supports
      |
report                      strongest first, capped at 15
```

## What it guarantees

- **Nothing is reported without evidence.** `validateCandidate` re-checks every
  quote against the reviewed file. A model that invents a defect on a plausible
  line produces nothing, because the quote is not there.
- **The review cannot escape the path it was given.** Git is used to name paths
  and order files, never to widen the scope. `scope.root` is what you asked for;
  `scope.pathBase` is what the paths in findings are relative to.
- **Credentials are never read.** `.env`, key files, and credential JSON are
  excluded by name during discovery, before any file is opened, because reviewed
  source is sent to a provider.
- **A linter's job is left to the linter.** No detector repeats what a lint rule
  already reports, and the project's real linter configuration is passed to the
  model so it does not spend its budget there either.
- **A provider outage is not a clean bill of health.** A failed model call
  degrades the review to its deterministic findings and emits `ai:failed`.
- **Model output is untrusted input.** Nothing from a response is used before its
  type is checked, and a provider error body is redacted of the API key before it
  reaches an error message.

## Known limitations

- One model call per file. Cross-file reasoning comes from the imported files'
  export surfaces, not from sending several full files at once.
- The model stage reviews at most `maxAiFiles` (default 40) files.
- Detector coverage is deliberately narrow: ten high-precision patterns. A
  pattern that is right only sometimes is not a detector. One was written,
  measured against a real codebase, found to be wrong every time, and deleted.
- Error handling is covered by the model rather than by a pattern. An empty
  catch is sometimes a deliberate best-effort fallback and sometimes a real
  swallow, and telling them apart needs the enclosing function, not a regex.
- Untracked files do not appear in a git diff, so a diff-scoped review does not
  see them until they are added.
- The report is JSON in memory. Persistence, the HTTP surface, and the UI are
  later phases.
