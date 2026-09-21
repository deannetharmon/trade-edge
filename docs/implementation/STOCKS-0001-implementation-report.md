# STOCKS-0001 — Implementation Report

**Ticket:** [STOCKS-0001](../tickets/STOCKS-0001-stock-holdings-section.md)
**Base:** `main` @ 0e5f09f9

## What changed

| File | Change |
|---|---|
| `features/portfolio/positions-workspace/model/stockHoldings.ts` | **New**, pure: rows, totals, covered-call cell, price-time label, `stockNoteKey`, `isPriceAlertCrossed` |
| `features/portfolio/positions-workspace/__tests__/stockHoldings.test.ts` | **New**, 28 tests |
| `features/portfolio/positions-workspace/StockHoldings.tsx` | **New**, the section (rows, totals, notes and alert editors, notes underneath) |
| `features/portfolio/positions-workspace/PositionsWorkspace.tsx` | Renders the section under the options table; notes and alert saving generalized to `saveNoteFor` / `savePriceAlertFor` (the option rows delegate to them, behavior unchanged); counter reads "option positions" |
| `features/portfolio/positions-workspace/model/pnlBases.ts` and its test | The reconciliation line says "Stock holdings below: …" |
| `features/portfolio/positions-workspace/__tests__/PositionsWorkspace.test.tsx` | Two expectations updated for the new counter wording |
| `docs/tickets/STOCKS-ORDERS-0001-…md` | **Docs only:** the proposed follow-up (stock orders), capturing the reusable plumbing and the covered-call safety gate |

## Sibling and adjacent paths checked

- The notes and price-alert routes and stores are untouched. They accept any key, so the stock key format `equity:SYMBOL:long|short` needs no server change and cannot equal an option position key.
- Nothing consumes saved alerts server-side; the only check is the client-side "Target reached" comparison, so a stock alert behaves exactly like an option one.
- The Portfolio (symbol-row) view, capacity model and equity normalization are untouched; the section only reads them.
- No order path, dry-run route, or broker call was touched or added.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `features/portfolio`: 28 files, 293 passed, 0 failed.
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** the section in a browser (spacing, the horizontal scroll on a narrow screen), or a real note / alert save. After deploy: META and SNDK should appear under the options table, prices "as of" the last quote time, notes and alerts should save, and the reconciliation line above the table should still end "matches the Portfolio view".
