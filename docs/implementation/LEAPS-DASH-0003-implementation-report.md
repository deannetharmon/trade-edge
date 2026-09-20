# LEAPS-DASH-0003 — Implementation Report

**Ticket:** [LEAPS-DASH-0003](../tickets/LEAPS-DASH-0003-advisor-cards.md)
**Base:** `main` @ 0502d28a

## What changed

| File | Change |
|---|---|
| `lib/leaps-analysis/dashboard.ts` | Adds `buildLeapsPickSummary`, `sortPicksByScore`, `buildConcentrationCallout`, `highDeltaMin` policy value |
| `lib/leaps-analysis/__tests__/dashboard.test.ts` | +14 tests (advisor tiles/callouts, boundaries, PMCC settings, missing data, ordering, concentration); policy pin updated |
| `features/screener/components/LeapsAdvisorPickCard.tsx` | **New**, presentational |
| `features/screener/components/LeapsAnalysisDashboard.tsx` | Tone maps exported; callout list extracted as `CalloutList` (same markup, now shared) |
| `app/screener/page.tsx` | `LeapsAdvisorPanel` renders pick cards ordered by score, computed concentration callout, collapsed notes/conversation; optional PMCC-settings props (defaults = PMCC defaults) and extra optional candidate fields; call site passes the trader's settings. No new exports |

## Sibling and adjacent paths checked

- The advisor route, prompt, saved-session cache and follow-up chat are untouched; only the rendering changed. `session.messages`, `sizingNote`, `gatedOut` and the follow-up input all still render.
- The extracted `CalloutList` keeps the analysis dashboard's markup identical (non-compact mode); its tests still pass.
- The Covered Call and PMCC advisors use `AdvisorPanel`, not this panel, and were not touched.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `app/screener`, `features/screener`, `lib/leaps-analysis`: 33 files, 303 passed, 2 skipped, 1 todo, 0 failed (35 dashboard tests, 14 new).
- Full suite: runs in CI on push. `next build` not run (Vercel).
- **Not verified:** the rendered panel in a browser. Please click Get Recommendation once after deploy.
