# PI-0012A — Portfolio Review Composition Layer — Implementation Report

Branch: `feature/portfolio-intelligence`
Commit: `fddb3a8`

## Executive Summary

Implements Phase 1 of `docs/design/PI-0012-Portfolio-Review-Architecture.md`: a thin, read-only composition layer (`lib/portfolioReview/`) plus a UI card (`features/portfolio/review/PortfolioReviewCard.tsx`) placed as the first section on the Portfolio page's Positions tab, above the position list. No new score, no new ranking, no new recommendation logic, no persistence, no AI, and no new API were introduced — every value the card shows is either the existing Portfolio Health Score, an existing already-ranked objective, or a direct count/sum/max over fields the page already had. Trailing performance, Decision Quality, historical Health trends, and any composite "Portfolio Review Score" are explicitly out of scope for this phase (Gap 3 and the Scoring Proposal recommendation from the architecture document) and deferred to PI-0012B/C/D.

## Files Changed

New:
- `lib/portfolioReview/types.ts` — `PortfolioReviewInput`, `PortfolioReviewPositionInput`, `PortfolioReviewSnapshot`, `PortfolioReviewCurrentState`, `PortfolioReviewComposition`.
- `lib/portfolioReview/buildPortfolioReview.ts` — the pure orchestrator (`buildPortfolioReview()`) plus `selectTopRisks()`, a direct generalization of `lib/todaysPriorities`'s own `selectTopPriority()` from "top 1" to "top N".
- `lib/portfolioReview/index.ts` — public barrel.
- `lib/portfolioReview/__tests__/buildPortfolioReview.test.ts` — 14 targeted tests (see Tests below).
- `features/portfolio/review/PortfolioReviewCard.tsx` — the UI card.
- `features/portfolio/review/__tests__/PortfolioReviewCard.test.tsx` — 6 component tests.
- `docs/reviews/PI-0012A-Portfolio-Review-Composition-Implementation-Report.md` — this report.

Modified:
- `app/portfolio/page.tsx` — three additions: (1) the `lib/portfolioReview` / `PortfolioReviewCard` imports; (2) a `portfolioReviewInput`/`portfolioReview` `useMemo` pair, placed immediately after the existing `portfolioHealth` `useMemo`; (3) the `<PortfolioReviewCard>` render, placed inside the `activeTab === 'positions'` block, immediately after the existing error banner and before the loading/empty-state checks (i.e. above the position list, as the ticket requires). No other line in this 10,000+-line file was touched.
- `docs/HANDOFF.md` — session handoff updated with this phase's completion (see that file).

## Reused Engines / Helpers (no recomputation)

- `PortfolioHealthResult` (`lib/portfolioHealth`) — passed through by reference; `buildPortfolioReview()` never calls `calculatePortfolioHealthScore()` itself. A test (`does not recompute Portfolio Health`) asserts the exact same object flows through regardless of what positions/objectives are also passed.
- The canonical objective list (`lib/portfolio-intelligence`, via `canonicalPriorities.objectives` already computed on the page) — `buildPortfolioReview()` only `.filter()`s by `type` (`REDUCE_CONCENTRATION`, `PRESERVE_BUYING_POWER`, `DEPLOY_IDLE_CASH`, `INCREASE_INCOME`); no objective is re-evaluated.
- `TodaysPrioritiesDashboard` (`lib/todaysPriorities`) — Top Risks reads the `.score` field `calculatePriorityScore()` already computed inside `buildTodaysPrioritiesDashboard()`; `selectTopRisks()` only sorts and slices already-scored entries, exactly mirroring how `selectTopPriority()` already reduces to a single max.
- `derivePositionConcentration()` and `deriveWheelDominance()` (`lib/portfolio-intelligence/adapters/balancesNormalization.ts`, re-exported from the `lib/portfolio-intelligence` barrel) — called directly inside `buildComposition()`. The portfolio-level Wheel-managed fraction is a weighted aggregation of `deriveWheelDominance()`'s own per-symbol output (fraction × that symbol's total exposure, summed), not a re-derivation of the WHEEL/PREFER classification.
- `PriorityRankedList` (`features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx`) — the exact same component Mission Control's Top Priority section already renders, reused for Top Risks.

## Data Flow

```
app/portfolio/page.tsx (existing state: positions, balances, canonicalPriorities,
                         todaysPrioritiesDashboard, portfolioHealth)
        |
        v
portfolioReviewInput (useMemo) -- maps positions to a lean PortfolioReviewPositionInput[]
        |                          (assignmentPreference via the same
        |                           deriveAssignmentPreferenceFromIntent(p.intent)
        |                           call already used elsewhere on this page;
        |                           positionStrategy stays null -- no live
        |                           data source exists yet, same documented
        |                           limitation as canonicalPriorities' own effect)
        v
buildPortfolioReview(input) -- lib/portfolioReview, pure, no fetch/API/React
        |
        v
PortfolioReviewSnapshot (currentState + composition)
        |
        v
<PortfolioReviewCard review={...} loading={...} th={...} />
```

