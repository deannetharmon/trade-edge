# OE-0001 — Opportunity Engine Foundation

**Status:** ✅ MERGED into `main` at merge commit `c97a705` (DOC-0001 reconciliation, verified against Git history 2026-07-24). The corrective round described below was reviewed and approved by the Product Owner; the temporary branch `feature/opportunity-engine-foundation` has been deleted, locally and remotely. Its production UI (`BestOpportunitiesPanel`) was intentionally left unmounted at merge time and has since been activated by OE-0002A (merged `7acb641`) on `/screener`. The remainder of this document is preserved as the historical design record.
**Branch:** `feature/opportunity-engine-foundation`
**Base:** `main` @ `a86c92dc72470ccdeb7221ceb6aa11a27cf1d7a5` (`main` and `origin/main` remain at this commit; this branch is separate and unmerged)
**Implements:** `docs/specifications/TradeEdge-Phase3-Master-Specification.md` §4.1 ("Opportunity Engine"), roadmap item **TE-0007 — Opportunity Engine Foundation**

## 1. Purpose

Answer the product question **"where should my next dollar go?"** across every already-scanned candidate the trader has in front of them, using evidence the Decision Engine has already computed. This is a comparison and ranking layer, not a new evaluation engine: it never scores a candidate, never recomputes Opportunity Score, Decision Confidence, or Net Edge, and never overrides a Decision Engine hard rejection.

## 2. Why This Is Safe to Build Now

Per `planning/DECISION_ENGINE_CONSTITUTION.md` and DR-0002, every candidate the repository already screens (Screener BPS/BCS/IC/CSP, Hunter, Repeat Trades) can be run through `evaluateSingleCandidate()` to produce a `DecisionAnalysis` — a canonical, deterministic, explainable evaluation with a final recommendation status (`recommended` / `conditional` / `not_recommended`), an Opportunity Score, a Decision Confidence breakdown, and named concerns/evidence. `not_recommended` is a hard rejection and is never overridden downstream.

What doesn't exist yet: a way to compare **multiple** already-evaluated candidates against each other and against a shared, finite pool of available capital and existing exposure. "If I take candidate A's capital, is there still room for candidate B?" is a cross-candidate question no single-candidate `DecisionAnalysis` answers on its own. That comparison layer is what OE-0001 adds.

## 3. Architecture Discovery Summary

Before writing any code, the following was confirmed by reading the existing implementation (not assumed):

- `lib/decision-engine/evaluateSingleCandidate()` is the single canonical per-candidate evaluation contract, already consumed by Portfolio, Screener, Hunter, Repeat Trades, Pending Orders, and Autopilot (DR-0002, "Accepted").
- `lib/autopilot/decision/recommendationEngine.ts`'s `runRecommendationEngine()` is the full existing orchestration pipeline (validation, dedup, risk gates, Decision Engine evaluation, persistence).
- **`POST /api/autopilot/recommendations`** (`app/api/autopilot/recommendations/route.ts`) already exists and already converts real, client-supplied Screener/Hunter `ScreenResult[]` through `screenResultsToAutopilotCandidates()` and the full pipeline above into `DecisionAnalysis[]`, persisted via the existing Redis stores. **No page currently calls this route.** It is the real, production-shaped data source OE-0001's adapter is built against.
- `lib/autopilot/scoring/` (`calculateOpportunityScore`, `calculateDecisionConfidence`, `calculateNetEdge`) are the existing, canonical formulas. OE-0001 imports none of them — every number it reports is read from an already-computed `DecisionAnalysis`.
- `app/engine/page.tsx` (the "Income Engine") has **no candidate list of its own**. Its SPX/SPY/Wheel suggestion cards (`SpxSuggestion`, `SpySuggestion`, `WheelSuggestion`) are produced by a separate, page-local chain-scanning routine that talks to TastyTrade directly and computes its own heuristics (delta targeting, credit ratio, POP approximation). None of this goes through `evaluateSingleCandidate()` — these objects are not, and do not carry, a `DecisionAnalysis`. This is the key architectural fact behind the UI wiring blocker in §7.
- `app/rinse-repeat/page.tsx` ("Repeat Trade") has its own page-local, non-exported candidate types (`SpreadCandidate`, `RRResult`) with no stable public contract to adapt against.
- No Watchlist candidate model exists anywhere in the repository.

