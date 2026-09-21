# PNL-BASIS-0001 — Implementation Report

**Ticket:** [PNL-BASIS-0001](../tickets/PNL-BASIS-0001-position-analysis-pnl.md)
**Base:** `main` @ fec0758c

## What changed

| File | Change |
|---|---|
| `features/portfolio/positions-workspace/model/pnlBases.ts` | **New**, pure |
| `features/portfolio/positions-workspace/__tests__/pnlBases.test.ts` | **New**, 24 tests (fixtures are Dean's positions) |
| `features/portfolio/positions-workspace/PositionsWorkspace.tsx` | The analysis P/L cell shows its basis, the other basis, and the wide-market note; a reconciliation line sits above the table. The existing primary figure, `profitTargetPresentation` and `profitTargetPct` are unchanged |

## Sibling and adjacent paths checked

- `Position.pnl`, `closeNowPnl`, the recommendation engine, Take Profit / Cut Losses gating (`page.tsx`), and `computeMarketablePnlPct` are untouched. The derived close-now for long options exists only in the new display module.
- The Portfolio (symbol-row) view is unchanged; the reconciliation compares against its per-symbol `symbolUnrealizedPnl` (the same aggregate it displays).
- The existing `Target 50%` text and the `% of target` span in the same cell are unchanged, so the existing PLTARGET-0001 tests still pass.
- A bug found while writing the tests: an empty portfolio would have shown "All positions at mid: +$0"; fixed before shipping (and pinned).

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `features/portfolio`: 27 files, 265 passed, 0 failed.
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** the rendered table in a browser. After deploy the analysis view should show, for MRVL, "close now" with "Mid +$199 · 90% of target" and an amber wide-market note, and the reconciliation line should end "matches the Portfolio view". If it shows an amber "differ by" warning instead, send me the line: that would be a real discrepancy worth investigating.
