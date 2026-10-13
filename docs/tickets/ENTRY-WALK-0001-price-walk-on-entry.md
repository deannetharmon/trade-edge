# ENTRY-WALK-0001 — Walk the price on entry (start near the ask, step toward the mid)

**Status:** Draft — scope approved by Paul; direction and numbers locked by Ian (2026-10-13). **Blocked on:** Diane's mock, Alan's fixtures, Quinn's test plan (no code before these).
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
   - Floor = the higher of the mid and the scan's minimum credit rule (1/3 of width for spreads). If the minimum credit is above the mid, the walk does not start.
   - Lands on the mid and leaves the order working as a normal pending order (managed from the existing pending-order surfaces).
   - A bid-ask wider than the scan's own limit ($0.10 under the course rules) does not start the walk.
4. **Each step:** re-fetch the quote, recompute the mid, round to the tick (`lib/portfolio/tickSize.ts`), then replace the order. The step is skipped (walk stops) if the quote is stale, crossed, or the market moved enough that the floor is no longer valid.
5. **Progress strip** after submit: current price, floor, step n/5, Cancel (always visible, works at any step). Wording and layout per Diane's mock.

## Key technical finding (Dane)

The Screener entry is an **OTOCO** (entry plus profit-target and stop, `/complex-orders`), not a simple limit order. A complex order's price cannot be edited in place, so each step is **cancel then resubmit the whole OTOCO** at the new price. The existing pending-order replacement workflow (`lib/portfolio/pendingOrderReplacementSubmission.ts`) and the order-lifecycle log are the reuse points. This makes the race window the main risk (below).

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
