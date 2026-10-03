# LEAPS-QV-0001 Gate 3 — QV-v1.0 Underlying Strategy

Spec: ticket Section 45 (baseline `1a5c3f4da42c59226351f26b42bf85b93914d6ce`). Scope: underlying classification only.
Code: `lib/discovery/qv/`. Nothing outside `lib/discovery/` changed except one test guard (see Deviations).

## Architecture
- `policy.ts` — the ONLY home of thresholds and metric ids (`QV_V1_0_POLICY`, frozen, fingerprint-pinned in tests) and the assumptions A1–A8.
- `quality.ts`, `valuation.ts`, `fundamentals.ts`, `technical.ts`, `risk.ts`, `fcf.ts` — one classifier per domain; each returns a result plus structured reasons built from the same comparisons.
- `strategy.ts` — Data Sufficiency + lifecycle classification; `QV_V1_0_STRATEGY` (stateless) and `createQvStrategyFor(previousState)` (lifecycle-aware).
- `reasons.ts` — registry of every emitted code; `QV_SPEC_REASON_CONCEPTS` maps Section 45.12 names to emitted codes.
- Input is normalized metrics only. Only a VALID finite metric exposes a number; UNAVAILABLE / STALE / INVALID read as "not evaluable" and are named in the result. No provider, route, UI, clock or network code. No score and no ranking: a state is the conjunction of its gates (`rankings` is empty).

## Rules (order is fixed; later steps cannot undo earlier ones)
1. **Data Sufficiency** — Quality, Valuation, Fundamentals (integrity/momentum) and Technical must each be evaluable, otherwise INSUFFICIENT_DATA naming the blocking metric ids. Unfavorable evidence is never INSUFFICIENT_DATA.
2. **Thesis break** — three or more of the evaluable fundamental dimensions deteriorating => FUNDAMENTAL_THESIS_BROKEN; INVALIDATED if the candidate was previously WATCH/SETUP/ACTIONABLE, otherwise DISCOVERED.
3. **Quality FAIL** => DISCOVERED.
4. **SETUP / ACTIONABLE** — Quality PASS, valuation >= MODERATE, growth-adjusted INTACT/MIXED, integrity PASS, momentum STABILIZING/IMPROVING, no disqualifying risk; technical STABILIZING => SETUP, RECOVERING => ACTIONABLE.
5. **WATCH** — Quality PASS and thesis intact (growth-adjusted and momentum not DETERIORATING) but a SETUP requirement unmet (A8).
6. Otherwise DISCOVERED.
Technical regression only fails step 4, so ACTIONABLE falls to SETUP/WATCH, never INVALIDATED.

Domain rules: Quality fails on operating margin <= 0, HIGH leverage plus one other weakness, or two or more weaknesses (A4). Valuation: percentile and discount are independent criteria, stronger class wins; NONE needs both criteria; 3Y fallback at reduced confidence. Fundamentals: five dimensions, never-neutral NOT_EVALUABLE; growth-adjusted 0/1/2+ deteriorating; momentum per 45.7. Technical: confluence of weekly RSI direction, SMA50/SMA200, SMA200 trend and 126d relative strength vs SPY (A5).

## Reason codes
Quality (21), Valuation (8), Fundamental (5 + 15 per-dimension trajectory codes), Technical (4), Risk (6), Data (3), Lifecycle (12). Full list: `QV_ALL_REASON_CODES`.

## Assumptions needing Ian's ratification
A1–A8 in `policy.ts` (`QV_V1_0_ASSUMPTIONS`): where Section 45 is qualitative ("materially", "persistent", "approaching") the reading is recorded, not hidden.

## Data limitations (not proxied)
- **Annual FCF history** has no normalized metric (`fcf_annual_history_5y` is the contract id, UNAVAILABLE today). Negative TTM FCF therefore yields INSUFFICIENT_DATA; positive TTM FCF works, but the FCF *trajectory* dimension is NOT_EVALUABLE without history.
- **Leverage trajectory**: no prior-period leverage metric (A7). Fundamental dimensions evaluable today: revenue, EPS, operating margin (FCF with history).
- **Corporate event flags / analyst revisions** are not produced yet; they stay explicitly UNAVAILABLE and never block.
- **Lifecycle context**: the Gate 1 `StrategyInput` carries no previous state, so INVALIDATED requires `createQvStrategyFor(previousState)`; the stateless registered strategy reports a break as DISCOVERED with `LIFECYCLE_THESIS_BREAK_NO_PRIOR_THESIS`. Wiring the persisted state is Gate 7 work.

## Deviations
- Reason-code grammar requires a category prefix: `GROWTH_ADJUSTED_*` => `VALUATION_GROWTH_ADJUSTED_*`, `ANALYST_REVISION_DATA_UNAVAILABLE` => `DATA_…`, `REQUIRED_DATA_UNAVAILABLE` => `DATA_…`.
- `lib/discovery/__tests__/isolation.test.ts`: the investment-vocabulary guard now also excludes `lib/discovery/qv/` (as Gate 2 did for `normalized/`); `qv/__tests__/policy.test.ts` guards that numbers live only in `policy.ts`.

## Tests (`lib/discovery/qv/__tests__`)
boundaries (9), behavior (12: all 11 cases + registered-strategy contract), hardGates (15), policy (10) = 46.
