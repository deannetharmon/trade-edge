# LEAPS-POS-0001 — Implementation Report

**Ticket:** [LEAPS-POS-0001](../tickets/LEAPS-POS-0001-income-card.md)
**Base:** `main` @ 9e3f6f22

## What changed

| File | Change |
|---|---|
| `lib/leaps-position-intelligence/incomeCard.ts` | **New**, pure. `buildIncomeCard` |
| `lib/leaps-position-intelligence/__tests__/incomeCard.test.ts` | **New**, 16 tests (worked example, floor boundary, if-assigned loss, credit-ratio boundary, DTE boundary, losses, missing data, contracts, purity) |
| `components/dashboard/DashboardParts.tsx` | **New**, shared `TileGrid`, `CalloutList`, tone maps |
| `features/portfolio/positions-workspace/PositionsWorkspace.tsx` | `PmccReadinessCard` renders the dashboard; explanatory sentences under Details (state label, button, Next line unchanged) |
| `features/portfolio/positions-workspace/model/types.ts`, `buildPositionsWorkspaceModel.ts` | `heldPmccLong` carries entry cost, mark, delta, stock price (optional) |
| `lib/scans/pmccHeldReadinessClient.ts` | Live candidate also returns strike, expiration, OCC symbol |
| `features/portfolio/positions-workspace/__tests__/model.test.ts` | Existing test now also pins the new `heldPmccLong` fields |
| `features/screener/components/LeapsAnalysisDashboard.tsx` | Imports the shared parts (re-exports them; markup identical) |
| `lib/leaps-analysis/dashboard.ts` | `money` and `pct` exported for reuse |

## Sibling and adjacent paths checked

- The state decision (`ExistingIncomeOpportunity.status`, the live evaluator's review/monitor/not-ready logic) is untouched; only additional fields flow through.
- All new `heldPmccLong` fields are optional, so existing fixtures and callers compile and behave as before.
- The Covered Call card and the rest of the Positions screen are unchanged.
- The screener components that used the tone maps and `CalloutList` still import them from the same module path (re-exported).

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `features/portfolio`, `lib/leaps-position-intelligence`, `lib/leaps-analysis`, `features/screener`, `app/screener`, `components`: 79 files, 756 passed, 2 skipped, 1 todo, 0 failed. The new model assertion fails without the builder change.
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** the card in a browser, or against a live broker during market hours (the candidate tiles need an open market).

## Follow-ups

- Ian: confirm the 1× credit-vs-extrinsic threshold; then make the breakeven floor a gate on the state.
- Next slices: mandate setup, earnings/ex-dividend data, entry snapshots for "since you opened" arrows, decision history, shadow-run against the engine.