`lib/portfolioReview` imports from `lib/portfolio-intelligence`, `lib/portfolioHealth`, and `lib/todaysPriorities` only (types + the two concentration helpers); nothing in those packages imports from `lib/portfolioReview`, preserving the one-way dependency direction the architecture document specifies.

## UI Placement

Per the ticket's explicit constraint, no new tab was created. `<PortfolioReviewCard>` renders inside the existing `activeTab === 'positions'` block, directly after the dry-run banner/error display and before the loading/empty-position checks — i.e., the first content on that tab, above the position table. The card handles its own `null` (not-yet-loaded) and empty-portfolio states, so it renders cleanly whether or not any positions exist.

## Tests

`lib/portfolioReview/__tests__/buildPortfolioReview.test.ts` — 14 tests:
1. Empty portfolio renders cleanly (no NaN/Infinity, empty maps, null maxes).
2. Portfolio Health reused verbatim (same object reference).
3. Top Risks sorted strictly by existing `.score`, no re-ranking.
4. Custom `topRisksLimit` respected; default matches `DEFAULT_TOP_RISKS_LIMIT`.
5. Objectives correctly filtered into concentration / capital / income concerns without re-evaluation.
6. `incomeConcern` is `null` when no `INCREASE_INCOME` objective exists.
7. Position counts grouped by raw strategy label.
8. Symbol concentration derived via `derivePositionConcentration()`.
9. Concentration data is empty/null (not fabricated) when net liquidity is unavailable.
10. Wheel-managed fraction computed from the WHEEL+PREFER classification.
11. Wheel-managed fraction is `null` (not `0`) with zero total exposure.
12. Non-finite/missing `maxRisk` treated as zero exposure, never `NaN`.
13. Portfolio Health never recomputed regardless of other inputs.
14. `generatedAt` stamped from the injected clock.

`features/portfolio/review/__tests__/PortfolioReviewCard.test.tsx` — 6 tests:
1. Renders nothing when `review` is `null` and not loading.
2. Renders a loading state when `review` is `null` and loading.
3. Renders all four sections (Portfolio Health, Top Risks, Portfolio Composition, Capital & Income) in order.
4. Renders the Health score/status/contributors verbatim.
5. Renders composition stats and strategy counts for a populated portfolio.
6. Renders clean empty states for an empty portfolio (including a guard against `NaN`/`undefined` ever appearing as text).

All 41 test files in the repo (27 in `lib/`, 14 in `features/`) were run in this session (in three batches, to stay within the sandbox's per-command time budget) — 100% pass, no regressions.

## Validation

- `vitest run` — all 41 test files pass (see Tests above for the batch breakdown).
- `tsc --noEmit` — clean, no errors.
- `next build` — reproduces this repo's known sandbox limitation (hangs at the initial Next.js banner, near-zero CPU, never completes). Consistent with every prior PI ticket's experience in this sandbox (see `docs/HANDOFF.md`); not treated as a regression given `tsc --noEmit` is clean and all tests pass. Vercel's build remains the authoritative check.

## Trade-offs

- **Strategy grouping uses the raw, un-normalized strategy label** already on each position (`p.strategy`, e.g. `'BPS'`, `'CSP'`), not a coerced `PortfolioIntelligenceStrategy` enum. The architecture document's proposed data model typed this as `Record<PortfolioIntelligenceStrategy, number>`; the actual `Position` type on the page doesn't guarantee its `strategy` field is already one of that union's members, so grouping by the raw string avoids inventing a new normalization step. Documented here rather than silently deviating from the design doc without a note.
- **`positionStrategy` is passed as `null` for every real position.** No UI control exists yet to set it (same limitation already documented on the page's `canonicalPriorities` effect) — the Wheel-managed fraction will read as `null` ("N/A") in production today, which is correct given the current data, not a bug in this composition layer.
- **No historical/trend view.** Per the architecture document's Gap 3, a Health Score history requires new persistence and is deliberately excluded from this phase.
- **No visual/screenshot QA.** This sandbox cannot render the live app (the same `next build` limitation above), so the card's layout has only been verified via passing component tests and code review — worth a manual look once deployed.

## Deferred Work (PI-0012B/C/D)

- **PI-0012B — Trailing Performance Rollup**: win rate, realized P&L, avg hold days, by-strategy breakdown from `lib/tradeLog`'s `ClosedTrade[]`, over a selectable trailing window.
- **PI-0012C — Decision Quality Rollup**: portfolio-level recommendation accuracy and followed-recommendation rate from `lib/decision-review`'s `analyzeAllDecisionOutcomes()`, gated on a minimum sample size.
- **PI-0012D — Polish & Window Selector**: time-window switcher across Performance/Decision Quality, empty/loading-state polish, and a final one-way-dependency audit.
- **Historical Health Score trending** (architecture doc's Gap 3) remains an explicit non-goal until a future ticket adds persistence.