## 4. Canonical Domain Model (`lib/opportunity-engine/types.ts`)

### 4.1 `OpportunityCandidate`

A narrow, source-agnostic comparison input. It is deliberately **not** a copy of the full Screener/Hunter/Repeat-Trade result — every numeric judgment lives inside `decisionAnalysis: DecisionAnalysis`, carried through verbatim from the existing Decision Engine. Fields outside that are either stable identity (`id`, `symbol`, `strategy`, `expiration`, `dte`), reused capital sizing (`capitalRequired`, sourced from `expectedOutcome.capitalRequired` / `theoreticalMaxLoss`), or known-when-available disclosure fields (`sector`, `earningsRisk`, `wheelSuitable`) that are left `undefined` — never defaulted to a favorable guess — when the source candidate didn't supply them.

### 4.2 `OpportunityContext`

Portfolio-level facts a single-candidate `DecisionAnalysis` doesn't capture: total `availableCapital` for this ranking pass, and pre-batch existing exposure (`existingTickerExposure`, `existingSectorExposure`, `existingStrategyExposure`, `existingOpenPositionKeys`) mirroring `PortfolioStateSummary`'s shape so callers can pass it through directly.

### 4.3 `OpportunityRecommendation`

One ranked result: `rank`, `disposition`, the `opportunityScoreTotal` / `decisionConfidenceTotal` read verbatim from the candidate's `DecisionAnalysis`, and disclosure arrays built only from evidence that already exists on the analysis or from this module's own capital/conflict comparison. `decisionAnalysisId` and `ruleIds` provide traceability back to the source evaluation.

Two of these arrays are deliberately separate, per a Product Owner correction (see §5.1 and §5.4):

- `portfolioConflicts` — **disposition-changing** conflicts only: an exact symbol+strategy+expiration duplicate against an existing open position or an earlier candidate in the same batch. These are the only exposure-related facts that ever demote a candidate.
- `exposureDisclosures` — **informational only**: ordinary nonzero existing ticker or sector exposure, disclosed for the trader's awareness. Never affects `disposition`, `rank`, or capital sequencing.

Four dispositions are approved this sprint: `RECOMMENDED`, `ACCEPTABLE_ALTERNATIVE`, `WATCH`, `REJECTED`.

## 5. Ranking Policy

**This section reflects a Product Owner correction round.** The original implementation treated any nonzero existing ticker or sector exposure as a disposition-demoting conflict, and assigned final display rank from the pre-evaluation sort order rather than from each candidate's actual computed disposition. Both were rejected and are corrected below.

### 5.1 Disposition rules (`evaluateOpportunityCandidate.ts`), in order

