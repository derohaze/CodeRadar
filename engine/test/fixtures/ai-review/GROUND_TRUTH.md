# AI review fixture — ground truth

This file is **deliberately outside** the reviewed scope (`repo/`). A review of
`repo/` that reports anything about this file, or about paths above `repo/`, has
escaped the selected scope.

Records what is actually wrong in `repo/`, and which code in `repo/` is correct
but written so that a naive detector or model may flag it anyway. Findings are
scored against this list; it was written before any review was run.

## Planted defects

| id | file | defect | expected severity |
| -- | ---- | ------ | ----------------- |
| D1 | `src/orders-api.ts` | `GET /orders/:id` returns any order by id without comparing `order.device` to `request.session.deviceId` — missing authorization. The `DELETE` route on the same path does perform that check. | critical / high |
| D2 | `src/user-profile.ts` | `user.address.city` dereferences `address`, which the schema declares nullable. | high |
| D3 | `src/user-profile.ts` | `user.plan_code.replace(...)` dereferences `plan_code`, which the schema declares nullable. | high / medium |
| D4 | `src/session-store.ts` | `sessions.forEach(async ...)` never awaits the revocations, so `revokeAllForDevice` returns `0` and rejections become unhandled. | high |
| D5 | `src/report-query.ts` | `searchByDevice` concatenates `term` into SQL — SQL injection. | high / critical |
| D6 | `src/upload-handler.ts` | the `catch` responds `201` with a fabricated id, reporting a failed upload as a success; the order is never marked reconciled. | high |
| D7 | `src/cart.ts` | `applyQuantityCap` mutates the caller's array in place, which the module doc says callers rely on not happening. | medium / low |

Any of these may legitimately be reported once. Reporting the same defect twice,
or at a line range that does not contain it, does not count as a second find.

## Expected-severity tolerance

Severity wording differs between providers and is not the thing under test. A
finding is scored on whether it identifies the right file and the right defect at
the right lines. Severity is recorded for information only.

## Correct code written to look suspicious (must not be reported)

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

## Out of scope

`GET /orders/:id` sends `order.device` and `order.items` to the caller, which is
a wider payload than the list route. Once D1 is fixed that is no longer a leak,
so it is not counted as a separate defect and not counted as a false positive if
raised alongside D1.
