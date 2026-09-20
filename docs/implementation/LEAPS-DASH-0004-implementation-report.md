# LEAPS-DASH-0004 — Implementation Report

**Ticket:** [LEAPS-DASH-0004](../tickets/LEAPS-DASH-0004-cc-pmcc-advisor-cards.md)
**Base:** `main` @ 00b34c8e

## What changed

| File | Change |
|---|---|
| `lib/scans/advisorCards.ts` | **New**, pure |
| `lib/scans/__tests__/advisorCards.test.ts` | **New**, 14 tests |
| `vitest.config.ts` | `testTimeout: 20_000` (flake protection, see the ticket) |
| `features/screener/components/LeapsAdvisorPickCard.tsx` | Score badge and Verify button now optional; LEAPS advisor behavior unchanged (defaults) |
| `app/screener/page.tsx` | `AdvisorPanel` renders pick cards with a `describePick` prop, concentration note, collapsed notes and conversation; both call sites (Covered Call, PMCC) pass `describePick` built from the scan result. No new exports |

## Sibling and adjacent paths checked

- The advisor route, prompt, session cache, saved-session staleness check and follow-up chat are untouched; only rendering changed.
- The LEAPS advisor panel is a different component and keeps its Verify button and score badge (pick-card defaults are unchanged).
- The identifier format used to look up a pick's result is the same one that builds `resultIdentifiers` for each strategy.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `app/screener`, `features/screener`, `lib/leaps-analysis`, `lib/scans/__tests__/advisorCards.test.ts`: 34 files, 317 passed, 2 skipped, 1 todo, 0 failed on the final run. An earlier identical run had one intermittent failure in `CcCapacityGate` (a test this change does not touch) that passed on the next three runs; see the timeout note in the ticket.
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** the panels in a browser.
