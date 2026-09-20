# LEAPS-EVENTS-0001 — Implementation Report

**Ticket:** [LEAPS-EVENTS-0001](../tickets/LEAPS-EVENTS-0001-event-dates.md)
**Base:** `main` @ fd1dd34a

## What changed

| File | Change |
|---|---|
| `lib/leaps-position-intelligence/eventNote.ts` | **New**, pure: `buildEventCallouts`, `isNearItm` |
| `lib/leaps-position-intelligence/__tests__/eventNote.test.ts` | **New**, 21 tests |
| `lib/leaps-position-intelligence/incomeCard.ts`, `cycleCard.ts` | Optional `events` input replaces the standing note when supplied (an empty list suppresses it) |
| `lib/leaps-position-intelligence/__tests__/incomeCard.test.ts`, `cycleCard.test.ts` | +3 tests each for the `events` behavior |
| `features/portfolio/positions-workspace/PositionsWorkspace.tsx` | `PmccReadinessCard` fetches `/api/event-risk` for the call's window and passes the callouts to the card builders; fetch failures and unverified payloads become "could not be verified" |

## Sibling and adjacent paths checked

- `/api/event-risk`, `lib/scans/eventCalendar.ts` and `lib/scans/eventRisk.ts` are untouched; the same `verified`/`events` response handling as the existing `PmccLifecycleBanner` is used.
- The fetch is wrapped so a missing or mocked `fetch` is treated as "unavailable" instead of throwing (existing Positions tests still pass unchanged).
- Without an expiration to check (no live candidate and no open short call) nothing is fetched and the previous standing note behavior applies.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `features/portfolio`, `lib/leaps-position-intelligence`: 30 files, 314 passed, 0 failed (81 tests in the intelligence folder, 27 of them new).
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** a live `/api/event-risk` response for your symbols (the provider payload is still "diagnostic-first" per the endpoint's own comment). If the card says the dates could not be verified, check that `FMP_API_KEY` is set in Vercel and that the endpoint returns `verified: true` for the symbol.

## Follow-ups

- Make earnings a gate on the state via the saved mandate's "allow known earnings" setting.
- Show split / symbol-change dates.
