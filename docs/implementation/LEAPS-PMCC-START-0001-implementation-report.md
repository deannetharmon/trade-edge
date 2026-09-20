# LEAPS-PMCC-START-0001 — Implementation Report

**Ticket:** [LEAPS-PMCC-START-0001](../tickets/LEAPS-PMCC-START-0001-pmcc-start-price.md)
**Base:** `main` @ b764a553 (after LEAPS-UI-0002)

## What changed

| File | Change |
|---|---|
| `lib/scans/pmccStartPrice.ts` | **New**, pure. `computePmccStartPrice`, `normalInv`, `PMCC_START_PRICE_RISK_FREE_RATE` (4%) |
| `lib/scans/__tests__/pmccStartPrice.test.ts` | **New**, 14 tests including an independent Black-Scholes round trip |
| `app/screener/page.tsx` | Import; `LeapsResultRow` takes optional `pmccShortDeltaMax` / `pmccShortDteMin` (defaults = the PMCC defaults) and shows the "PMCC start ≥ $X est." item beside Breakeven; both `LeapsResultRow` call sites pass the Screener's existing PMCC short-call state. No new exports |
| `app/screener/__tests__/ScreenerPage.test.tsx` | 3 tests: below (needs +X%), above (✓), missing IVx (dash) |

## Sibling and adjacent paths checked

- `LeapsResultRow` is rendered at two call sites (results and "insufficient data"); both now pass the trader's settings. A third `extrinsicPctMax={leapsExtrinsicPctMax}` occurrence belongs to a different component and was left alone.
- The trader's short-call settings already live in `pmccShortDeltaMax` / `pmccShortDteMin` state (also used by PMCC scans), so there is one source of truth; no new setting was added.
- No existing Black-Scholes or normal-distribution helper existed in the repo, so the two small functions live in the new module.
- Nothing else reads the row's new props; scan, scoring, qualification, and order paths untouched.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `pmccStartPrice.test.ts`: 14 passed. `ScreenerPage.test.tsx`: 43 passed; the new UI tests fail against the previous row.
- All screener test directories (`app/screener`, `features/screener`): 24 files, 222 passed, 2 skipped, 1 todo, 0 failed.
- The full suite was not run locally (CI runs it on push). `next build` not run (Vercel).
- **Not verified:** the visual result in a browser; the estimate against a live short-call chain.

## Follow-ups

See the ticket (exact live-chain version; IVR/earnings readiness; held LEAPS and AI-analysis facts).
