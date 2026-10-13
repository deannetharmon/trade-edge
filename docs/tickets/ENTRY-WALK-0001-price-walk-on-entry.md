# ENTRY-WALK-0001 — Walk the price on entry (start near the ask, step toward the mid)

**Status:** Built (2026-10-13) after all gates: Paul (scope), Diane (mock), Alan (fixtures), Quinn (test plan), Ian (final sign-off). Off by default. Needs one real one-contract walk by Dean after merge.
**Requested by:** Dean (2026-10-13).

## Problem

Entries today are sent at the executable price. In the Screener the validated credit is the bid (`refreshExecutionQuote`: `executableCredit = quote.bid`). For a credit entry the bid is the worst price available, so every fill leaves part of the spread on the table. Multi-leg orders often fill near the mid anyway, but on wide or thin chains the difference is real.

## User value

The trader gets a better entry price without watching the order: it starts near the ask, steps toward the mid, and stops there. Expected gain is a few cents per share (roughly $5-$20 per one-contract spread), larger on wide markets.

## Scope (v1)

1. **Entries only.** Credit entries (BPS, BCS, IC, CSP) walk from near the ask down toward the mid. Debit entries mirror it: start near the bid, walk up toward the mid. Closes, rolls, GTC targets and stops are out of scope.
2. **Opt-in per order.** A "Walk the price" checkbox in the existing entry dialog, off by default until the trader has seen it work.
3. **Locked numbers (Ian):**
   - Start at 75% of the way from the mid to the ask (credit) or to the bid (debit), never beyond the ask/bid.
   - Five steps, one every 3.5 seconds (about 15-20 seconds in total).
   - Floor = the higher of the mid and the scan's minimum credit rule (1/3 of width for spreads). Alan's fixtures govern: a minimum credit above the mid raises the floor (the walk still runs from the start down to it); the walk does not start only when the floor is at or above the start. v1 dialog passes no minimum credit (the dialog does not know the active preset's ratio), so the floor is the mid; this is never worse than today's bid placement.
   - Lands on the mid and leaves the order working as a normal pending order (managed from the existing pending-order surfaces).
   - If any leg's bid-ask is wider than the scan's own limit (`BID_ASK_MAX`, $0.10 per leg under the course rules; evaluated per leg, as the scan does), the walk does not start.
4. **Each step:** re-fetch the quote, recompute the mid, round to the tick (`lib/portfolio/tickSize.ts`), then replace the order. The step is skipped (walk stops) if the quote is stale, crossed, or the market moved enough that the floor is no longer valid.
5. **Progress strip** after submit: current price, floor, step n/5, Cancel (always visible, works at any step). Wording and layout per Diane's mock.

## Key technical finding (Dane)

The Screener entry is an **OTOCO** (entry plus profit-target and stop, `/complex-orders`), not a simple limit order. A complex order's price cannot be edited in place, so each step is **cancel then resubmit the whole OTOCO** at the new price. The existing pending-order replacement workflow (`lib/portfolio/pendingOrderReplacementSubmission.ts`) and the order-lifecycle log are the reuse points. This makes the race window the main risk (below).

## Bracket and safety conditions (Ian, 2026-10-13)

1. **The profit target and stop follow each step's price.** The Screener sets `exitCredit = entryLimit`, `gtcBuyback = round(credit x (1 - gtcPct/100), 2)`, `stopTrigger = round(credit x stopMultiple, 2)`, `stopLimit = round(stopTrigger x 1.10, 2)`. Every resubmit recomputes all three from that step's price; the first step's bracket is never carried forward.
2. **The existing "market moved" check is adjusted.** `refreshExecutionQuote` throws when the executable credit (the bid) differs from the validated credit by a cent, and rejects quotes older than 15 seconds. The walk sits above the bid on purpose, so with the checkbox on the check compares against the walk's own price and floor. With the checkbox off it is unchanged (regression test). A quote older than 15 seconds still stops the walk.
3. Each step keeps the original time-in-force and runs the same dry-run and CSP collateral check as the original order.

## Fixtures (Alan, 2026-10-13)

Rules: work in integer cents (exact fractions, no float division); `start = mid + 0.75 x (ask - mid)` for credit, `mid - 0.75 x (mid - bid)` for debit; prices are evenly spaced from start to the end price over 5 steps; the end price is the floor (credit) or the ceiling (debit); each price is rounded to the tick for its band; **a price exactly halfway between two ticks rounds toward the mid**; consecutive duplicate prices are dropped (no waiting on the same price); if start is at or beyond the end price the walk does not start. Credit end = max(mid, minimum credit); debit end = min(mid, the trader's maximum debit).

| Case | Market | Tick | Expected prices |
|---|---|---|---|
| Credit, 2-leg (the mock sample) | bid 1.20, ask 1.40 | 0.01 | 1.37, 1.36, 1.34, 1.32, 1.30 |
| Credit, 4-leg condor | bid 2.10, ask 2.50 | 0.01 | 2.45, 2.41, 2.37, 2.34, 2.30 |
| CSP (single leg) | bid 0.85, ask 1.05 | 0.01 | 1.02, 1.01, 0.99, 0.97, 0.95 |
| Coarse tick (0.05 at or above 3.00) | bid 3.30, ask 3.70 | 0.01 / 0.05 | 3.65, 3.60, 3.55, 3.50 (4 prices, one duplicate dropped) |
| Minimum-credit floor above mid | bid 0.85, ask 1.10, minimum credit 1.00 | 0.01 | 1.07, 1.05, 1.03, 1.02, 1.00 |
| Floor at or above start | bid 0.85, ask 1.00, minimum credit 1.00 | 0.01 | does not start |
| Debit, 2-leg | bid 2.00, ask 2.40 | 0.01 | 2.05, 2.09, 2.13, 2.16, 2.20 |
| Very tight market | bid 1.28, ask 1.32 | 0.01 | 1.31, 1.30 (two prices) |

Bracket fixtures for the first case (50% target, 2x stop): price 1.37 gives target 0.69, stop 2.74, stop limit 3.01; 1.36 gives 0.68 / 2.72 / 2.99; 1.34 gives 0.67 / 2.68 / 2.95; 1.32 gives 0.66 / 2.64 / 2.90; 1.30 gives 0.65 / 2.60 / 2.86.

Expected benefit, stated plainly: with course-rule legs (each at most $0.10 wide) a 2-leg spread is at most about $0.20 wide, so the best case is about $0.17 per share over the bid at the first step, about $0.10 at the mid ($10 per contract). Wider markets (Relaxed / Low Vol presets) gain more.

## Race safety (Quinn and Ian)

- Before every cancel, read the order status. If it is filled or partially filled, stop the walk and show the fill. Never resubmit.
- A cancel rejected because the order already filled counts as success, never as a retry.
- Never have two live entry orders for the same trade: resubmit only after the cancel is confirmed.
- Partial fill: stop the walk, leave the remainder as it is, and tell the trader.
- Closing or reloading the page stops the walk. The order that is live at that moment stays at its last price as a normal pending order and shows in the pending-order list. (TastyTrade is browser-side only, so there is no server-side walker.)
- An expired token (about 15 minutes) stops the walk; a 15-20 second walk should never reach it, but the check is explicit.
- Every step is a full resubmit, so each goes through the same broker dry-run and entry safety checks as the original (no weaker path).

## Acceptance criteria

1. With the checkbox off, behavior is unchanged (regression test).
2. Credit and debit walks produce the exact tick-aligned price sequence in Alan's fixtures (2-leg, 4-leg, CSP, wide market, stale/crossed quote).
3. The walk never goes below the floor (credit) or above the ceiling (debit), and never starts when the floor cannot be met or the market is too wide.
4. Fill at any step stops the walk without resubmitting; cancel mid-walk leaves no live order.
5. Tests use fake timers for the 3.5-second steps; cover cancel mid-walk, partial fill, page unload and token expiry.
6. Progress strip is keyboard-accessible, announces step changes in a polite live region, Cancel is at least 44 px, and the layout works at phone width.
7. Each fill is logged with the price versus the mid at order time, so after about 20 fills we can judge whether to keep or tune it.
8. tsc (`tsconfig.check.json`), targeted tests and CI green; Vercel preview Ready before merge.

## Non-goals

No settings page; no per-strategy tuning; no server-side walking; no closes or stops; no changes to scan eligibility or ranking.

## Open items

- Diane: mock (desktop and phone) for the checkbox, progress strip, and the stopped / filled / cancelled / failed-closed states.
- Alan: fixtures and tick/rounding spec.
- Quinn: test plan against the race list above.
- Ian: final sign-off after the mock and fixtures.

## Test plan (Quinn, 2026-10-13)

Pure functions in `lib/entry-walk/` with a fake broker and fake clock:

1. Alan's 8 fixtures give exactly the listed prices; duplicates dropped; never below the floor or above the ceiling.
2. Does not start: a leg wider than $0.10, floor at or above start, missing or crossed quote.
3. Fill before cancel: no cancel, ends Filled. Fill as the cancel goes out is a fill, never a retry.
4. Partial fill: stops, no resubmit, reports counts.
5. Failed cancel: stops, no resubmit. Refused resubmit: stops, says nothing is live.
6. Never more than one live entry order (checked on every run).
7. Cancel mid-walk leaves nothing live; Cancel during cancel-and-resubmit creates no new order.
8. Page unload leaves the live order and sends nothing more. 401 stops with no resubmit. Stale quote (over 15 s, missing, crossed, error) stops.
9. Bracket recomputed per step (Alan's bracket fixtures); each step builds its own OTOCO.
10. Off by default; the off path is unchanged (the diff touches only a defaulted parameter, plan overrides on the pending-entry records, and Close/Cancel disabled while a walk runs).

## Build notes (Dane)

- Engine: `lib/entry-walk/` (`ladder.ts`, `walk.ts`, `broker.ts`, `browserDeps.ts`, `bracket.ts`, `fillLog.ts`); UI: `components/EntryWalk.tsx`; wired into the credit-spread dialog (BPS, BCS, IC) and the CSP dialog. PMCC (debit) is not wired in v1; the ladder supports debit.
- After a cancel the broker can briefly report the order as still live, so the status is read up to 4 times (400 ms apart) before anything is resubmitted. These are reads, not retries.
- The pending-entry records and the CSP Trade Log note are re-saved for each new order id, with that step's profit target and stop.
- The broker status mapping (`parseComplexOrderStatus`) is written from the documented order shape and is not yet checked against a live response. Dean's first real one-contract walk is the check; anything unrecognised stops the walk without touching the order.
- Each step is a fresh POST, so the broker's own validation runs on every step; no separate per-step dry run (it would widen the gap with no live order).
- Fills are logged in browser storage (`tradeedge.entryWalk.fills`): price versus bid and mid at order time.
