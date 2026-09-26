/**
 * One review, run in the background for one session.
 *
 * The run is started by the route that created the session and is not awaited by
 * it: the renderer's progress screen is driven by the event stream, so waiting
 * here would leave the user on the picker until the review ended.
 *
 * The engine reviews one target at a time, so this waits for a free slot instead
 * of being refused. A session stopped while it waits — or while it runs — ends as
 * `cancelled`, which is a state of its own: a review the user stopped produced no
 * result, but nothing went wrong, and reporting it as `failed` would say something
 * did.
 *
 * Everything this run decides comes from policy or from the service — the
 * session record only carries state, so a change to how wide a review casts is
 * made in the policy, not here.
 */

import type { ReviewEventSink } from "../../core/ports.ts";
import { findingBudgetForPreset } from "../../core/review/policy.ts";
import type { ReviewService } from "../service.ts";
import type { ReviewQueue, ReviewTurn } from "./review-queue.ts";
import { messageOf } from "./security.ts";
import type { SessionRecord, SessionStore } from "./session-store.ts";

/** Records that the review was stopped, rather than that it failed. */
function markCancelled(record: SessionRecord): void {
  record.status = "cancelled";
  record.errorMessage = "The review was cancelled.";
  record.progressMessage = record.errorMessage;
  if (!record.progressLogs.includes(record.errorMessage)) record.progressLogs.push(record.errorMessage);
}

export async function runReview(
  service: ReviewService,
  store: SessionStore,
  record: SessionRecord,
  queue: ReviewQueue,
): Promise<void> {
  const onEvent: ReviewEventSink = (event) => store.applyEvent(record, event);
  const queuedAt = Date.now();
  let startedAt = queuedAt;
  let turn: ReviewTurn | null = null;

  try {
    turn = await queue.acquire(record.abort.signal);
    if (turn === null) {
      // Cancelled while it waited: it never started, and it says so rather than
      // looking like a review that ran and failed.
      markCancelled(record);
      return;
    }

    startedAt = Date.now();
    record.status = "scanning";
    record.currentPhase = "Discovery";
    record.progressMessage = "Starting the review";
    record.progressLogs.push(record.progressMessage);
    // The wait is over, and the sidebar says so before the first stage event.
    store.publish(record, false);

    const budget = findingBudgetForPreset(record.preset);
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
      record.abort.signal,
    );
    // The report carries its own state and limitations, so nothing about how
    // complete the review is has to be recomputed here.
    record.report = result.report;
    record.status = "completed";
  } catch (error) {
    // A cancellation surfaces as a thrown error from whichever stage noticed it,
    // so the signal is what tells the two apart: a stopped review is not a
    // review that broke.
    if (record.abort.signal.aborted) {
      markCancelled(record);
    } else {
      record.status = "failed";
      record.errorMessage = messageOf(error);
      record.progressMessage = record.errorMessage;
    }
  } finally {
    turn?.release();
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
