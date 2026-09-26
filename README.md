# CodeRadar

CodeRadar is a local-first code review desktop app. You point it at a file or a folder, it reads the
code, and it reports the defects it can prove — each with the quoted evidence it came from, the
consequence if it ships, and a concrete fix.

Everything runs on your machine. There is one runtime: **Electron + Node.js + TypeScript**. No Python
and no Rust are required, installed, or invoked at runtime.

## What it looks like

These are screenshots of the running app, not mock-ups. They were taken by
`frontend/scripts/screenshots.mjs`, which drives the same Electron window a user drives and runs a
real review of `engine/test/fixtures/buggy` through a real model provider.

**Pick a source, choose a preset, run the review.**

![Review setup screen](docs/screenshots/01-review-setup.png)

**Connect a provider.** The key is tested with a live call before it is saved, and it is listed back
masked once active.

![Provider settings with a live connection test](docs/screenshots/02-providers.png)

**The review runs in the app.** Progress streams as the engine walks the repository.

![A review in progress](docs/screenshots/03-review-running.png)

**Findings, and what the bar dropped.** The results screen separates validated findings from the
candidates the review bar refused, so a dropped claim stays visible as a count instead of silently
disappearing.

![Validated findings for a reviewed repository](docs/screenshots/04-findings.png)

**Open a finding.** Each one carries its severity, the confidence behind it, and the fix it proposes.

