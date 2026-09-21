# STOCKS-0001 — "Stock holdings" section on Position Analysis

**Status:** Approved by Dean 2026-09-20 ("go for Dane with the tweaks"); implemented — see the [implementation report](../implementation/STOCKS-0001-implementation-report.md)
**Design:** Diane's board 5, revision 2. **Policy:** Ian's six changes and three tweaks (below). **Raised by:** Dean, asking why META (in the Portfolio view) was not in Position Analysis.

## Problem

Position Analysis is fed only by option positions, so stock holdings (META, SNDK) had no row: no notes, no price alert, no covered-call capacity, and their P/L was missing from the table's numbers (the reason the two views did not add up).

## Scope

1. **A separate "Stock holdings" section under the options table** (stocks have no strikes, DTE or greeks, so it has its own columns rather than blank option columns): Holding, Shares, Price, Value, Avg cost, Unrealized P/L, Covered calls, Notes, Price alert; a totals row; short notes underneath.
2. `model/stockHoldings.ts` (pure) reads only what the workspace model already holds (`EquityHolding` and the symbol's `CapacityViewModel`):
   - **Incomplete basis** (several lots): no average cost, no cost, no P/L, no percent; the value stays; a note says why. A broker-reported P/L is still hidden (never a partial-lot average).
   - **Short stock:** negative shares labelled "Short 100 shares", value and P/L signed as the model reports them, covered calls "Not applicable to short stock".
   - **Covered calls come from the capacity model**, not recomputed: "Needs 95 more shares / 0 of 1 contract available" (gray, not amber — under 100 shares is not a problem), "2 of 3 contracts available" with what is committed to short calls or pending orders, "All 3 contracts committed", or "Unavailable" with the model's own reason (amber).
   - **Totals:** cost and a percentage only when every holding has a complete basis; otherwise the P/L is shown for the holdings that have one with "P/L covers 2 of 3 holdings · no percent" (Ian tweak 2), and the value column is titled **"Net value"** whenever a short is included.
   - **Price time (Ian tweak 3):** "Prices refreshed 10:45 PM · market closed", using the OLDEST refresh time (the holding carries the time the app refreshed positions, not the quote's own timestamp; after hours the price is the broker's last mark); not from today it adds the weekday ("Prices refreshed Fri 4:00 PM"); stale-flagged prices are counted in a note.
3. **Notes and price alerts** use the existing stores and the same save path as the option rows, under their own key format `equity:SYMBOL:long|short` so they cannot collide with an option position's key. The alert check is the same rule the option rows use ("Target reached" when the price crosses), and it works for a stock key: the store accepts any key and the check is a comparison with the displayed price; nothing else consumes alerts (verified in code; Ian's condition).
4. **Safe actions only (no order is placed from this section):** "Sell covered call" (the link the Portfolio view already has, enabled only when the capacity model shows a contract available; otherwise disabled with the reason) and a "Target reached: consider selling" prompt when a price alert is crossed.
5. The options table's counter now reads "N of N **option** positions", and the reconciliation line above it points to the section ("Stock holdings below: +$1,008").

## Non-goals

- **No stock orders.** Selling shares, taking profit and buying to cover are a separate, reviewed order ticket ([STOCKS-ORDERS-0001](./STOCKS-ORDERS-0001-stock-order-actions.md)).
- No suggested action or recommendation for stocks (the engine covers options only); day change, share of portfolio and next earnings are not shown yet.

## Acceptance criteria

1. Rows, totals, covered-call cells, the price-time label (same day, earlier day with weekday, market open / closed, oldest price, stale count, fallback, unknown), keys, and the alert rule are unit-tested using Dean's own holdings (META 5 shares at $549, SNDK 2 at $1,592) and the mock's example states (300 shares with a short call open, several lots, short stock).
2. The option notes and alerts keep working through the shared save path (existing tests unchanged).
3. Existing portfolio tests pass; the only edits are the two expectations that read "N of N positions" (now "option positions").

## Rollout notes

No flag or environment variable. Rollback is a revert.
