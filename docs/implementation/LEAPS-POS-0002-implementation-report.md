# LEAPS-POS-0002 — Implementation Report

**Ticket:** [LEAPS-POS-0002](../tickets/LEAPS-POS-0002-cycle-card.md)
**Base:** `main` @ 8af76293

## What changed

| File | Change |
|---|---|
| `lib/leaps-position-intelligence/cycleCard.ts` | **New**, pure: `buildCycleCard`, `CYCLE_CARD_POLICY` (50% / 21 days / 3%) |
| `lib/leaps-position-intelligence/__tests__/cycleCard.test.ts` | **New**, 20 tests |
| `lib/leaps-position-intelligence/incomeCard.ts` | Long-value and breakeven tiles extracted and exported (`longValueTile`, `longBreakevenTile`, `signedMoney`); behavior unchanged (its 16 tests still pass) |
| `features/portfolio/positions-workspace/model/types.ts`, `buildPositionsWorkspaceModel.ts` | `pairedShort` facts on the opportunity when a paired single-leg short call exists |
| `features/portfolio/positions-workspace/PositionsWorkspace.tsx` | `PmccReadinessCard` shows the cycle dashboard and a CLOSE OR ROLL WINDOW chip when a short call is open; Monitor sentences under Details |
| `features/portfolio/positions-workspace/__tests__/model.test.ts` | +1 test: paired short facts are carried (fails without the builder change) |

## Sibling and adjacent paths checked

- The status decision (monitor / capacity-reserved) is unchanged; only extra facts and display were added. A paired key with no findable short position, or a multi-leg / non-short-call structure, leaves `pairedShort` undefined and the card shows the previous Monitor view.
- The working-order branch (a short call order not yet filled) has no held short position, so it keeps the previous view.
- Short-leg delta is stored as an absolute value in the model because the broker's per-leg delta sign convention for a short leg is not guaranteed.
- The Covered Call card and the rest of the Positions screen are untouched.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `features/portfolio`, `lib/leaps-position-intelligence`, `lib/leaps-analysis`, `features/screener`, `app/screener`, `components`: 80 files, 777 passed, 2 skipped, 1 todo, 0 failed.
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** the card in a browser or against your live account with a real open short call.

## Follow-ups

- Close and roll buttons on the card (hand-off to the existing flows).
- Entry snapshots, which unlock "vs open" arrows and "income vs extrinsic lost".
- Earnings / ex-dividend data; saved mandate; breakeven as a gate on the state.
