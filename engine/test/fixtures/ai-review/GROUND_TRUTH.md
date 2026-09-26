# AI review fixture — ground truth

This file is **deliberately outside** the reviewed scope (`repo/`). A review of
`repo/` that reports anything about this file, or about paths above `repo/`, has
escaped the selected scope.

Records what is actually wrong in `repo/`, and which code in `repo/` is correct
but written so that a naive detector or model may flag it anyway. Findings are
scored against this list; it was written before any review was run.

## Planted defects

The `anchor` column is the line range that shows the defect, 1-based and inclusive.
A finding is credited to a defect only when it names the defect's file **and** its
reported range overlaps this anchor. Naming the right file at the wrong line is not
a detection: crediting it would let a review score itself by knowing which files
are interesting rather than by finding anything in them.

The ranges are deliberately generous — they cover the statements that demonstrate
the defect, not only the single wrong token — so a reviewer that anchors to the
guard instead of the call does not lose credit for it. They were chosen by reading
the code, before any run was scored.

| id | file | anchor | defect | expected severity |
| -- | ---- | ------ | ------ | ----------------- |
| D1 | `src/orders-api.ts` | 12-25 | `GET /orders/:id` returns any order by id without comparing `order.device` to `request.session.deviceId` — missing authorization. The `DELETE` route on the same path does perform that check. | critical / high |
| D2 | `src/user-profile.ts` | 27-28 | `user.address.city` dereferences `address`, which the schema declares nullable. | high |
| D3 | `src/user-profile.ts` | 29 | `user.plan_code.replace(...)` dereferences `plan_code`, which the schema declares nullable. | high / medium |
| D4 | `src/session-store.ts` | 27-30 | `sessions.forEach(async ...)` never awaits the revocations, so `revokeAllForDevice` returns `0` and rejections become unhandled. | high |
| D5 | `src/report-query.ts` | 30-34 | `searchByDevice` concatenates `term` into SQL — SQL injection. | high / critical |
| D6 | `src/upload-handler.ts` | 28-30 | the `catch` responds `201` with a fabricated id, reporting a failed upload as a success; the order is never marked reconciled. | high |
| D7 | `src/cart.ts` | 15-17 | `applyQuantityCap` mutates the caller's array in place, which the module doc says callers rely on not happening. | medium / low |
| D8 | `src/retry-policy.ts` | 24-26 | `withRetry` returns `undefined as unknown as T` on the final failed attempt (line 25), while the module doc states the contract is that it returns the value or throws the last failure. Every caller is written against that contract, so a failure arrives as a silent `undefined` instead of an error. | high |
| D9 | `src/refunds.ts` | 30-32 | `refundOrder` guards with `amountCents <= order.totalCents` (line 32) instead of against the amount still refundable, which the module doc defines as the captured total minus everything already refunded. The amount already refunded is read on line 30 and then never used in the guard, so an order can be refunded past its captured total across instalments. | critical / high |

### How D8 and D9 were established

The first seven defects were written with the fixture. D8 and D9 were found in a
later pass, after live reviews surfaced those two files, so their provenance is
recorded here rather than assumed: both were confirmed by reading the code against
the contract stated in its own doc comment, not from a model's claim, and neither
depends on provider output to be true. A reviewer accepting them on a model's word
would be doing the opposite of what this fixture is for.

Any of these may legitimately be reported once. Reporting the same defect twice,
or at a line range that does not contain it, does not count as a second find.

## Expected-severity tolerance

Severity wording differs between providers and is not the thing under test. A
finding is scored on whether it identifies the right file and the right defect at
the right lines. Severity is recorded for information only.

## Correct code written to look suspicious (must not be reported)

These rows carry no anchor on purpose: the whole file is under suspicion, so a
finding on it is a false positive at any line. The only exception is a file that
also holds a planted defect — a finding there is scored against the defect first,
so naming the defect correctly is never counted as a leak.

