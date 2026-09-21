# LEAPS-LEDGER-0001 — Implementation Report

**Ticket:** [LEAPS-LEDGER-0001](../tickets/LEAPS-LEDGER-0001-decision-ledger.md)
**Base:** `main` @ 28b7fa8d

## What changed

| File | Change |
|---|---|
| `lib/leaps-position-intelligence/ledger.ts` | **New**, pure (client-safe): `sanitizeClientEvent`, `shouldRecordEvaluation`, `shouldRecordOpenedReview`, `buildOrderDecisionEvent`, `describeLedgerEvent`, `isDecisionHistoryEvent` |
| `lib/leaps-position-intelligence/ledgerStore.ts` | **New**, server-only: `recordLedgerEvent` (existing `appendLedgerEvent` + a 1,000-event cap) |
| `app/api/leaps-ledger/route.ts` | **New**, `GET` and `POST` |
| `lib/leaps-position-intelligence/entryCapture.ts` | After a **saved** entry record, appends the server-attested decision event (own try/catch; same 2-second race) |
| `features/portfolio/positions-workspace/DecisionHistory.tsx` | **New**, the on-demand list |
| `features/portfolio/positions-workspace/PositionsWorkspace.tsx` | Both cards report state changes and review clicks (fire-and-forget) and show the Decision history; the "Review PMCC short calls" button reports before opening the review |
| Tests | `ledger` (53), `leaps-ledger` route (26), `entryCapture` (+6) |

## Sibling and adjacent paths checked

- The existing ledger repository (`appendLedgerEvent`, `readLedger`, key hashing) and the mandate route are untouched; rule changes already appear in the same list.
- `serverTradeReview.ts` is not changed by this ticket: the ledger event rides on the LEAPS-ENTRY-0001 capture, which already runs only after the broker accepts a submitted order. The wiring tests still pass unchanged.
- The card reports only when the mandate and the event calendar have settled, so a half-loaded first render (defaults, event data still loading) is not recorded as if it were the verdict.
- The client report is fire-and-forget and swallows failures; it can never block or alter the card.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `features/portfolio`, `lib/leaps-position-intelligence`, `lib/leaps-analysis`, `app/api/leaps-ledger`, `app/api/leaps-mandate`, `app/api/leaps-entry-records`: 52 files, 688 passed, 0 failed.
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** the card's reporting effect and the list in a browser (per the display-change rule there is no UI test; the throttle and validation it depends on are unit-tested). Evaluations only appear during market hours, when a live candidate exists, or when a rule gate fires. Please open a held LEAPS on a market day, expand "Show decision history", and tell me what you see; after your next order, its line should say "recorded by the server".
