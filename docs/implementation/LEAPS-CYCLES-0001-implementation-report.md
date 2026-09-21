# LEAPS-CYCLES-0001 — Implementation Report

**Ticket:** [LEAPS-CYCLES-0001](../tickets/LEAPS-CYCLES-0001-income-history.md)
**Base:** `main` @ b1e1cb0a

## What changed

| File | Change |
|---|---|
| `lib/leaps-position-intelligence/cycleHistory.ts` | **New**, pure: `buildCycleHistory` |
| `lib/leaps-position-intelligence/__tests__/cycleHistory.test.ts` | **New**, 17 tests |
| `features/portfolio/positions-workspace/cycleTradesLoader.ts` | **New**, client-side shared loader over `fetchAndReconstructTrades('12m')` |
| `features/portfolio/positions-workspace/__tests__/cycleTradesLoader.test.ts` | **New**, 6 tests |
| `features/portfolio/positions-workspace/IncomeHistory.tsx` | **New**, the "Show income history" view (tiles, callouts, rows) |
| `features/portfolio/positions-workspace/PositionsWorkspace.tsx` | Both Positions cards include the income history under their callouts |
| `lib/leaps-position-intelligence/sinceOpen.ts` and its test | `extrinsicLostPerShare` output (+2 tests) |

## Sibling and adjacent paths checked

- `lib/tradeLog` (the reconstruction, its cache and the Trade Log and Performance pages) is untouched and reused as is. The Trade Log's own localStorage cache is deliberately not used: it does not record which account it belongs to, so the loader always reads the account from the fetched transactions and refuses a mismatch.
- `ClosedTrade.quantity` for a short call is a leg count, not contracts; the contract count comes from `closedQuantity` / `openedQuantity`.
- The `short-call-sold` entry records (LEAPS-ENTRY-0001) are not needed for this view and remain available for future per-cycle detail.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `features/portfolio`, `lib/leaps-position-intelligence`, `lib/tradeLog`: 38 files, 473 passed, 0 failed.
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** the view against your real transaction history. On a LEAPS you have sold calls against, click "Show income history" and check the rows against what you remember; tell me about anything missing or mislabeled (rolls are a same-day heuristic).
