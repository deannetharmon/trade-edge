# OE-0001 Implementation Report

**Status:** Corrected per Product Owner review round 1. Active sprint on `feature/opportunity-engine-foundation`, not merged into `main`, not complete. Pending re-review.

This report has two parts: the original implementation (§1–§9), and a Corrective Round addendum (§10) describing what the Product Owner rejected and what was changed in response. Where the two disagree, the Corrective Round addendum in §10 is authoritative.

## 1. Executive Summary

Built `lib/opportunity-engine/`, a canonical, deterministic ranking layer over already-computed Decision Engine evaluations. It answers "where should my next dollar go?" by comparing multiple already-scored candidates against each other and a shared, finite capital pool — a cross-candidate question no single-candidate `DecisionAnalysis` answers on its own. It never recomputes Opportunity Score, Decision Confidence, or Net Edge, and it never overrides an existing Decision Engine hard rejection.

One candidate adapter was built compatible with real `DecisionAnalysis` output (the shape already produced today by `POST /api/autopilot/recommendations` for real Screener/Hunter candidates), though it has no production consumer yet (see §10.1). A read-only "Best Opportunities" panel was built; it is intentionally **not mounted** anywhere in production (see §10.1).

Full architecture rationale, corrected ranking policy, and the exact production-wiring requirement are documented in `docs/design/OE-0001-Opportunity-Engine-Foundation.md`.

## 2. Files Changed (original round)

Created:

- `lib/opportunity-engine/types.ts` — `OpportunityCandidate`, `OpportunityContext`, `OpportunityRecommendation`, `OpportunityDisposition`, `OpportunityCandidateSource`
- `lib/opportunity-engine/ruleIds.ts` — `OE_RULE_IDS`, named/centralized comparison-rule identifiers
- `lib/opportunity-engine/evaluateOpportunityCandidate.ts` — per-candidate disposition contract
- `lib/opportunity-engine/rankOpportunityCandidates.ts` — batch sort, capital sequencing, conflict detection
- `lib/opportunity-engine/adapters/decisionAnalysisAdapter.ts` — `DecisionAnalysis → OpportunityCandidate` adapter
- `lib/opportunity-engine/index.ts` — public barrel export
- `lib/opportunity-engine/__tests__/decisionAnalysisFixture.ts` — shared fixture builders (not a test file)
- `lib/opportunity-engine/__tests__/decisionAnalysisAdapter.test.ts`
- `lib/opportunity-engine/__tests__/evaluateOpportunityCandidate.test.ts`
- `lib/opportunity-engine/__tests__/rankOpportunityCandidates.test.ts`
- `components/opportunity-engine/BestOpportunitiesPanel.tsx` — read-only presentational surface
- `docs/design/OE-0001-Opportunity-Engine-Foundation.md`
- `docs/reviews/OE-0001-Implementation-Report.md` (this file)

Modified (original round; see §10 for what was reverted):

- `app/engine/page.tsx` — added `'opportunities'` to `SubTab`, added the Opportunities tab button, mounted `BestOpportunitiesPanel` with an empty recommendations array and a blocker notice, added the import.
- `planning/SPRINT_STATUS.md`, `docs/roadmap/ROADMAP.md`

## 3. Domain Model, Ranking Policy, and Adapter Design (original round; corrected in §10.2/§10.3)

See `docs/design/OE-0001-Opportunity-Engine-Foundation.md` §4–§6 for the full, current rationale (already updated with the corrections). Summary of what was originally built:

- Every score and confidence figure surfaced by this module is read directly from the candidate's own `decisionAnalysis: DecisionAnalysis` field — never recalculated. This was correct and unchanged by the corrective round.
- `evaluateOpportunityCandidate()` decides one of four dispositions (`RECOMMENDED`, `ACCEPTABLE_ALTERNATIVE`, `WATCH`, `REJECTED`) per candidate.
- `rankOpportunityCandidates()` establishes a deterministic evaluation order (status rank, then score, then confidence, then candidate id) and walks candidates in that order maintaining a single running capital pool.
- `decisionAnalysisAdapter.ts` normalizes an already-computed `DecisionAnalysis` into an `OpportunityCandidate`, re-deriving nothing that's already scored.
- Repeat Trade and Watchlist sources are explicitly documented as unsupported this phase (§6.2/6.3 of the design doc) rather than silently omitted.

**Two defects in this original design were identified by the Product Owner and corrected — see §10.2 and §10.3.**

## 4. A Latent Fixture Bug Found and Fixed During Original Testing

