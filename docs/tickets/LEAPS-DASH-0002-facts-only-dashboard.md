# LEAPS-DASH-0002 — Facts-only mode: the dashboard loads without running the AI

**Status:** Approved by Dean 2026-09-20 ("go"); implemented — see the [implementation report](../implementation/LEAPS-DASH-0002-implementation-report.md)
**Follows:** [LEAPS-DASH-0001](./LEAPS-DASH-0001-analyze-dashboard.md)

## Problem

After LEAPS-DASH-0001 the dashboard is rule-computed, but it only appeared after clicking "Run analysis", which calls the AI (cost, delay, and a 10-per-hour AI budget). Dean does not want to rely on AI to understand a LEAPS.

## Scope

1. **Route** `POST /api/leaps-analysis` accepts `mode: 'facts'`. It returns the same server-resolved analysis snapshot the dashboard is built from, with status `FACTS_ONLY` and `output: null`. It makes **no model call**, saves **no record**, does **not** use the AI idempotency/budget claim, and needs **no OpenAI key**. It uses the same session check, feature flag, validation, and the same scan-filter criteria as an AI request.
2. **Own limit:** `enforceFactsLimit` — 120 facts requests per user per hour (Redis counter), separate from the 10-per-hour AI budget. Past it: HTTP 429.
3. **Panel:** opening Analyze with AI loads the numbers once and shows the dashboard immediately. Buttons: **Explain with AI** (runs the model; becomes **Refresh AI explanation**), **Refresh numbers** (facts only), **Close**. The dashboard shows whichever snapshot is newest; if the AI text explains an older snapshot the "Read full analysis" heading says so.

## Non-goals

- No change to the AI path (idempotency claim, saved record, model call, output validation) — pinned by a regression test.
- No change to scan qualification, scoring, or any order path.
- Facts snapshots are not persisted and have no "current" pointer.

## Acceptance criteria

1. A facts request returns `FACTS_ONLY` with the snapshot and criteria; the model is not called; `claimAnalysis` and `saveAnalysisRecord` are not called; it works with no `OPENAI_API_KEY`.
2. It is judged against the same scan filters as an AI request.
3. The 121st facts request in an hour returns 429 and does not read the broker.
4. Invalid contract/quantity still returns 400.
5. The AI path behaves exactly as before.
6. Opening the panel shows the dashboard without any AI call.

## Rollout notes

No flag or environment variable. Rollback is a revert.

## Follow-ups

LEAPS Advisor, Covered Call and PMCC advisors, and the Positions cards get the same tile-and-callout treatment next.
