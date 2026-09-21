# PNL-BASIS-0001 — Make the P/L basis explicit on the Position Analysis view

**Status:** Approved by Dean 2026-09-20 ("go"); implemented — see the [implementation report](../implementation/PNL-BASIS-0001-implementation-report.md)
**Raised by:** Dean, comparing Portfolio and Position Analysis on his own positions (2026-09-20 screenshots). **Policy:** Ian.

## Problem

The Portfolio and Position Analysis views showed different P/L for the same positions, and neither said why:

- MRVL (put credit spread): **+$199** in the Portfolio, **+$162** in the analysis.
- META (+$596) and SNDK (+$412), the two best positions, are not in the analysis at all.

## Cause (verified in code)

1. **Two legitimate bases.** *Mid* is the valuation (the Portfolio view's figure, labelled "(MID)"; reconciles with the broker). *Close-now* is what closing at the marketable price would actually lock in. The analysis view shows close-now for credit spreads (`closeNowPnl`, which Take Profit also uses so a profit at the mid never sits beside a loss at the price you would actually get) and the midpoint for long options (which have no `closeNowPnl`). Nothing on screen said which was which.
2. **The analysis covers option positions only.** Equity holdings are a separate type, so "4 of 4 positions" excluded META and SNDK.

## Decision (Ian)

Keep both bases and every rule as is; **show both, label both, and reconcile**. Do not replace the long options' midpoint with close-now: that would move the figure away from what the broker shows and make P/L swing with quote width (worst after hours). Take Profit stays on close-now and Cut Losses stays on the midpoint, as designed.

## Scope (display only)

1. `features/portfolio/positions-workspace/model/pnlBases.ts` (pure): `buildPositionPnlBases`, `buildPnlSecondLine`, `wideMarketNote`, `buildPnlReconciliation`, `describePnlReconciliation`. For a long option, close-now is **derived for display** as liquidation proceeds less what was paid; the position's own `closeNowPnl` is never overridden.
2. **The P/L cell** now says which basis its main figure is on ("close now" or "mid") and shows the other under it: for a credit spread `Mid +$199 · 90% of target`, for a long option `Close now -$1,284 (-49.9%)`. The figure that was primary is unchanged.
3. **Wide-market note (amber):** when closing now is worse than the mid by more than **5%** of the position's mid value: "Wide market: closing now costs $37 more than the mid." (long options: "selling now brings $X less than the mid."). Threshold proposed by Ian; editable.
4. **Reconciliation line** above the table: options at mid and at close-now (each only if every option has that figure), how many equity holdings are not shown and their P/L, and all positions at mid with "matches the Portfolio view" when the total equals the sum of the Portfolio's per-symbol P/L (within $1) — or an amber warning with the size of the difference when it does not.

## Worked example (Dean's positions, after hours)

| | mid | close-now |
|---|---|---|
| MRNA | -$1,244 | -$1,284 |
| UBER | -$705 | -$770 |
| NFLX | -$723 | -$735 |
| MRVL | +$199 (90% of the $221 target) | +$162 (73%) |
| Options total | **-$2,473** | **-$2,627** |
| Equities (META, SNDK) | +$1,008 | |
| **All positions at mid** | **-$1,465** (= the Portfolio) | |

Only MRVL trips the wide-market note (15.2%); MRNA 3.0%, UBER 4.6%, NFLX 0.9%.

Note: the analysis column, as it was, added to -$2,510 because it mixed the two bases (close-now for MRVL, mid for the rest). The new line shows pure figures for each basis, so it does not equal -$2,510.

## Non-goals

- No change to any rule, recommendation, Take Profit / Cut Losses gate, or order.
- Equities are not added to the analysis table; they are counted and totalled in the reconciliation line.

## Acceptance criteria

1. Bases (credit / debit / unknown, own close-now preserved, derivation only for a debit with a liquidation value and complete economics), the second line, the wide-market threshold (exactly 5% silent, just over flagged, both wordings, missing values), and every reconciliation case (Dean's numbers, mismatch, sub-$1 rounding, partial data, no equities, only equities, empty) are unit-tested, using Dean's own positions as fixtures.
2. Existing portfolio tests are unchanged and pass.

## Rollout notes

No flag or environment variable. Rollback is a revert.
