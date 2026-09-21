# LEAPS-ENTRY-0001 — Implementation Report

**Ticket:** [LEAPS-ENTRY-0001](../tickets/LEAPS-ENTRY-0001-entry-records.md)
**Base:** `main` @ 88dd33ca

## What changed

| File | Change |
|---|---|
| `lib/leaps-position-intelligence/entryRecords.ts` | **New**, pure (client-safe): record types, `buildEntryRecord`, `brokerOrderIdOf`, `selectEntryRecord` |
| `lib/leaps-position-intelligence/entryRecordsStore.ts` | **New**, server-only Redis helpers (hashed keys, save, read) |
| `lib/leaps-position-intelligence/entryCapture.ts` | **New**, best-effort recorder (never throws, 2 s timeout) |
| `lib/leaps-analysis/serverTradeReview.ts` | Import + a small wrapper, and **three insertions**, each immediately before an existing `return` that is reached only after the broker's response was `ok`, guarded by `input.mode === 'submit'`. No other line in the order path changed |
| `app/api/leaps-entry-records/route.ts` | **New**, read-only `GET` |
| `lib/leaps-position-intelligence/sinceOpen.ts` | `capturedFrom` input, "Since you placed the order" wording, `isBaselineAtOpen` helper (existing behavior unchanged) |
| `features/portfolio/positions-workspace/PositionsWorkspace.tsx` | Reads the entry records and prefers a matching order record as the since-open baseline |
| Tests | `entryRecords` (28), `entryCapture` (8), `entryCaptureWiring` (10), read route (9), `sinceOpen` (+12) |

## Sibling and adjacent paths checked

- All three submit paths in `serverTradeReview.ts` were wired (LEAPS, PMCC pair, held short call); the dry-run branches share the same functions and are excluded by the `mode` guard. Other order routes (portfolio replacement and stop orders, the `test-trade` page) are not LEAPS/PMCC entries and were not touched.
- The pure module has no Node `crypto` import so the Positions component (client) can import the selector; `crypto` lives only in the server-only store.
- The existing `/api/pmcc-review-snapshots` store (a separate client-posted review snapshot) is untouched.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `features/portfolio`, `lib/leaps-position-intelligence`, `lib/leaps-analysis`, `app/api/leaps-entry-records`, `app/api/leaps-mandate`, `app/api/leaps-analysis`: 49 files, 576 passed, 0 failed.
- Mutation check: against the previous `serverTradeReview.ts` the wiring tests fail (4 of 10: the three positive paths and the ordering check); the six negative cases (dry run, unqualified, refused, blocked, failure isolation) correctly pass on both.
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** a real order submit against the broker and Redis. Please review the three insertions in `serverTradeReview.ts` (Alan, Ian) and, on your next real LEAPS or PMCC order, check that the Positions card afterwards says "Since you opened".

## Follow-ups

- Per-LEAPS cycle history built from the `short-call-sold` records; decision events in the ledger.
- Optional: backfill the stock price at your real open date for existing positions from price history (delta and IVR at the open cannot be recovered).
