# LEAPS-SINCE-0001 — Implementation Report

**Ticket:** [LEAPS-SINCE-0001](../tickets/LEAPS-SINCE-0001-since-open.md)
**Base:** `main` @ 17d5f91c

## What changed

| File | Change |
|---|---|
| `lib/leaps-position-intelligence/sinceOpen.ts` | **New**, pure |
| `lib/leaps-position-intelligence/__tests__/sinceOpen.test.ts` | **New**, 18 tests |
| `features/portfolio/positions-workspace/model/types.ts`, `buildPositionsWorkspaceModel.ts` | `heldPmccLong` also carries `atEntry` (baseline, delta per share) and `nowIvr` |
| `features/portfolio/positions-workspace/PositionsWorkspace.tsx` | Both cards show the since-open tiles under "Your LEAPS" |
| `features/portfolio/positions-workspace/__tests__/model.test.ts` | +1 test for the baseline plumbing (fails without the builder change) |

## Sibling and adjacent paths checked

- The baseline store, its route and `attachEntrySnapshots` are untouched; this only reads fields already on `Position`.
- `netDelta` is the sum of per-share leg deltas times contracts, so the baseline delta is divided by the position's contract count to match the leg's per-share delta.
- If the contract count changed after the baseline was recorded, the per-share baseline is approximate; this is noted rather than corrected, since the store keeps one baseline per position.
- Values for the "Value (mark)" and breakeven tiles are unchanged.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `features/portfolio`, `lib/leaps-position-intelligence`, `app/api/leaps-mandate`: all passing (final run in this session).
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** the section against your real positions. Expect "Since first tracked <date>" for LEAPS you bought before this feature; a genuinely new position should say "Since you opened".
