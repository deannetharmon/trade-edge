# PORTFOLIO-SUMMARY-0001 — P/L summary by position type on Positions and Position Analysis

## Status

**APPROVED 2026-10-05 (Dean, Ian, Diane, Paul, Quinn) — queued after TAKEPROFIT-BASIS-0001.** Display only: no recommendation, scoring or order change. Ian and Diane shaped it (below).

Mock (interactive): https://claude.ai/artifact/GaxxUqLfRSa4zABBsXGmvv

## Problem (Dean, 2026-10-05)

"Anytime I go to my positions I'd love to see a summary at the top: profit and loss by position type, so I don't have to scroll down. I'm going to have a lot more positions." Today the Portfolio page shows P/L per symbol row only (the old `SummaryBar` in `app/portfolio/page.tsx` is defined but not rendered); Position Analysis has a strategy filter and a P/L reconciliation line but no per-type totals.

## Where

One shared component, the same strip at the top of:
- **Portfolio → Positions**, above the symbol rows.
- **Position Analysis**, above the table.

It always summarizes the **whole portfolio**, regardless of any filter. Clicking a tile sets the existing strategy filter (`lib/portfolio/positionStrategyFilter.ts`); the selected tile is outlined; "Show all" clears it.

## Tiles

**Groups** (Ian: by risk profile, not just option type; a group appears only when held):

| Tile | Contains | Return basis |
|---|---|---|
| Total | everything | — |
| Short puts | CSP, naked short puts | % of credit kept |
| Short calls | covered calls, naked short calls | % of credit kept |
| Credit spreads | BPS, BCS, IC | % of credit kept |
| LEAPS | long options the existing LEAP classification marks as LEAP | % of cost |
| Long options | other long calls/puts | % of cost |
| PMCC | diagonal pairs | % of cost |
| Equity | stock holdings | % of cost |

Group membership comes from the existing classification (`classifyPositionLifecycle` / strategy filter keys), never a second rule, so a tile always matches its filter chip.

**Each group tile:**
1. **Unrealized P/L** (headline, green/red): mid basis, the same as the rows, so tiles add up to the list.
2. `N · ±X% of credit|cost`.
3. `Capital $X · Y% · θ ±$Z/day`. Capital: full short-put collateral (strike × 100 × contracts), spread max loss, long-option and equity cost.
4. `1D ±$X · 1W ±$Y`. 1D from the broker's previous close (`prev-close`, as TastyTrade's P/L Day). 1W against the daily position snapshot 5 trading days back, labelled with its date ("vs snapshot of Mon 9/28"). Same positions only: a position opened in the window counts from entry; closed positions drop out (realized, Trade Log); missing history shows "partial (3 of 8)".
5. `N need attention` (amber, the only emphasis), from the existing needs-attention flag.

**The Total tile adds:**
- **Cash to deploy (no margin)** = cash balance − full short-put collateral − spread max loss − cash held by working opening orders. Margin buying power ("Option BP") is never counted. Negative = "−$X · using margin" in amber.
- **Largest exposure** = the single underlying with the largest share of capital at risk, "SOXL · $16,721 · 39% of capital"; amber above the limit; clicking it filters the list to that symbol.

## Decisions taken (Dean, 2026-10-05; adjustable)

- Largest-exposure limit **25%** of capital at risk (Ian's suggestion; a setting, not hard-coded in the component).
- Short puts are treated as **fully cash-secured** in cash to deploy; puts sold on margin therefore show as "using margin".

## Design rules (Diane)

- P/L is context, not a decision: numbers green/red only, no coloured tile backgrounds; amber only for needs-attention, using-margin and over-limit exposure.
- Secondary lines small, P/L stays the headline; tiles wrap two per row at phone width; if 1W does not fit, it moves to the tooltip.
- Reuse existing wording ("Unrealized P/L", "needs attention", strategy names).

## Out

Realized P/L (Trade Log), Greeks other than theta, DTE buckets, any recommendation or order behaviour.

## Quinn (approved with conditions)

- 1W: feasible as specified (`PositionSnapshot.pnl` per day).
- 1D: the app does not read a previous close today. Before build, check whether TastyTrade's position response carries a previous-close mark (likely what its P/L Day uses); else use the quote's `prev-close` (present on ~98% of option rows in the 2026-10-05 audit). Rows with neither: "1D partial (10 of 11)".
- Cash to deploy: count only opening working orders; closing orders free capital. Test both.

## Tests

- The Total tile's P/L equals the sum of the rows; each group equals the sum of its rows; groups partition the portfolio (no position in two groups, none missing).
- Partial data never shows as a complete total ("2 of 5 priced").
- 1D total reconciles with TastyTrade's P/L Day (the mock's sample differs: +$177 from the copied rows vs +$215.73 on Dean's screen; find the missing position or the same-day-open rule).
- Cash to deploy: negative path, working-order path, missing balance shows "Unavailable", never $0.
- Filter click sets the existing strategy filter; the strip's numbers do not change when filtered.
