# LEAPS-CYCLES-0001 — Income history per held LEAPS (short calls since you opened it)

**Status:** Approved by Dean 2026-09-20 ("go"); implemented — see the [implementation report](../implementation/LEAPS-CYCLES-0001-implementation-report.md)
**Follows:** LEAPS-SINCE-0001, LEAPS-ENTRY-0001

## Problem

The Positions cards showed only the current cycle. There was no record, on the LEAPS itself, of the short calls sold against it, how each ended, or whether the income has covered what the LEAPS has lost in time value.

## Scope

1. **Data:** the Trade Log's existing reconstruction of your broker transactions (`lib/tradeLog`, last 12 months). Nothing new is stored, and it works for LEAPS you already hold. It is fetched **only when you click "Show income history"**, once for all cards (kept in memory for 10 minutes; concurrent cards share one fetch; failures are not cached).
2. `lib/leaps-position-intelligence/cycleHistory.ts` (pure): a closed trade counts as a cycle when it is a **single short call on the same stock, opened on or after the LEAPS's broker open date**, and not excluded in the Trade Log. Each row: opened → closed, strike and expiry, contracts, credit, cost to close, net P/L (fees included), days held, and how it ended (Expired, Assigned, Closed, Partly closed, or **Rolled** when a new short call was opened the same day it closed).
3. **Totals:** number of short calls (and how many were profitable), income to date net of fees, average days held.
4. **Income vs extrinsic lost** (Ian): when the LEAPS has a true at-open record, a callout compares income to date with the extrinsic value the LEAPS has lost since it opened ("covers … ahead" green, "short of …" amber). Otherwise it says the comparison needs an at-open record.
5. **What it says it cannot see:** the Trade Log looks back 12 months (a note appears if the LEAPS is older); closings whose opening fell before the window are counted and flagged as possible under-statement; the Trade Log covers the active account only (another account's LEAPS shows a plain message); covered calls sold on shares of the same stock are included, and the view says so.
6. `sinceOpen` also returns the extrinsic lost per share, so the comparison uses the same number as the "Extrinsic" tile.

## Non-goals

- No matching of a specific short call to a specific LEAPS when several LEAPS exist on the same stock (all short calls on the stock since the earliest applicable open are shown for each).
- No history before the 12-month Trade Log window; no charts; no decision events.

## Acceptance criteria

1. Which trades count (strategy, stock, open date boundary, excluded, case and spacing), row fields and contract count, every result type and the roll rule, sorting, totals (net of fees, no floating-point drift), the window / unmatched notes, missing open date (no guessing), and purity are unit-tested.
2. The loader is tested for one shared fetch, the 10-minute reuse boundary, failures not cached, null account when there are no transactions.
3. Extrinsic lost per share is tested (at-open, grew, first-tracked, inconsistent data).
4. Existing Positions behavior and tests are unchanged.

## Rollout notes

No flag, storage or environment variable. Rollback is a revert.
