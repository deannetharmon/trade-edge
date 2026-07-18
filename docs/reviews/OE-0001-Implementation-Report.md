# OE-0001 Implementation Report

## 1. Executive Summary

Built `lib/opportunity-engine/`, a canonical, deterministic ranking layer over already-computed Decision Engine evaluations. It answers "where should my next dollar go?" by comparing multiple already-scored candidates against each other and a shared, finite capital pool — a cross-candidate question no single-candidate `DecisionAnalysis` answers on its own. It never recomputes Opportunity Score, Decision Confidence, or Net Edge, and it never overrides an existing Decision Engine hard rejection.

One real, end-to-end-connected candidate adapter was built against `DecisionAnalysis` (the shape already produced today by `POST /api/autopilot/recommendations` for real Screener/Hunter candidates). A read-only "Best Opportunities" panel was built and mounted as a new tab in the existing Income Engine experience, with an honest, explicit blocker notice explaining why it renders empty pending a future sprint (see §5).

Full architecture rationale, ranking policy, and the exact production-wiring blocker are documented in `docs/design/OE-0001-Opportunity-Engine-Foundation.md`.

## 2. Files Changed

Created:

- `lib/opportunity-engine/types.ts` — `OpportunityCandidate`, `OpportunityContext`, `OpportunityRecommendation`, `OpportunityDisposition`, `OpportunityCandidateSource`
- `lib/opportunity-engine/ruleIds.ts` — `OE_RULE_IDS`, named/centralized comparison-rule identifiers
- `lib/opportunity-engine/evaluateOpportunityCandidate.ts` — per-candidate disposition contract
- `lib/opportunity-engine/rankOpportunityCandidates.ts` — batch sort, capital sequencing, conflict detection
- `lib/opportunity-engine/adapters/decisionAnalysisAdapter.ts` — real, connected `DecisionAnalysis → OpportunityCandidate` adapter
- `lib/opportunity-engine/index.ts` — public barrel export
- `lib/opportunity-engine/__tests__/decisionAnalysisFixture.ts` — shared fixture builders (not a test file)
- `lib/opportunity-engine/__tests__/decisionAnalysisAdapter.test.ts`
- `lib/opportunity-engine/__tests__/evaluateOpportunityCandidate.test.ts`
- `lib/opportunity-engine/__tests__/rankOpportunityCandidates.test.ts`
- `components/opportunity-engine/BestOpportunitiesPanel.tsx` — read-only presentational surface
- `docs/design/OE-0001-Opportunity-Engine-Foundation.md`
- `docs/reviews/OE-0001-Implementation-Report.md` (this file)

Modified:

- `app/engine/page.tsx` — added `'opportunities'` to `SubTab`, added the Opportunities tab button, mounted `BestOpportunitiesPanel` with an empty recommendations array and an explicit blocker notice, added the import. No existing tab, scan, or data path was changed.

## 3. Domain Model, Ranking Policy, and Adapter Design

See `docs/design/OE-0001-Opportunity-Engine-Foundation.md` §4–§6 for the full rationale. Summary:

- Every score and confidence figure surfaced by this module is read directly from the candidate's own `decisionAnalysis: DecisionAnalysis` field — never recalculated.
- `evaluateOpportunityCandidate()` decides one of four dispositions (`RECOMMENDED`, `ACCEPTABLE_ALTERNATIVE`, `WATCH`, `REJECTED`) per candidate, in a fixed priority order: hard rejection final → conditional → total-capital ceiling → disclosed conflict → batch-capital exhaustion → clean recommend.
- `rankOpportunityCandidates()` establishes a deterministic sort (status rank, then score, then confidence, then candidate id as a final stable tie-break) and walks candidates in that order maintaining a single running capital pool, so a top pick's capital is unavailable to lower-ranked candidates in the same pass.
- `decisionAnalysisAdapter.ts` is the one real, connected candidate source this sprint requires: it normalizes an already-computed `DecisionAnalysis` (the exact shape `POST /api/autopilot/recommendations` already produces from real `ScreenResult[]`) into an `OpportunityCandidate`, re-deriving nothing that's already scored.
- Repeat Trade and Watchlist sources are explicitly documented as unsupported this phase (§6.2/6.3 of the design doc) rather than silently omitted — neither has a stable, exported candidate contract today, and building one is a broad refactor outside this sprint's frozen scope.

## 4. A Latent Fixture Bug Found and Fixed During Testing

While writing `evaluateOpportunityCandidate.test.ts` and `rankOpportunityCandidates.test.ts`, both of which build fixtures without always specifying every override, several tests failed with "Fixture analysis must always produce a candidate." Root cause: `buildDecisionAnalysisFixture()` (in the shared test fixture file, itself new this sprint) built its default candidate with an object literal like `{ symbol: overrides.symbol, strategy: overrides.strategy, ... }` — when `overrides.strategy` was never supplied, this still produces an explicit `strategy: undefined` **key** in that literal, which overwrites `buildCandidateFixture()`'s own default (`'BPS'`) during object spread, since an explicit `undefined` value is not the same as an absent key. The adapter then correctly (and safely) returned `null` for a candidate with no strategy, which the fixture builder was designed to treat as a hard failure.

