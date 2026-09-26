# ADR 0001 — The model is a replaceable reasoning layer

Status: accepted
Date: 2026-09-25
Context: the review engine's output quality varies by provider, and there was no
way to tell a model's failure apart from a review's.

## Decision

CodeRadar's authority is the code. A model proposes; the system decides. Every
provider is interchangeable behind one protocol, and nothing downstream of the
provider may depend on which one answered.

Concretely, these are fixed and shared by every model:

- the review protocol in `engine/prompts/shared_code_review_bar.md`
- context construction (`engine/src/core/repository/context.ts`, `prompt.ts`)
- target selection and the review budget (`repository/select.ts`, `review/engine.ts`)
- the parser and its trust boundary (`review/ai-reviewer.ts`)
- the evidence gate and validator (`findings/validate.ts`)
- dedupe and the confidence policy (`findings/dedupe.ts`, `findings/policy.ts`)
- the report contract (`findings/model.ts`)
- the ground truth and the scorer (`test/fixtures/ai-review`, `src/eval/ground-truth.ts`)

Only the endpoint, the key and the model id change, and they arrive through
`createHttpAiReviewer`. No provider-specific branch exists inside the core.

## Why

Three failure modes motivated this:

1. **A broken model call looked like clean code.** A response that could not be
   read produced no candidates, and a run with no candidates produced a report
   that read exactly like a run that found nothing wrong. The two need opposite
   responses, and a findings count cannot tell them apart.
2. **A model's claim could be credited from the wrong place.** Ground truth that
   accepted any finding on a defect's *file* let a review score itself by knowing
   which files are interesting rather than by finding anything in them.
3. **Quality could not be compared across providers.** Without a common pipeline
   and a common score, a model change was an act of faith.

## Consequences

- Model quality is measured, never asserted. `bun run benchmark` produces
  precision and recall per model against one fixture, through one pipeline.
- A model that cannot prove a claim scores as a miss. The evidence gate is not
  relaxed to improve a number — see the "Definition of done" in this repository's
  review of the milestone.
- Every report carries its own `state` and `limitations`, so an incomplete review
  is visible as such instead of as a clean one.
- Agreement between models is a diagnostic signal only. There is deliberately no
  consensus column and no consensus logic: three models repeating one claim is
  three models making one unproven claim.
- Recordings (`engine/src/core/replay/replay.ts`) let a live run be replayed
  offline, so a parser, validator or scoring change can be checked against real
  model answers without a provider.

## Alternatives considered

- **Provider-specific prompts or parsers.** Rejected: it makes quality
  incomparable and turns the pipeline into a fork per vendor.
- **Trusting a model's own severity and confidence.** Rejected: severity is
  earned by confidence in `policy.ts`, and the model's numbers are inputs, not
  verdicts.
- **Accepting a finding when several models agree.** Rejected: consensus is not
  evidence about code, and it would move the authority from the source to the
  providers.
- **Collapsing a limitation into a low-severity finding.** Rejected: a limitation
  is a statement about the review, and dressing it as a finding presents coverage
  as a defect.