1. `recommendation.status === 'not_recommended'` → **REJECTED**, final, never re-scored or promoted regardless of Opportunity Score.
2. `recommendation.status === 'conditional'` → **WATCH**.
3. `capitalRequired > context.availableCapital` (exceeds the *entire* pool, not just what's left) → **WATCH**.
4. A disposition-changing conflict is present (an **exact** symbol+strategy+expiration duplicate against an existing open position, or against an earlier candidate already accepted in the same batch) → **ACCEPTABLE_ALTERNATIVE**.
5. `capitalRequired > capitalRemainingBeforeThisCandidate` (fits the total pool, but higher-ranked picks in this batch already claimed it) → **ACCEPTABLE_ALTERNATIVE**.
6. Otherwise → **RECOMMENDED**, and only this case reserves capital from the running pool.

Ordinary nonzero existing ticker or sector exposure is **not** one of these rules and never appears in this list — see §5.4.

### 5.2 Evaluation order (`rankOpportunityCandidates.ts`)

Deterministic comparator, in order: Decision Engine status rank (`recommended` < `conditional` < `not_recommended`, always — a hard rejection never climbs the order regardless of score) → Opportunity Score total (desc) → Decision Confidence overall (desc) → candidate `id` (stable string compare, final tie-break). This order sequences which candidate is evaluated (and reserves capital) first; it is **not** necessarily the final display order — see §5.5.

### 5.3 Capital sequencing

Candidates are walked in evaluation order maintaining a single running `capitalRemaining` pool (starting at `context.availableCapital`) and a `Set` of symbol+strategy+expiration keys already seen in this batch (for same-batch duplicate detection). Only `RECOMMENDED` candidates consume capital, naturally implementing "spend the next dollar on the best opportunity first, then the next-best becomes an alternative."

### 5.4 Disposition-changing conflicts vs. informational exposure disclosures (corrected)

These are now strictly separate, both in code (`detectDispositionConflicts()` vs. `buildExposureDisclosures()` in `rankOpportunityCandidates.ts`, and the `conflictDescriptions` vs. `exposureDisclosures` parameters on `evaluateOpportunityCandidate()`) and in the output shape (`portfolioConflicts` vs. `exposureDisclosures` on `OpportunityRecommendation`, see §4.3):

- **Disposition-changing (`portfolioConflicts`, rule §5.1.4):** only an exact symbol+strategy+expiration duplicate against an existing open position or an earlier candidate in the same batch. Rule id: `oe_duplicate_exposure_detected`.
- **Informational only (`exposureDisclosures`):** ordinary nonzero existing ticker exposure (rule id `oe_ticker_exposure_disclosed`) or sector exposure (rule id `oe_sector_exposure_disclosed`). These are surfaced for awareness and **never** change `disposition`, `rank`, or capital consumption. Exposure being greater than zero is not, by itself, evidence of a problem, and this module invents no new concentration threshold of its own.
- **A genuine concentration breach already reaches this module correctly, upstream.** The Decision Engine's own `single-ticker-concentration` and `sector-concentration` concerns (`lib/decision-engine/evaluateSingleCandidate.ts`'s `buildConcerns()`, gated against the account's own configured `maxSingleTickerPct` / `maxSectorPct` limits) are `high`-severity concerns that already push `recommendation.status` to `'conditional'` when a real breach occurs — which rule §5.1.2 already maps to `WATCH`. This module does not need, and must not add, a second, independent "exposure > 0" threshold to catch what the Decision Engine's own canonical gate already catches correctly.

### 5.5 Final display order respects disposition precedence (corrected)

`rankOpportunityCandidates()` now runs two passes:

1. **Evaluation pass** (§5.2/§5.3 order) — decides each candidate's disposition and sequences capital. A candidate's position in this pass is not its final display rank.
2. **Display pass** — the evaluated recommendations are re-sorted by disposition precedence first (`RECOMMENDED` → `ACCEPTABLE_ALTERNATIVE` → `WATCH` → `REJECTED`, always, with no exception), then by the same deterministic tie-break as the evaluation pass (status rank, score, confidence, id) within each disposition group. `rank` is assigned from this final order, 1-indexed.

This guarantees, unconditionally: a `RECOMMENDED` candidate never displays behind an `ACCEPTABLE_ALTERNATIVE`, `WATCH`, or `REJECTED` candidate; an `ACCEPTABLE_ALTERNATIVE` never displays behind `WATCH` or `REJECTED`; and `REJECTED` candidates always display last. This can differ from evaluation order — for example, a high-score candidate evaluated early that gets capital-blocked into `ACCEPTABLE_ALTERNATIVE` can display *after* a lower-score, clean candidate evaluated later that ends up `RECOMMENDED`. See `rankOpportunityCandidates.test.ts` scenarios 16–21 for the regression tests proving this (including reversed-input-order stability for a mixed-disposition batch).

## 6. Candidate Adapters

### 6.1 `decisionAnalysisAdapter.ts` — compatible with real `DecisionAnalysis` output, no production consumer yet

**Correction:** this adapter is compatible with the exact `DecisionAnalysis` shape `runRecommendationEngine()` / `POST /api/autopilot/recommendations` already produces for real Screener/Hunter candidates — but it is not currently invoked by any production code path, and should not be described as "live" or "end-to-end connected." No page or route in this repository calls this adapter today. It is proven correct in isolation (`decisionAnalysisAdapter.test.ts`, run against realistic `DecisionAnalysis` fixtures matching the true production contract), and is ready to be wired in the moment a real `DecisionAnalysis[]` source exists for it to adapt — see §10 for that backlog item.

`decisionAnalysisToOpportunityCandidate()` normalizes a `DecisionAnalysis` into an `OpportunityCandidate`. It re-derives nothing scored: `dte`/`expiration` come from the latest option leg's own expiration date, `earningsRisk` is read from whether the Decision Engine already raised its own `'earnings-risk'` concern (not recomputed date math), and `wheelSuitable` reflects the existing CSP/CC strategy taxonomy. `metadata.source` values outside the four discovery sources (`portfolio`, `autopilot`) map to `'manual'` — documented as unattributed, not guessed at. Returns `null` (never fabricates) for analyses with no underlying candidate (e.g. validation-failure analyses); the batch form `decisionAnalysesToOpportunityCandidates()` accounts for every skipped analysis explicitly, never silently dropping one.

### 6.2 Repeat Trade — unsupported this phase

`app/rinse-repeat/page.tsx`'s candidate types (`SpreadCandidate`, `RRResult`) are page-local and not exported. Adapting them would require refactoring that page to expose a stable candidate contract, which is a broad refactor outside this sprint's frozen scope per §10. Documented here as the sprint's own explicitly allowed "unsupported in this phase" outcome, not silently omitted.

### 6.3 Watchlist — unsupported this phase

No Watchlist candidate model exists anywhere in the repository. Building one from nothing is out of scope for a ranking-layer sprint. Documented as unsupported this phase.

## 7. Read-Only Best Opportunities Surface — built, tested, and intentionally NOT mounted

`components/opportunity-engine/BestOpportunitiesPanel.tsx` is a purely presentational component: it takes an already-ranked `OpportunityRecommendation[]` and renders rank, disposition, score/confidence (read verbatim), and every disclosure array (including the corrected, separate `portfolioConflicts` / `exposureDisclosures`, see §5.4). It fetches nothing, scores nothing, ranks nothing, and contains no trade/execute/submit/order/position-mutation control of any kind (see `BestOpportunitiesPanel.test.tsx`).

**Correction: it is not mounted anywhere in production.** An earlier version of this sprint mounted it as an "Opportunities" sub-tab in `app/engine/page.tsx`, rendering an empty array with a blocker notice. The Product Owner rejected this: an unmounted component with no live consumer is preferable to a production surface with nothing behind it. `app/engine/page.tsx` has been reverted to be byte-identical to `main` — no Opportunities tab, tab button, import, or mount exists there.

The component itself is kept as a finished, tested, reusable building block, ready to be mounted the moment a real page owns a live `DecisionAnalysis[]` feed. Production mounting is recorded as a **future sprint's** work (§10), not this sprint's.

### Production-wiring requirement (why no page mounts it yet)

`app/engine/page.tsx` has no live `DecisionAnalysis[]` to hand this panel without doing one of the following, all of which are out of scope this sprint:

- **Recomputing a `DecisionAnalysis` for the page's existing `SpxSuggestion`/`SpySuggestion`/`WheelSuggestion` objects.** These are produced by a separate, page-local TastyTrade chain scan with its own heuristics — they were never evaluated by `evaluateSingleCandidate()` and carry no Opportunity Score, Decision Confidence, or concerns. Fabricating a `DecisionAnalysis` for them here would violate the sprint's own "never recompute, never fabricate" rule.
- **Running a new server-side or client-side scan** to produce real Screener/Hunter candidates on this page. Screener and Hunter candidates already flow through the Decision Engine via the existing `POST /api/autopilot/recommendations` route — but no page currently calls it, and standing up that call, plus the client-side fetch/state management to keep it live on `/engine`, is new cross-page plumbing the sprint's Safety Requirements exclude.
- **Introducing new cross-page state** (e.g. reading Screener's in-memory results from a different page) — explicitly out of scope.

Wiring a real feed in requires either (a) a future sprint that has a page call the existing `/api/autopilot/recommendations` route with a real candidate batch and holds the resulting `DecisionAnalysis[]` in page state, then mounts this panel, or (b) a future sprint that gives Repeat Trade or Watchlist a stable candidate contract per §6.2/6.3. Both are backlog items (§10), not this sprint's work, and production mounting must not happen with mock data, a new fetch, persistence, or cross-page state as a substitute.

## 8. Testing

54 tests across five files:

`lib/opportunity-engine/__tests__/`:

- `decisionAnalysisAdapter.test.ts` (7 tests) — identity/reference preservation, source-vocabulary mapping, dte/expiration derivation (including the no-legs edge case), earningsRisk derivation (unknown/known-false/known-true), wheel-suitability mapping, null-return for candidate-less analyses, and "never silently dropped" batch accounting.
- `evaluateOpportunityCandidate.test.ts` (9 tests) — the per-candidate disposition contract in isolation: hard-rejection integrity, conditional→WATCH, total-capital ceiling, batch-capital demotion, exact-duplicate-conflict demotion, the clean RECOMMENDED path, verbatim score/confidence passthrough, missing-information disclosure (both directions), and the corrected behavior that ordinary nonzero ticker/sector exposure is disclosed via `exposureDisclosures` without ever demoting disposition.
- `rankOpportunityCandidates.test.ts` (21 tests) — the 16 required batch-ranking scenarios plus 5 correction-round regression scenarios (17–21): a higher-score exact-duplicate alternative never displaying above a clean recommended candidate, a high-score unaffordable WATCH candidate never displaying above an affordable recommended candidate, rejected candidates always appearing after every non-rejected candidate across all four dispositions, reversed-input-order stability for a mixed-disposition batch, and internally-consistent capital/"higher-ranked candidate" explanations.

`components/opportunity-engine/__tests__/`:

- `BestOpportunitiesPanel.test.tsx` (15 tests) — populated recommendations rendering in given order (never re-ranked by the component itself), correct disposition labels, primary reason/score/confidence rendering, `portfolioConflicts` vs. `exposureDisclosures` rendering distinctly, rejection reasons, missing-information disclosures, "what would improve," the empty state, an all-rejected list, absence of any Trade/Execute/Submit/Auto-Trade/order/position-mutation control, and no `fetch` call of any kind.

All `lib/opportunity-engine` fixtures build `OpportunityCandidate`s via the real adapter (`buildOpportunityCandidateFixture()`, `lib/opportunity-engine/__tests__/decisionAnalysisFixture.ts`), not hand-rolled objects, so tests exercise the actual production conversion path. `vitest.config.ts`'s `include` array was extended with `components/**/__tests__/**/*.test.tsx` — the previous config only covered `lib/**` and `features/**`, so the new component test would otherwise never have run under `npm test`.

## 9. Explicitly Out of Scope (per sprint definition)

- No changes to `lib/decision-engine`, `lib/autopilot/scoring`, or any existing scoring formula.
- No new candidate scanning of any kind.
- No changes to `app/rinse-repeat/page.tsx`'s internal candidate model.
- No Watchlist feature.
- No merge to `main`, no changes to `feature/autopilot`.
- PI-0015 / Portfolio Intelligence corrections are not part of this sprint.

## 10. Backlog Items Surfaced During Implementation (not part of this frozen sprint)

- Give a real page (`/engine` or otherwise) a real, live `DecisionAnalysis[]` feed by calling the existing `POST /api/autopilot/recommendations` route and holding results in page state, **then mount `BestOpportunitiesPanel`** against that real feed. This is a future sprint's work, not this sprint's — the component and its tests are ready and waiting for that consumer.
- Give `app/rinse-repeat/page.tsx` a stable, exported candidate contract so Repeat Trade candidates can be adapted into `OpportunityCandidate`.
- Design and build a Watchlist candidate model, then adapt it.
- Consider reconciling `app/engine/page.tsx`'s own heuristic SPX/SPY/Wheel suggestion scans with the canonical Decision Engine, so all candidates on that page eventually carry a real `DecisionAnalysis`.
