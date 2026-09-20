# LEAPS-MANDATE-0001 — Implementation Report

**Ticket:** [LEAPS-MANDATE-0001](../tickets/LEAPS-MANDATE-0001-income-rules.md)
**Base:** `main` @ 91618a05

## What changed

| File | Change |
|---|---|
| `lib/leaps-position-intelligence/mandate.ts` | **New**, pure: `validateMandateInput` |
| `lib/leaps-position-intelligence/mandateGates.ts` | **New**, pure: `applyMandateGates`, `describeIncomeRules` |
| `lib/leaps-position-intelligence/__tests__/mandate.test.ts`, `mandateGates.test.ts` | **New**, 23 + 30 tests |
| `app/api/leaps-mandate/route.ts` and `__tests__/route.test.ts` | **New**, `GET`/`POST`; 19 tests (session, user scope, broker confirmation, validation, no detail leak, replay) |
| `features/portfolio/positions-workspace/MandateForm.tsx` | **New**, the one-screen rules form |
| `features/portfolio/positions-workspace/PositionsWorkspace.tsx` | `PmccReadinessCard` reads the saved rules, applies the gates (label, callouts, button), and shows the rules line with Set / Edit |
| `lib/leaps-position-intelligence/incomeCard.ts` | Optional `gates` input: "Upside kept" tile replaces "Delta kept" when a target is set; gate callouts replace the built-in floor callout |
| `lib/leaps-position-intelligence/eventNote.ts` | `earningsDateInWindow` helper |
| `incomeCard.test.ts`, `eventNote.test.ts` | +5 and +2 tests |

## Sibling and adjacent paths checked

- The persistence layer (`readMandate`/`saveMandate`, key hashing, atomic Lua save with an audit event and an idempotency record) already existed and is reused unchanged.
- The engine (`evaluateLeapsPositionIntelligence`) is untouched; the gates copy its rule order and use its `MIN_UPSIDE_PARTICIPATION` values (one source for thresholds).
- The route follows the same authorization pattern as the LEAPS analysis: server-side broker confirmation via `fetchHeldPmccPositionSnapshot`, which validates the account against the user's own accounts.
- The mandate `GET` in the card is guarded (a failed or mocked `fetch` leaves the defaults in force), so existing Positions tests pass unchanged.
- The open-cycle card and the Covered Call card are untouched.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `features/portfolio`, `lib/leaps-position-intelligence`, `app/api/leaps-mandate`, `lib/leaps-analysis`: 42 files, 474 passed, 0 failed.
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** saving a rule end to end against your live broker account and Redis, or the form in a browser.

## Follow-ups

- Feed the full engine live facts so the state is decided in one place (`evaluateLeapsPositionIntelligence`).
- Decision history screen (audit events are already written), and the same gates on the covered-call card.
