# ES-0002 — Broker Submission Inventory

Status: prepared as part of ES-0002 (Pending-Order Replacement Safety). Implementation complete; Product Owner review approved. Complete on `feature/pending-order-replacement-safety`, not yet merged into `main`.

Complete inventory of every repository call to `ttPost`, `ttPostComplex`, `ttValidateOrder`, and `ttDelete`, produced by a direct `grep -rn` across the repository (not limited to files this ticket touched), per the ES-0001 closeout review's recommendation that any future gate be trusted only after such an inventory exists.

## `app/portfolio/page.tsx`

| # | File:Function | Endpoint | Purpose | Category | Safety boundary | ES-0002 status | Rationale |
|---|---|---|---|---|---|---|---|
| 1 | `BatchConfirmModal.submitAll` (simple-close path) | `POST /accounts/{account}/orders` (dry-run: `ttValidateOrder`; live: `ttPost`) | Submit a live close order | Live submission (validation-only in dry-run mode) | `submitCloseOrderIfSafe` (ES-0001) | Guarded | Unchanged by ES-0002; re-confirmed still passing (65/65 ES-0001 tests). |
| 2 | `BatchConfirmModal.submitAll` (OTOCO-roll path) | `POST /accounts/{account}/complex-orders` (dry-run: `ttValidateOrder`; live: `ttPostComplex`) | Submit a live roll (close + new open, atomic OTOCO) | Live submission | `submitCloseOrderIfSafe`, reusing the closing leg's gate input | Guarded | Unchanged by ES-0002. |
| 3 | `SetStopLossButton.submit` (OCO placement) | `POST /accounts/{account}/complex-orders` | Place a live OCO profit/stop bracket | Live submission | `submitCloseOrderIfSafe` | Guarded | Unchanged by ES-0002. |
| 4 | `SetStopLossButton.submit` (existing GTC cancel) | `DELETE /accounts/{account}/complex-orders/{id}` or `/orders/{id}` | Cancel the old GTC/stop order before placing a new OCO | Cancellation-only | None (cancellation does not require economic validation) | Cancellation-only | Out of scope for both ES-0001 and ES-0002 — cancelling never resubmits economics. |
| 5 | `SetStopLossButton.submit` (emergency-restore fallback) | `POST /accounts/{account}/orders` | Restore a fallback stop if OCO placement fails after the old GTC was already cancelled | Recovery submission | `submitCloseOrderIfSafe`, same gate input as #3 | Guarded | Unchanged by ES-0002. |
| 6 | `SetStopLossButton.submit` (plain stop path) | `POST /accounts/{account}/orders` | Place a live plain stop (non-OCO case) | Live submission | `submitCloseOrderIfSafe` | Guarded | Unchanged by ES-0002. |
| 7 | `cancelPendingOrder` | `DELETE /accounts/{account}/complex-orders/{id}` | Cancel a pending entry order, no resubmission | Cancellation-only | None | Cancellation-only | Never resubmits economics — matches the ES-0001 closeout review's own example of a plausibly-fine-as-is cancellation-only call. |
| 8 | `replacePendingOrder` (cancel) | `DELETE /accounts/{account}/complex-orders/{id}` | Cancel the existing pending order before replacing it | Cancellation-only | Pre-cancel deterministic guard (`buildPendingOrderReplacementPlan`) runs first; the delete itself is not economically validated | Cancellation-only, now preceded by a validation gate | **This ticket (TD-1).** Was entirely unguarded before ES-0002; a known-invalid `newPrice` now blocks before this call is ever reached. |
| 9 | `replacePendingOrder` (replacement submit) | `POST /accounts/{account}/orders` | Resubmit the pending order's legs at the operator's new price | **Live submission — replacing economic exposure** | `submitPendingOrderReplacementIfSafe` (ES-0002, new) | **Guarded (this ticket)** | Was entirely unguarded before ES-0002 — the sole primary objective of this sprint. |
| 10 | `replacePendingOrder` (restore-on-failure) | `POST /accounts/{account}/orders` | Re-place the original order if the replacement failed after cancellation | **Live submission — restoring a cancelled order** | `submitPendingOrderRestoreIfSafe` (ES-0002, new) | **Guarded (this ticket)** | Was entirely unguarded before ES-0002, and previously could silently substitute the failed replacement's price for a missing original price — now hard-blocks instead (`RESTORE_PRICE_UNAVAILABLE`). |

## `app/rinse-repeat/page.tsx`

| # | File:Function | Endpoint | Purpose | Category | Safety boundary | ES-0002 status | Rationale |
|---|---|---|---|---|---|---|---|
| 11 | `submit` (Hunter/rinse-repeat entry) | `POST /accounts/{account}/complex-orders` (`ttPostComplex`) | Submit a live OTOCO entry + profit/stop bracket for a newly-identified opportunity | **Live submission — submitting new economic exposure** | Inline pre-flight validation only (positive credit/GTC/stop prices, GTC < credit, quantity > 0) — does **not** route through `closeOrderSafety`/`closeOrderSubmission` or the new ES-0002 modules | **Intentionally deferred — flagged, not fixed** | **A second unguarded live-order submission path**, found during this ticket's mandatory repository-wide inventory. It is a completely different feature (the standalone "Hunter"/rinse-repeat opportunity screener, a different page and a different order shape — a brand-new OPENING order, not a pending-order reprice) and is not inseparable from closing TD-1. Per the sprint's explicit instruction ("if another unguarded live-order submission path is found, do not silently expand scope; document it and stop for Product Owner direction"), this is surfaced here for a scoping decision, not fixed in ES-0002. |

## Summary

- **10 of 11** live/cancellation call sites across the repository are now guarded or are legitimately cancellation-only.
- **Item 9 and 10** are the two call sites this ticket exists to close (TD-1) — both now route through a dedicated, hard-blocking, broker-mock-tested boundary.
- **Item 11** is a newly-discovered, out-of-scope live submission path in an unrelated feature (`app/rinse-repeat/page.tsx`). It is **not fixed by this ticket** and is flagged here for an explicit Product Owner scoping decision (candidate: a future ES-0003, or folded into whatever ticket next touches that page) rather than silently expanded into ES-0002's scope.

No other `ttPost`/`ttPostComplex`/`ttValidateOrder`/`ttDelete` call sites exist in the repository outside of `app/portfolio/page.tsx` and `app/rinse-repeat/page.tsx` (confirmed by a repository-wide `grep -rn` across `*.ts*`, re-run at the time of this report).