While writing `evaluateOpportunityCandidate.test.ts` and `rankOpportunityCandidates.test.ts`, both of which build fixtures without always specifying every override, several tests failed with "Fixture analysis must always produce a candidate." Root cause: `buildDecisionAnalysisFixture()` (in the shared test fixture file, itself new this sprint) built its default candidate with an object literal like `{ symbol: overrides.symbol, strategy: overrides.strategy, ... }` — when `overrides.strategy` was never supplied, this still produces an explicit `strategy: undefined` **key** in that literal, which overwrites `buildCandidateFixture()`'s own default (`'BPS'`) during object spread, since an explicit `undefined` value is not the same as an absent key. The adapter then correctly (and safely) returned `null` for a candidate with no strategy, which the fixture builder was designed to treat as a hard failure.

Fixed in `decisionAnalysisFixture.ts` by only including `symbol`/`strategy`/`theoreticalMaxLoss` keys in the object literal when the corresponding override was actually supplied, rather than passing them through unconditionally. This is a test-fixture-only fix; no production code was affected.

## 5. Read-Only Best Opportunities Surface — original round (superseded, see §10.1)

The original round mounted the panel as a new "Opportunities" sub-tab in `app/engine/page.tsx`, rendering an empty recommendations array with an explanatory blocker notice. **This was rejected by the Product Owner and has been reverted — see §10.1.** `app/engine/page.tsx` is now byte-identical to `main`.

## 6. Validation Results (original round)

- `npx vitest run lib/opportunity-engine` — 32 / 32 passing (3 test files)
- `npx tsc --noEmit` — clean, no errors
- Full repo validation sequence run once; see §7.

## 7. Full Validation Sequence (original round)

- **Targeted tests** (`lib/opportunity-engine`): 32 / 32 passing (3 files).
- **Full repository test suite**: 675 / 675 passing, 0 failures, across all 48 test files (643 PI-0014 baseline + 32 new).
- **`npx tsc --noEmit`**: clean, no errors.
- **`npm run build` (`next build`)**: locally, hangs at the initial Next.js banner, reproducing the same documented PI-0014 environment limitation. **The claim in the original version of this report that "the Vercel build succeeded, confirmed by the Product Owner" is withdrawn — see §10.6.** No direct Vercel evidence was ever provided to or verified by the Implementation Engineer; that line should not have been written on the strength of a chat statement alone without documenting it as such.

## 8. Deferred / Backlog Items Surfaced During Original Implementation

Superseded by §10.7 (updated with the production-mounting item made explicit).

## 9. Manual Testing Steps (original round; superseded, see §10.1)

The original steps described opening `/engine` and viewing an "Opportunities" tab. That tab no longer exists (reverted). See §10.5 for current manual testing steps.

---

## 10. Corrective Round Addendum

### 10.1 UI unmounted

The Opportunities sub-tab, tab button, `BestOpportunitiesPanel` import, empty-array mount, and blocker notice were fully removed from `app/engine/page.tsx`. Verified: `git diff main -- app/engine/page.tsx` produces no output — the file is byte-identical to `main`. `BestOpportunitiesPanel.tsx` itself is unchanged in behavior (aside from now also rendering the new `exposureDisclosures` field, §10.2) and remains in the repo as a finished, tested, unmounted component. Its own top-of-file comment now states its unmounted status and the conditions under which it should be mounted in the future. No mock data, fetch, persistence, or cross-page state was introduced as a substitute.

### 10.2 Exposure disclosures separated from disposition-changing conflicts

**Defect:** `rankOpportunityCandidates.ts`'s `detectExposureConflicts()` treated any nonzero `existingTickerExposure[symbol]` or `existingSectorExposure[sector]` as a conflict, demoting the candidate to `ACCEPTABLE_ALTERNATIVE` — inventing a zero-based concentration threshold the Decision Engine does not use itself (the Decision Engine's real `single-ticker-concentration` / `sector-concentration` concerns are gated against the account's own configured `maxSingleTickerPct` / `maxSectorPct` limits, not against "greater than zero").

**Fix:**

