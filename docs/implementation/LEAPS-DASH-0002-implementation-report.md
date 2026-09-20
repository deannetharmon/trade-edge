# LEAPS-DASH-0002 — Implementation Report

**Ticket:** [LEAPS-DASH-0002](../tickets/LEAPS-DASH-0002-facts-only-dashboard.md)
**Base:** `main` @ fefb1464

## What changed

| File | Change |
|---|---|
| `app/api/leaps-analysis/route.ts` | `mode: 'facts'` branch after validation: rate-limit, resolve evidence with the request's criteria, return `FACTS_ONLY` snapshot. Nothing else in the route changed |
| `lib/leaps-analysis/analysisService.ts` | `enforceFactsLimit` and `LEAPS_FACTS_HOURLY_LIMIT` (120/hour) |
| `app/screener/page.tsx` | Row loads facts when the panel opens; `Explain with AI` / `Refresh AI explanation` / `Refresh numbers` buttons; dashboard uses the newest snapshot; heading notes when the AI text explains an earlier snapshot. No new exports |
| `app/api/leaps-analysis/__tests__/analysis.test.ts` | 5 new route tests (facts happy path with no model/claim/save/key, same criteria, 429 limit, validation, AI path unchanged); mocks now spy on `claimAnalysis`/`saveAnalysisRecord` |

## Sibling and adjacent paths checked

- The facts branch sits before the idempotency claim, so the AI path's behavior and 10-per-hour budget are untouched (regression test).
- `GET` and `DELETE` handlers (saved analyses) are untouched; facts snapshots are never stored, so they cannot appear in saved analyses.
- The order/trade-review routes and the shared criteria helper are untouched.
- The dashboard builder (LEAPS-DASH-0001) already accepted any snapshot; no change needed there.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `app/screener`, `features/screener`, `lib/leaps-analysis`, `app/api/leaps-analysis`: 35 files, 305 passed, 2 skipped, 1 todo, 0 failed. The new facts tests fail against the previous route (3 of 5; the other 2 assert unchanged behavior).
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** the panel in a browser or a live broker call.