| id | file | why it looks suspicious | why it is correct |
| -- | ---- | ----------------------- | ----------------- |
| C1 | `src/orders-api.ts` | `GET /orders` and `DELETE /orders/:id` both look up the order before acting, which reads like the D1 omission repeated. | Both compare against the authenticated device (`listForDevice`, `order.device !== request.session.deviceId`). |
| C2 | `src/notifications.ts` | `sendReceipt` catches a delivery failure and returns `false` instead of propagating; `recordOrderPlaced` catches and ignores. | Both are documented best-effort paths with the failure logged; no data or money depends on them. Returning a bool is the intended contract. |
| C3 | `src/notifications.ts` | `parsePreferences` swallows a `JSON.parse` failure and returns `{}`. | Returning an empty map for malformed stored JSON is the documented behaviour, and non-object JSON is rejected explicitly. |
| C4 | `src/notifications.ts` | `preferencesFor` builds a SQL string. | The statement is a constant with a bound `$1` parameter; nothing is concatenated. |
| C5 | `src/cart.ts` | `cartTotalCents` uses `reduce` over caller data. | Pure, reads only, returns a number. |
| C6 | `src/report-query.ts` | `dailyOrders` concatenates nothing but does take a `region` argument. | Fully parameterised (`$1`, `$2`, `$3`). |
| C7 | `src/db.ts`, `src/http.ts` | Declare interfaces only, no runtime code. | Nothing to find. |
| C8 | `src/upload-handler.ts` | Rejects oversized bodies with `413` before doing work. | An intentional guard, not a truncated-handling bug. |
| C9 | `src/session-store.ts` | `purgeExpired` deletes in a loop. | The loop is sequential with `await`; correct at this scale. |
| C10 | `src/retry-policy.ts` | `throw lastError;` after the retry loop (line 31) reads as unreachable, and a review reported it as such. | It is reachable: `maxAttempts < 1` skips the loop entirely and reaches the throw. The line is reported here because "unreachable" is the wrong claim, not because the code is wrong. |

## Negative controls in the `../clean` fixture

The controls above live in this fixture. The `../clean` fixture is the other half
of the same idea and is versioned with the engine: a review of it must produce no
finding at all. `engine/test/fixtures/clean/src/contracts.ts` holds constructs that
each invite a specific wrong comment:

| looks like | why it is correct |
| ---------- | ----------------- |
| In-place mutation of a caller's array (the same shape as D7) | The doc comment states the caller renders and paginates from that instance, so the mutation is the contract. |
| A missing inline permission check | Authorization is delegated to `assertSameDevice`, so no caller can forget it. |
| An unawaited async call | Fire-and-forget by contract: the batch is rebuilt nightly from the source of truth, and the rejection is handled in the call itself. |
| A retry loop with a backoff | Bounded to three attempts, each awaited, and the delay is capped so a slow provider cannot outlive the caller's timeout. |
| `<=` against a bound | The comparison is over an instant range, not a collection length, and `to` is the last instant of the window. |
| An index access that looks unsafe | The empty case is guarded on the line above, and it is reachable for a filtered list. |
| A nested ternary and a long line | It reads poorly. That is a preference, and the review bar does not report preferences. |

## Coverage inventory

Every file inside the reviewed scope, and whether this table covers it. A file in
the scope with no row here is a gap in the evaluation, not a clean file.

| file | reviewed | planted defect | expected negatives | covered here |
| ---- | -------- | -------------- | ------------------ | ------------ |
| `src/cart.ts` | yes | D7 | C5 | yes |
| `src/db.ts` | yes | none | C7 | yes |
| `src/http.ts` | yes | none | C7 | yes |
| `src/notifications.ts` | yes | none | C2, C3, C4 | yes |
| `src/orders-api.ts` | yes | D1 | C1 | yes |
| `src/refunds.ts` | yes | D9 | none | yes |
| `src/report-query.ts` | yes | D5 | C6 | yes |
| `src/retry-policy.ts` | yes | D8 | C10 | yes |
| `src/session-store.ts` | yes | D4 | C9 | yes |
| `src/upload-handler.ts` | yes | D6 | C8 | yes |
| `src/user-profile.ts` | yes | D2, D3 | none | yes |

## Out of scope

`GET /orders/:id` sends `order.device` and `order.items` to the caller, which is
a wider payload than the list route. Once D1 is fixed that is no longer a leak,
so it is not counted as a separate defect and not counted as a false positive if
raised alongside D1.
