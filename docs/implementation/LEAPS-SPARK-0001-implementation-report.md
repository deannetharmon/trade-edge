# LEAPS-SPARK-0001 — Implementation Report

**Ticket:** [LEAPS-SPARK-0001](../tickets/LEAPS-SPARK-0001-history-strip.md)
**Base:** `main` @ c1b5f4a7

## What changed

| File | Change |
|---|---|
| `lib/leaps-position-intelligence/sparklines.ts` | **New**, pure: `buildSparklines`, `cleanHistory`, `sparkPath` |
| `lib/leaps-position-intelligence/__tests__/sparklines.test.ts` | **New**, 17 tests |
| `features/portfolio/positions-workspace/HistoryStrip.tsx` | **New**, presentational (three SVG lines) |
| `features/portfolio/positions-workspace/model/types.ts`, `buildPositionsWorkspaceModel.ts` | `heldPmccLong.history` (newest 120 days, four fields) |
| `features/portfolio/positions-workspace/PositionsWorkspace.tsx` | Both cards show the History strip under the Since tiles |
| `features/portfolio/positions-workspace/__tests__/model.test.ts` | +1 test for the history plumbing (fails without the builder change) |

## Sibling and adjacent paths checked

- `attachSnapshotHistory` (which sorts each position's history ascending and attaches it) is untouched; the strip re-cleans defensively (dedupe by date, sort) so an unexpected order or a duplicate day cannot distort a chart.
- The snapshot store, its capture on Portfolio load, and Trade Evolution are untouched.
- `netDelta` is the sum of per-share leg deltas times contracts, so delta is divided by the current contract count; if the contract count changed during the recorded period the older delta points are approximate (noted, not corrected).
- No fetch was added; the data is already loaded with the positions.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `features/portfolio`, `lib/leaps-position-intelligence`: 38 files, 484 passed, 0 failed.
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** how the strip looks in a browser or how many days your positions have recorded (a position tracked for a single day shows the "fills in" message). Tell me if the lines look cramped at your screen width.
