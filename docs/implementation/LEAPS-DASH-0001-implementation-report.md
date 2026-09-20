# LEAPS-DASH-0001 — Implementation Report

**Ticket:** [LEAPS-DASH-0001](../tickets/LEAPS-DASH-0001-analyze-dashboard.md)
**Base:** `main` @ ba5f5607

## What changed

| File | Change |
|---|---|
| `lib/leaps-analysis/dashboard.ts` | **New**, pure. `buildLeapsDashboard`, `LEAPS_DASHBOARD_POLICY`, dashboard types |
| `lib/leaps-analysis/__tests__/dashboard.test.ts` | **New**, 21 tests (values, tones, callout order, every threshold boundary, failed/unavailable gates, discovery mode, prior-session, missing IVx/IVR, older snapshot, purity) |
| `features/screener/components/LeapsAnalysisDashboard.tsx` | **New**, presentational only |
| `app/screener/page.tsx` | Two imports; the panel's status/criteria/notes/gates block replaced by `<LeapsAnalysisDashboard>`; the AI text wrapped in a collapsed `<details>` "Read full analysis". No new exports |

## Sibling and adjacent paths checked

- The panel already computed the rule line, discovery note, and prior-session note inline; those are now produced once by the builder (no duplicate wording left in `page.tsx`).
- The `pmccStart` value comes from the row's existing `computePmccStartPrice` call (LEAPS-PMCC-START-0001) and the row's `ivRank`/`ivx`; the analysis route, snapshot, and order paths are untouched.
- The advisor, CC and PMCC panels do not use this builder; they are separate tickets.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- `app/screener`, `features/screener`, `lib/leaps-analysis` test folders: 33 files, 289 passed, 2 skipped, 1 todo, 0 failed.
- The full suite runs in CI on push. `next build` not run (Vercel).
- **Not verified:** the rendered panel in a browser. Please open Analyze with AI once after deploy.

## Follow-ups

- Facts-only mode: show the dashboard without running the model.
- Same tile-and-callout treatment for the LEAPS Advisor, then CC/PMCC advisors, then the Positions cards.