![A finding's detail and proposed fix](docs/screenshots/05-finding-detail.png)

To regenerate the set, start the dev server and point the script at your own provider:

```bash
cd frontend
bun run dev &
CODERADAR_AI_KEY=... node scripts/screenshots.mjs
```

The script replaces the whole set on every run and asserts the marker each screen is known by, so a
capture cannot go stale silently: when the progress screen or the findings list is not on screen, it
says the capture was skipped instead of writing a picture of the wrong thing.

## Architecture

```
CodeRadar
│
├── Electron
│   ├── Main process ──────────────────────────────┐
│   └── React renderer                             │
│                                                  ▼
│                                        TypeScript review engine
│                                        ├── Repository discovery
│                                        ├── Git (branch, diff, changed lines)
│                                        ├── Repository index (languages, manifests, hotspots)
│                                        ├── Context (imports and export surfaces)
│                                        ├── Deterministic detectors
│                                        ├── AI review (OpenAI-compatible providers)
│                                        ├── Validation (evidence must be in the source)
│                                        ├── Dedupe and the confidence bar
│                                        └── Findings
│                                                  │
│                                        local API on 127.0.0.1
│                                                  │
└──────────────────────────────────────────────────┘
```

The engine core (`engine/src/core/`) imports no `node:fs`, no `node:path`, and never shells out. It
depends on two ports — a filesystem and a git adapter — which is why the whole pipeline is testable
against fixtures, and why the same code serves the desktop app and the CLI.

Two things are load-bearing and enforced by the engine, not by convention:

- **Nothing reaches a report without passing validation.** A finding must quote code that is actually
  in the file it names, at a line that is actually in range. There is no bypass for detectors, for the
  model, or for a future adapter.
- **A failed model call is not a failed review.** An unavailable provider degrades the run to the
  deterministic checks and says so on the progress stream.

## Repository layout

```
engine/                    the review engine (TypeScript, no runtime dependencies)
  src/core/                pipeline: language detection, discovery, index, diff, context, findings
  src/core/replay/         record and replay a model's answers, offline
  src/adapters/            node filesystem, git, and the file-backed replay store
  src/node/                settings, providers, the review service, the local API
  src/cli.ts               `bun run review <path>`
  src/eval/                scores a saved run against a fixture's ground truth
  scripts/score-review.ts  `bun run score <run.json>`
  scripts/benchmark.ts     `bun run benchmark` — one row per model, same pipeline
  prompts/                 the review policy and reviewer persona, as markdown (canonical)
  test/                    fixtures with planted defects, and the suite that pins them
frontend/                  Electron + React desktop app
  electron/main.cjs        starts the engine in-process and opens the window
  electron/review-engine.cjs  the engine, bundled from engine/src/node/electron-entry.ts
  electron/prompts/        generated copy of engine/prompts, written by the build
  src/                     React renderer
docs/                      design notes and the migration record
  adr/                     architecture decisions, kept with the code
```

## Getting started

Prerequisites: **Bun** and **git**. Nothing else — the same toolchain runs the engine,
its tests, and the bundle the desktop app loads.

```bash
cd frontend && bun install
cd ../engine && bun install
```

### Running it

The review engine and the app are separate processes, and there are two ways to start
them. Both give you the same app.

**One command, engine in its own process** (the normal development flow):

```bash
cd frontend
bun run dev:all
```

This starts the engine on its own, waits for it to answer, then starts Vite and
Electron and tells the app where the engine is. The engine's URL and token are printed at
startup, so you can `curl` it while the app runs:

```
CodeRadar: engine ready at http://127.0.0.1:54321/api/v1
CodeRadar: token 9f2c... (send it as the x-coderadar-token header)
```

**App only, engine embedded** (nothing else to run; Electron starts the engine itself):

```bash
cd frontend
bun run electron:dev
```

Use `dev:all` when you are working on the engine: you can restart it alone, hit its routes
directly, and watch it fail without losing the UI. Use `electron:dev` when you only care
about the app, or to check the packaged behaviour, where the engine is embedded because a
desktop app cannot ask the user to start a server first.

### The engine on its own

The engine is a complete backend on its own, with no Electron involved:

```bash
cd engine
bun run serve                 # local API on 127.0.0.1:9000, prints its token and a curl example
```

And a one-shot review from the command line, which needs no server at all:

```bash
cd engine
bun run review ../frontend/src --json
bun run review . --changed-only --base main --fail-on high
```

### Building

```bash
cd frontend && bun run electron:build:win   # installer
```

The engine is bundled into `frontend/electron/review-engine.cjs` before the app is built or
developed, because that file is what the Electron main process loads. `electron:dev`,
`electron:build`, and `electron:build:win` all run this step first, so none of them can start the
app against a bundle older than `engine/src`:

```bash
cd frontend && bun run engine:bundle   # also copies engine/prompts into electron/prompts
```

Both generated paths are ignored by git. They are regenerated from `engine/src` and
`engine/prompts`, which are the sources of truth.

### Review from the command line

The engine is useful without the desktop app:

```bash
cd engine
bun run review ../frontend/src --json
bun run review . --changed-only --base main --fail-on high
```

AI is opt-in from the environment; without all three variables the review runs the deterministic
detectors only:

```
CODE_RADAR_AI_ENDPOINT   Full chat-completions URL
CODE_RADAR_AI_KEY        Provider API key
CODE_RADAR_AI_MODEL      Model name
```

## The review contract

CodeRadar's authority is the code, not the model. A model proposes a candidate;
the system decides whether it is a finding. That is why the pipeline is fixed and
only the provider is interchangeable — the same prompt policy, context builder,
parser, evidence gate, validator, dedupe, confidence policy, report contract and
scorer serve every model. See [docs/adr/0001](docs/adr/0001-model-is-a-replaceable-reasoning-layer.md).

The evidence gate is the part that must not bend: a finding has to quote code
that really appears in the file it names, at a line that really exists and that
really shows the defect. A claim the system cannot prove is rejected and listed
as a dropped candidate, with the reason. This is never relaxed to make a report
look stronger — a model that cannot prove a claim scores as a miss.

### What a report says about itself

A review that reports nothing is ambiguous: either the code was read and is
clean, or a stage did not run. The two need opposite responses, so every report
carries its own state and its own limitations rather than leaving the difference
to be inferred from a findings count.

| state | meaning |
|---|---|
| `complete` | Every file in scope was read and every model answer could be read. Zero findings here means clean code. |
| `partial` | Everything in scope was read, but something was narrowed: a file was not sent to the model, the scope was smaller, or a file was truncated. |
| `degraded` | A stage did not run or could not be read. A missing finding is **not** evidence of clean code. |
| `failed` | No review result exists. |

A limitation is not a finding: it has no severity, no file and no fix, because
nothing has been claimed about the code. The renderer shows `complete`, `partial`
and `degraded` differently and never presents an incomplete review as a clean one.
Model answers are classified per file, so an unreadable response (`invalid`) is
kept apart from a model that read the file and reported nothing (`empty`).

### Ground truth, scoring and replay

`engine/test/fixtures/ai-review` is the accuracy fixture: eleven files with nine
planted defects (`D1`-`D9`) and ten pieces of code written to look wrong but
correct (`C1`-`C10`), all recorded in `GROUND_TRUTH.md`.

Each defect carries an **anchor**: the line range that shows it. A finding is
credited only when it names the defect's file *and* its own line range overlaps
that anchor. Naming the right file at the wrong line is not a detection, because
crediting it would score how much a review knows about the fixture rather than
what it found in the code.

```bash
cd engine
bun run score /tmp/run.json            # a saved run, against the fixture
bun run benchmark                      # the deterministic half alone
bun run benchmark --models model-a     # one row per model, same pipeline
```

The scorer reports detected and missed defects, true and false positives,
negative-control leaks, unsupported claims, duplicate anchors, unanchorable
findings, parser and provider failures, model coverage, precision and recall. A
count of findings is not a metric on its own: ten findings can be excellent or
catastrophic.

The diagnosis is per defect, and it follows the whole chain: was the file
selected, was it sent, did the model claim anything on the defect's lines, did the
parser keep that claim, did it name the right file at the right anchor, was its
evidence found in the source, did the validator accept it, and did it survive
dedupe and the report cap. A claim that died reports one stage, because
`not-sent`, `context-truncated`, `parser-dropped`, `evidence-mismatch`,
`validator-rejected`, `policy-rejected` and `model-missed` are different jobs for
different owners.

A file that was sent is not a file that was shown in full. Each run reports the
files whose context windows covered only part of the file, and a defect whose own
lines were never sent is reported as `context-truncated` rather than as a miss the
model made in the code.

Model answers can be recorded and replayed, so a change to the parser, validator
or scorer can be checked against real answers with no provider and no key:

```bash
cd engine
CODE_RADAR_AI_KEY=... bun run benchmark --models model-a --record .coderadar/replay --json > live.json
bun run benchmark --models model-a --replay .coderadar/replay --reviewer-name http:example.test --json > replay.json
diff <(jq -S .rows live.json) <(jq -S .rows replay.json)
```

A recording is keyed by the reviewer that made it, so an offline replay states
that identity (`--reviewer-name http:<host>`, or the same `--endpoint` again)
rather than guessing it from the model id: two providers can serve the same model
id, and a recording made against one must not answer for the other. `--json`
carries no latency and no timestamp, so the two rows are comparable as they stand
and the diff is the determinism check.

Recordings are local only (`.coderadar/`, gitignored, owner-only permissions,
`CODE_RADAR_REPLAY_DIR` to move them). A recording holds the model's raw response,
which quotes the code that was reviewed, so it is evidence for this machine and
not source. A missing recording fails loudly rather than replaying as a clean run.

The per-call record a report keeps is counts and identifiers only: the provider
host, the requested model, and one entry per attempt with its outcome, status,
content type, request id, byte counts, response id, finish reason and token totals.
It never holds a prompt, a response body, or a credential, which is what makes it
safe to keep next to a report and pasted into a review of the run.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `CODE_RADAR_API_PORT` | `9000` when served alone, ephemeral inside the app | Port for the local review API. The app tells the renderer where it landed, so this is only needed to pin a port. |
| `CODE_RADAR_API_TOKEN` | generated per start | Secret every data route requires. Printed by `bun run serve`. |
| `CODE_RADAR_SETTINGS_DIR` | the OS user-data directory | Where `settings.json` and the standalone local key live. |
| `CODE_RADAR_API_BASE_URL` | unset | Set on the **app** to make it connect to an already-running engine instead of starting its own. This is what `dev:all` sets. |
| `CODE_RADAR_REPLAY_DIR` | `engine/.coderadar/replay` | Where model recordings are kept. Local evidence, never committed. |

Provider, model, API key, and review defaults are stored as JSON in the app's user-data directory and
edited through the app's Settings screen. The API key is encrypted with the OS keychain
(`safeStorage`); on a machine with no key store the app refuses to save one rather than writing it in
clear.

## Testing

```bash
cd engine   && bun run typecheck && bun test    # 261 tests
cd frontend && bun run test                     # 74 tests
```

Tests are split by what they need. Everything above runs offline with no
credentials: the fixtures, the recorded replays, the parser, the validator, the
scorer, the review-state and wire contracts, and the renderer. Live calls are
separate and opt-in — `bun run benchmark` with a key, and
`frontend/scripts/gui-smoke.mjs` with `CODERADAR_AI_KEY` — and are reported as
`SKIPPED`/`NOT RUN` when they cannot run. They are never reported as a pass.

The engine suite covers the pipeline, the repository index, the settings store, and the local API
contract end-to-end — including the security envelope, which is tested against real requests. The
finding validator is pinned by regression tests taken from real model output, including the ways a
model can write a true claim differently from the file (a quote character, a dash, the statement
terminator at the end of an excerpt, and a single-quoted excerpt whose line breaks are escaped) and
the controls that must stay rejected. The review-state rules are pinned the same way: an unreadable
model answer, an empty one, a dropped entry, a provider outage and a model left out by request each
produce a different state and a different limitation.

The accuracy fixture, the anchor rule, the scorer, the model matrix and the replay harness are
described under "The review contract" above; the GUI smoke test scores a live run with the same
scorer and the same ground truth.

## What is measured here, and what is not

The model matrix is measured out of band rather than in the committed suite, because it needs a
provider key: `bun run benchmark` prints `MODEL MATRIX: NOT RUN` when it has neither a key nor a
recording, and says the model quality is unmeasured rather than zero, so a reader can always tell an
absent measurement from a bad one. Provider-specific scores are local evidence — one dated
observation about one provider's model, kept under `engine/.coderadar/` and never committed — and
they are reported per model, without a ranking, a winner or a consensus score.

That path is verified end to end rather than merely wired: a real model has run through the whole
pipeline against the fixture and produced a scored row, with per-call telemetry for every attempt,
and its scrubbed recording replayed offline — no key, no network, a dead endpoint — to the same row:
same findings, state, limitations, candidate rejections and per-defect diagnosis. The only fields
that differ between a live run and its replay are the ones that cannot exist offline: the provider
host, the per-attempt transport telemetry, the reason an unanswered file has no answer
(`AttemptFailure` live, `ReplayMissError` offline), and whether the provider cut an answer off at the
output cap, which a replay can only report as unknown.

The per-defect chain, the context-coverage warning and the per-call telemetry are also pinned by
tests against a stub transport, including the answers a live run produces: a readable one, an empty
one, an unreadable body, an HTTP failure, a transport failure, and a cancellation.

The deterministic half *is* measured by the suite: it reports `0/9` planted defects on that fixture
with zero false positives on the negative controls. That is the only claim those numbers support —
the detectors report nothing on that fixture, and a model row stays `NOT RUN` until a key or a
recording exists.

## Security model

The local API is the only part of the app that listens on a socket, and it can read the user's source
tree and send it to a model provider. Four controls, each closing a specific hole:

1. It binds to `127.0.0.1` only.
2. Every data route requires a **per-launch token** that the main process generates and never writes
   to disk. A web page in the user's browser cannot read it.
3. The `Origin` header is checked against the app's own origins, and `Access-Control-Allow-Origin` is
   never a wildcard, so no other page can read a response.
4. The `Host` header must be loopback, which refuses DNS-rebinding requests.

Provider base URLs are validated before use: `https` unless the host is loopback, no embedded
credentials, and no private or link-local addresses.

## License

[Specify your license here]
