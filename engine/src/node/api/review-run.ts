/**
 * One review, run in the background for one session.
 *
 * The run is started by the route that created the session and is not awaited by
 * it: the renderer's progress screen is driven by the event stream, so waiting
 * here would leave the user on the picker until the review ended.
 *
 * Everything this run decides comes from policy or from the service — the
 * session record only carries state, so a change to how wide a review casts is
 * made in the policy, not here.
 */

import type { ReviewEventSink } from "../../core/ports.ts";
import { findingBudgetForPreset } from "../../core/review/policy.ts";
import type { ReviewService } from "../service.ts";
import { messageOf } from "./security.ts";
import type { SessionRecord, SessionStore } from "./session-store.ts";

export async function runReview(service: ReviewService, store: SessionStore, record: SessionRecord): Promise<void> {
  const startedAt = Date.now();
  const onEvent: ReviewEventSink = (event) => store.applyEvent(record, event);

  const budget = findingBudgetForPreset(record.preset);

  try {
    const result = await service.startReview(
      {
        target: record.sourcePath,
        // "Fast review" reviews only what changed against the base branch;
        // "Deep review" reviews the whole selected scope. Outside a git
        // repository the engine finds no diff and reviews everything, so the
        // fast setting cannot silently review nothing.
        changedOnly: record.scanMode === "fast",
        ...(budget === null ? {} : { maxFindings: budget }),
      },
      onEvent,
    );
    // The report carries its own state and limitations, so nothing about how
    // complete the review is has to be recomputed here.
    record.report = result.report;
    record.status = "completed";
  } catch (error) {
    record.status = "failed";
    record.errorMessage = messageOf(error);
    record.progressMessage = record.errorMessage;
  } finally {
    record.elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    record.completedAt = new Date().toISOString();

    if (record.status === "completed") {
      // The terminal event carries the finished state, so the bar and the
      // phase agree with the report that is about to be returned.
      record.progress = 100;
      record.phaseProgress = 100;
      record.currentPhase = "Completed";
      record.progressMessage =
        record.report !== null && record.report.findings.length === 0
          ? "No issues found in the reviewed scope"
          : `Review finished with ${record.report?.findings.length ?? 0} finding(s)`;
    }

    store.publish(record, true);
  }
}