- `rankOpportunityCandidates.ts`'s conflict detection is now split into two functions: `detectDispositionConflicts()` (exact symbol+strategy+expiration duplicates only — against an existing open position or an earlier candidate in the same batch) and `buildExposureDisclosures()` (ordinary nonzero ticker/sector exposure, informational only).
- `evaluateOpportunityCandidate.ts`'s args now take `conflictDescriptions` (disposition-changing) and `exposureDisclosures: { descriptions, ruleIds }` (informational) as separate parameters. Only `conflictDescriptions` can trigger the `ACCEPTABLE_ALTERNATIVE` branch; `exposureDisclosures` is appended to the output's `ruleIds` and its own new `exposureDisclosures` field unconditionally, before any disposition branch runs, so it structurally cannot influence disposition.
- `types.ts`'s `OpportunityRecommendation` now has two separate fields: `portfolioConflicts` (disposition-changing only) and `exposureDisclosures` (informational only, new).
- `ruleIds.ts` adds two new rule ids: `oe_ticker_exposure_disclosed`, `oe_sector_exposure_disclosed` — informational, never disposition-changing. `oe_duplicate_exposure_detected` is now documented as exact-duplicate-only.
- A genuine canonical concentration breach still reaches this module correctly: it already pushes `recommendation.status` to `'conditional'` upstream in the Decision Engine (a `high`-severity concern), which existing rule §5.1.2 already maps to `WATCH`. No new logic was needed for this — it was already correct; only the invented zero-threshold check was removed.

### 10.3 Final display order now respects disposition precedence

**Defect:** `rank` was assigned directly from the pre-evaluation sort order (by Decision Engine status/score/confidence), not from each candidate's actual computed disposition. This meant a high-score candidate that got demoted to `ACCEPTABLE_ALTERNATIVE` (by a duplicate conflict or capital exhaustion) could still display ahead of a lower-score but clean `RECOMMENDED` candidate.

**Fix:** `rankOpportunityCandidates()` now runs two passes. Pass 1 (unchanged): evaluate candidates in score/status order, sequencing capital and deciding each disposition. Pass 2 (new): re-sort the evaluated recommendations by disposition precedence (`RECOMMENDED` → `ACCEPTABLE_ALTERNATIVE` → `WATCH` → `REJECTED`, always) with the same deterministic tie-break within each group, and assign `rank` from that final order. This guarantees a `RECOMMENDED` candidate never displays behind any `ACCEPTABLE_ALTERNATIVE`/`WATCH`/`REJECTED` candidate, `ACCEPTABLE_ALTERNATIVE` never behind `WATCH`/`REJECTED`, and `REJECTED` always last.

### 10.4 Test coverage added/updated for the corrections