Fixed in `decisionAnalysisFixture.ts` by only including `symbol`/`strategy`/`theoreticalMaxLoss` keys in the object literal when the corresponding override was actually supplied, rather than passing them through unconditionally. This is a test-fixture-only fix; no production code was affected, and it does not change any adapter or ranking behavior — it only corrects the fixture's own construction so it matches the intent the fixture's overrides API always implied.

## 5. Read-Only Best Opportunities Surface and the Production-Wiring Blocker

The panel (`components/opportunity-engine/BestOpportunitiesPanel.tsx`) is mounted as a new "Opportunities" sub-tab in `app/engine/page.tsx`. It is fully built, typed, and ready to render real ranked recommendations — but it renders with an empty array today, with an explicit `blockerNotice` prop explaining why:

`app/engine/page.tsx`'s own SPX/SPY/Wheel suggestions (`SpxSuggestion`, `SpySuggestion`, `WheelSuggestion`) are produced by a page-local TastyTrade chain scan with its own heuristics — they were never evaluated by `evaluateSingleCandidate()` and carry no `DecisionAnalysis`. Wiring them into this panel would require either fabricating a `DecisionAnalysis` this module didn't compute, or running a brand-new Decision Engine evaluation from this page — both forbidden by this sprint's "never recompute, never fabricate" and "no new scanning" rules. Real Screener/Hunter candidates already flow through the Decision Engine via the existing `POST /api/autopilot/recommendations` route, but no page calls it today, and wiring that call plus the client-side state to keep it live on `/engine` is new cross-page plumbing excluded from this sprint's Safety Requirements.

This is reported here as the sprint's own anticipated escape-hatch outcome, not routed around with mock or fabricated data. See design doc §7 for the two concrete future-sprint options that would close this gap.

## 6. Validation Results

- `npx vitest run lib/opportunity-engine` — **32 / 32 passing** (3 test files: adapter, per-candidate evaluation, batch ranking)
- `npx tsc --noEmit` — clean, no errors
- Full repo validation sequence (targeted + full test suite, `tsc`, production build) is run once as a single sequence and reported in full below (§7).

## 7. Full Validation Sequence

Run once, in full, per the sprint's Final Verification requirement (this sandbox's ~40s practical window per shell call required splitting the full suite across a few `vitest run` invocations by path rather than one single invocation; every test file in the repository was run exactly once with no retries):

- **Targeted tests** (`lib/opportunity-engine`): 32 / 32 passing (3 files).
- **Full repository test suite**: **675 / 675 passing, 0 failures**, across all 48 test files (33 `lib/*.test.ts` files, 15 `features/portfolio/**/*.test.tsx` files). This is exactly the documented PI-0014 merge baseline of 643 plus this sprint's 32 new opportunity-engine tests (643 + 32 = 675) — consistent with no other test in the repository having been affected.
- **`npx tsc --noEmit`**: clean, no errors.
- **`npm run build` (`next build`)**: hangs at the initial Next.js banner (`▲ Next.js 14.2.35 - Environments: .env.local`) with no further progress, reproducing the same documented, accepted environment limitation recorded for PI-0014 (`docs/reviews/PI-0014-Marketable-Pricing-Implementation-Report.md`). Not treated as a regression given a clean `tsc --noEmit` and a fully passing test suite; Vercel remains the authoritative build check for this branch once pushed.

## 8. Deferred / Backlog Items Surfaced During Implementation

Per governance rule, these are backlog candidates for a future, separately-approved sprint — not part of this frozen scope:

- Wire `/engine` (or a future page) to call the existing `POST /api/autopilot/recommendations` route and hold the resulting `DecisionAnalysis[]` in page state so the Best Opportunities panel can render live data.
- Give `app/rinse-repeat/page.tsx` a stable, exported candidate contract so Repeat Trade candidates can be adapted.
- Design a Watchlist candidate model from scratch, then adapt it.
- Consider reconciling `app/engine/page.tsx`'s own heuristic SPX/SPY/Wheel scans with the canonical Decision Engine.

## 9. Manual Testing Steps

1. On `feature/opportunity-engine-foundation`, open `/engine`.
2. Click the new "Opportunities" sub-tab (★ icon, after Advisor).
3. Confirm the panel renders with the amber blocker notice explaining no live candidate source is wired yet, and an empty-state message ("No ranked opportunities to display.") rather than any placeholder or fabricated data.
4. Confirm no other Engine sub-tab (Actions, Dashboard, Timeline, Advisor) changed in appearance or behavior.
