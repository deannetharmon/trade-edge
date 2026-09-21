# LEAPS-SPARK-0001 — History strip (value, delta, stock) on held LEAPS

**Status:** Approved by Dean 2026-09-20 ("go"); implemented — see the [implementation report](../implementation/LEAPS-SPARK-0001-implementation-report.md)
**Follows:** LEAPS-SINCE-0001, LEAPS-ENTRY-0001, LEAPS-CYCLES-0001

## Problem

The Positions cards showed where a LEAPS is now and how it compares with its baseline, but not the path in between. The daily position history the app already records (one row per position per day, filled each time you open Portfolio) was never shown on the LEAPS cards.

## Scope

1. **Data:** the existing daily snapshot history already attached to each `Position` (`snapshotHistory`). No new capture, storage, endpoint or fetch. The model now passes the newest 120 days of `date`, `currentValue`, `netDelta` and `stockPrice` with the held LEAPS.
2. `lib/leaps-position-intelligence/sparklines.ts` (pure): cleans the history (one row per date, the last recorded wins; oldest first; newest 90 days charted), builds three series, and computes the line geometry.
   - **Value:** the position's value, taken as an absolute amount so a sign convention in the store cannot flip the chart.
   - **Delta:** the store keeps net delta (per-share delta × contracts), so it is divided by the contract count to give per-share delta (the same unit as the rest of the card). Left out when the contract count is 0.
   - **Stock:** the underlying price (zero or negative prices are not charted).
   - Each shows the latest value, the change with an arrow (▲/▼), and a colour for what the move means for a long call: up = green, down = amber, under the same flat thresholds as the Since tiles (stock and value 0.05%, delta 0.005) = neutral "unchanged".
3. `HistoryStrip` (presentational): three small lines with an end dot, an accessible description of each line, and the recorded date range. x follows the calendar (a gap in the record shows as a gap); y runs from each series' lowest to highest value.
4. **Honest empty state:** fewer than two recorded days shows "History fills in as the app records this position each day you open Portfolio (N days recorded so far)". A series with fewer than two usable points is left out; the others stay.
5. Shown on both Positions cards (income and open-cycle) under the Since tiles.

## Non-goals

- No back-filling of days the app was not open. History starts when the app first recorded the position and grows from there.
- No intraday data, IV or extrinsic lines (extrinsic needs the option's own price history, which the store does not keep).

## Acceptance criteria

1. Cleaning (duplicates, order, cap), each series' values and units, colours and change text, the flat thresholds, sign handling, missing data, fewer than two days, zero contracts, non-positive prices, and the SVG geometry (bottom / top / padding / calendar spacing / flat / too few points) are unit-tested.
2. The model carries the newest 120 days and only the four fields (a test that fails without the builder change).
3. Existing Positions behavior and tests are unchanged.

## Rollout notes

No flag or environment variable. Rollback is a revert.