- `evaluateOpportunityCandidate.test.ts`: updated all calls for the new `exposureDisclosures` parameter; added a test proving ordinary nonzero ticker/sector exposure is disclosed (`exposureDisclosures` field, correct rule ids) without demoting disposition or blocking capital consumption; added a test proving the field is empty when nothing is supplied. **11 tests total** (was 8).
- `rankOpportunityCandidates.test.ts`: corrected scenarios 8, 9, and 16 (previously asserted the old, wrong demote-on-nonzero-exposure behavior; now assert disclosure without demotion, and scenario 16's `GOOGL` candidate is now correctly `RECOMMENDED`, not `ACCEPTABLE_ALTERNATIVE`). Added five new scenarios (17–21) required by the Product Owner: a higher-score exact-duplicate alternative never displays above a clean recommended candidate; a high-score unaffordable WATCH candidate never displays above an affordable recommended candidate; rejected candidates always display after every non-rejected candidate across a mixed four-disposition batch; reversing input order produces identical final results for a mixed-disposition batch; and capital/"higher-ranked candidate" explanations are internally consistent (the disclosed remaining/shortfall figures actually agree with the real pool arithmetic). **21 tests total** (was 16).
- New: `components/opportunity-engine/__tests__/BestOpportunitiesPanel.test.tsx` — **15 tests**, covering: populated recommendations render in the given order (proving the component does not re-rank), correct disposition labels for all four dispositions, an all-rejected list, primary reason/score/confidence rendering verbatim, a null-score placeholder (never "null"/"NaN"), `portfolioConflicts` vs. `exposureDisclosures` rendering distinctly, rejection reasons, missing-information disclosures, "what would improve," the `blockerNotice` prop, the empty state, absence of any Trade/Execute/Submit/Auto-Trade/Order/Buy/Sell/Place/Confirm control or any `<button>`/`<input>`/`<select>`/`<textarea>`/`<form>`/`<a>` element, and no `fetch` call.
- `vitest.config.ts`: added `components/**/__tests__/**/*.test.tsx` to `include` — the existing config only covered `lib/**` and `features/**`; without this addition, the new component test file would not have run under `npm test` at all. This was caught by the Implementation Engineer during this corrective round, not flagged by the Product Owner, and is disclosed here as a real consequence of adding a first test under `components/`.

New total: **54 tests** across `lib/opportunity-engine` (39) and `components/opportunity-engine` (15), up from the original 32.

### 10.5 Manual Testing Steps (current)

1. On `feature/opportunity-engine-foundation`, open `/engine`. Confirm the tab bar shows only Actions, Dashboard, Timeline, Advisor — no Opportunities tab.
2. Confirm `git diff main -- app/engine/page.tsx` is empty.
3. `components/opportunity-engine/BestOpportunitiesPanel.tsx` is not reachable from any page; it is verified only by its own test suite (`components/opportunity-engine/__tests__/BestOpportunitiesPanel.test.tsx`).

### 10.6 Vercel status — stated only from actual evidence

The original version of this report stated the Vercel build "succeeded, confirmed by the Product Owner," based on a chat message stating the build was successful. That claim is withdrawn here: the Implementation Engineer never independently verified a Vercel deployment (no dashboard access from this environment), and asserting it as an evidenced fact in a formal implementation report overstated what was actually verified. **Correct, current status: Vercel build result is unverified by the Implementation Engineer.** If Dean has direct evidence (a deployment URL, build log, or dashboard screenshot), that should be supplied and cited explicitly rather than restated as an unqualified fact.

### 10.7 Deferred / Backlog Items (current, supersedes §8)

- Wire a real page to call the existing `POST /api/autopilot/recommendations` route, hold the resulting `DecisionAnalysis[]` in page state, and **mount `BestOpportunitiesPanel`** against that real feed. This is now stated explicitly as its own backlog item (the original report only described the data-wiring half; mounting the already-built panel is the other half of that future sprint's work).
- Give `app/rinse-repeat/page.tsx` a stable, exported candidate contract so Repeat Trade candidates can be adapted.
- Design a Watchlist candidate model from scratch, then adapt it.
- Consider reconciling `app/engine/page.tsx`'s own heuristic SPX/SPY/Wheel scans with the canonical Decision Engine.
- PI-0015 / Portfolio Intelligence corrections remain queued, unaffected by this corrective round, for live-market acceptance validation per `planning/SPRINT_STATUS.md`.

### 10.8 Confirmations

- No execution, order-placement, or position-mutation capability exists anywhere in this sprint's code. `BestOpportunitiesPanel` contains no interactive elements of any kind (verified by test, §10.4).
- `feature/autopilot` was not touched. `origin/feature/autopilot` resolves to `7e81cd1` ("Add viewport settings to layout"), unrelated to this work.
- `main` and `origin/main` remain at `a86c92d`. This branch has not been merged into `main`.

### 10.9 Final Corrective-Round Validation Sequence

Run once, per the correction instructions' Validation requirement:

1. **Targeted opportunity-engine + BestOpportunitiesPanel tests**: `npx vitest run lib/opportunity-engine components/opportunity-engine` — **54 / 54 passing** (4 test files: adapter 7, per-candidate evaluation 11, batch ranking 21, panel component 15).
2. **Complete repository test suite**: run across path partitions to stay within this sandbox's practical per-command window (documented, pre-existing environment constraint, not new to this round) — **697 / 697 passing, 0 failures**, across 49 test files (33 `lib/*.test.ts`, 15 `features/portfolio/**/*.test.tsx`, 1 new `components/opportunity-engine/**/*.test.tsx`). This is up from the previous 675-test baseline, reflecting this round's expanded `evaluateOpportunityCandidate.test.ts` and `rankOpportunityCandidates.test.ts` plus the new `BestOpportunitiesPanel.test.tsx` file. No test outside `lib/opportunity-engine` or `components/opportunity-engine` was touched or affected.
3. **`npx tsc --noEmit`**: clean, no errors.
4. **`npm run build` (`next build`)**: locally, hangs at the initial Next.js banner with no further progress inside this sandbox's timeout window — the same documented, pre-existing environment limitation as PI-0014 and the original OE-0001 round. Not treated as a regression given a clean `tsc --noEmit` and a fully passing test suite. **Vercel build status is unverified by the Implementation Engineer for this corrective commit** — see §10.6.

No command exceeded five minutes; none were stopped for that reason.

### 10.10 Recommendation

Ready for Product Owner re-review. All four required corrections (UI unmount, conflict/disclosure separation, display-order fix, component tests) are implemented and covered by passing tests; documentation across all four required files has been corrected to remove overclaims. No further corrective work is proposed by the Implementation Engineer at this time — recommend acceptance or a second review pass, at the Product Owner's discretion.
