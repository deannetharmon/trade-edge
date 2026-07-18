# OE-0001 — Opportunity Engine Foundation

**Status:** Implemented, pending Product Owner review
**Branch:** `feature/opportunity-engine-foundation`
**Base:** `main` @ `a86c92dc72470ccdeb7221ceb6aa11a27cf1d7a5`
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

One ranked result: `rank`, `disposition`, the `opportunityScoreTotal` / `decisionConfidenceTotal` read verbatim from the candidate's `DecisionAnalysis`, and disclosure arrays (`supportingFactors`, `riskTradeoffs`, `portfolioConflicts`, `rejectionReasons`, `missingInformationDisclosures`, `whatWouldImprove`) built only from evidence that already exists on the analysis or from this module's own capital/conflict comparison. `decisionAnalysisId` and `ruleIds` provide traceability back to the source evaluation.

Four dispositions are approved this sprint: `RECOMMENDED`, `ACCEPTABLE_ALTERNATIVE`, `WATCH`, `REJECTED`.

## 5. Ranking Policy

### 5.1 Disposition rules (`evaluateOpportunityCandidate.ts`), in order

1. `recommendation.status === 'not_recommended'` → **REJECTED**, final, never re-scored or promoted regardless of Opportunity Score.
2. `recommendation.status === 'conditional'` → **WATCH**.
3. `capitalRequired > context.availableCapital` (exceeds the *entire* pool, not just what's left) → **WATCH**.
4. A known conflict is disclosed (exact symbol+strategy+expiration duplicate against an existing position or an earlier candidate in the same batch, known ticker exposure, or known sector exposure) → **ACCEPTABLE_ALTERNATIVE**.
5. `capitalRequired > capitalRemainingBeforeThisCandidate` (fits the total pool, but higher-ranked picks in this batch already claimed it) → **ACCEPTABLE_ALTERNATIVE**.
6. Otherwise → **RECOMMENDED**, and only this case reserves capital from the running pool.

### 5.2 Sort order (`rankOpportunityCandidates.ts`)

Deterministic comparator, in order: Decision Engine status rank (`recommended` < `conditional` < `not_recommended`, always — a hard rejection never climbs the order regardless of score) → Opportunity Score total (desc) → Decision Confidence overall (desc) → candidate `id` (stable string compare, final tie-break). Reversing the input array or re-running the same batch always produces the same output.

### 5.3 Capital sequencing

Candidates are walked in sorted order maintaining a single running `capitalRemaining` pool (starting at `context.availableCapital`) and a `Set` of symbol+strategy+expiration keys already seen in this batch (for same-batch duplicate detection). Only `RECOMMENDED` candidates consume capital, naturally implementing "spend the next dollar on the best opportunity first, then the next-best becomes an alternative."

## 6. Candidate Adapters

### 6.1 `decisionAnalysisAdapter.ts` — real, connected

The one adapter this sprint connects end-to-end. `decisionAnalysisToOpportunityCandidate()` normalizes an already-computed `DecisionAnalysis` (the shape produced today by `runRecommendationEngine()` / `POST /api/autopilot/recommendations` for real Screener/Hunter candidates) into an `OpportunityCandidate`. It re-derives nothing scored: `dte`/`expiration` come from the latest option leg's own expiration date, `earningsRisk` is read from whether the Decision Engine already raised its own `'earnings-risk'` concern (not recomputed date math), and `wheelSuitable` reflects the existing CSP/CC strategy taxonomy. `metadata.source` values outside the four discovery sources (`portfolio`, `autopilot`) map to `'manual'` — documented as unattributed, not guessed at. Returns `null` (never fabricates) for analyses with no underlying candidate (e.g. validation-failure analyses); the batch form `decisionAnalysesToOpportunityCandidates()` accounts for every skipped analysis explicitly, never silently dropping one.

### 6.2 Repeat Trade — unsupported this phase

`app/rinse-repeat/page.tsx`'s candidate types (`SpreadCandidate`, `RRResult`) are page-local and not exported. Adapting them would require refactoring that page to expose a stable candidate contract, which is a broad refactor outside this sprint's frozen scope per §10. Documented here as the sprint's own explicitly allowed "unsupported in this phase" outcome, not silently omitted.

### 6.3 Watchlist — unsupported this phase

No Watchlist candidate model exists anywhere in the repository. Building one from nothing is out of scope for a ranking-layer sprint. Documented as unsupported this phase.

## 7. Read-Only Best Opportunities Surface

`components/opportunity-engine/BestOpportunitiesPanel.tsx` is a purely presentational component: it takes an already-ranked `OpportunityRecommendation[]` and renders rank, disposition, score/confidence (read verbatim), and every disclosure array. It fetches nothing, scores nothing, and ranks nothing itself.

It is mounted as a new **Opportunities** sub-tab inside the existing `app/engine/page.tsx` ("Income Engine") experience, per the sprint's instruction to add the surface to the existing Engine experience.

### Production-wiring blocker (reported, not routed around)

The panel renders today with an **empty recommendations array** and an explicit, honest `blockerNotice`, because `app/engine/page.tsx` has no live `DecisionAnalysis[]` to hand it without doing one of the following, all of which are out of scope this sprint:

- **Recomputing a `DecisionAnalysis` for the page's existing `SpxSuggestion`/`SpySuggestion`/`WheelSuggestion` objects.** These are produced by a separate, page-local TastyTrade chain scan with its own heuristics — they were never evaluated by `evaluateSingleCandidate()` and carry no Opportunity Score, Decision Confidence, or concerns. Fabricating a `DecisionAnalysis` for them here would violate the sprint's own "never recompute, never fabricate" rule.
- **Running a new server-side or client-side scan** to produce real Screener/Hunter candidates on this page. Screener and Hunter candidates already flow through the Decision Engine via the existing `POST /api/autopilot/recommendations` route — but no page currently calls it, and standing up that call, plus the client-side fetch/state management to keep it live on `/engine`, is new cross-page plumbing the sprint's Safety Requirements exclude.
- **Introducing new cross-page state** (e.g. reading Screener's in-memory results from a different page) — explicitly out of scope.

The panel and the tab are fully built and ready. Wiring a real feed in requires either (a) a future sprint that has `/engine` call the existing `/api/autopilot/recommendations` route with a real candidate batch and holds the resulting `DecisionAnalysis[]` in page state, or (b) a future sprint that gives Repeat Trade or Watchlist a stable candidate contract per §6.2/6.3. Both are backlog items, not this sprint's work.

## 8. Testing

32 tests across three files in `lib/opportunity-engine/__tests__/`:

- `decisionAnalysisAdapter.test.ts` — identity/reference preservation, source-vocabulary mapping, dte/expiration derivation (including the no-legs edge case), earningsRisk derivation (unknown/known-false/known-true), wheel-suitability mapping, null-return for candidate-less analyses, and "never silently dropped" batch accounting.
- `evaluateOpportunityCandidate.test.ts` — the per-candidate disposition contract in isolation: hard-rejection integrity, conditional→WATCH, total-capital ceiling, batch-capital demotion, conflict demotion, the clean RECOMMENDED path, verbatim score/confidence passthrough, and missing-information disclosure (both the fabricate-nothing-when-known and disclose-when-unknown directions).
- `rankOpportunityCandidates.test.ts` — the 16 required batch-ranking scenarios: score ordering, the hard-rejection-never-outranks regression (a `not_recommended` candidate given a deliberately high score of 95 still sorts and dispositions as rejected), conditional mid-ordering, sequential capital reservation, total-capital-ceiling WATCH, existing-position duplicate detection, same-batch duplicate detection (demoting only the lower-ranked twin), ticker exposure disclosure, sector exposure disclosure (known vs. unknown sector), id-based tie-break stability under array reversal, full-batch re-run stability, confidence-based tie-break, sequential rank assignment, cross-source neutrality, empty-batch handling, and a full end-to-end composition scenario exercising all of the above together.

All fixtures build `OpportunityCandidate`s via the real adapter (`buildOpportunityCandidateFixture()`, `lib/opportunity-engine/__tests__/decisionAnalysisFixture.ts`), not hand-rolled objects, so tests exercise the actual production conversion path.

## 9. Explicitly Out of Scope (per sprint definition)

- No changes to `lib/decision-engine`, `lib/autopilot/scoring`, or any existing scoring formula.
- No new candidate scanning of any kind.
- No changes to `app/rinse-repeat/page.tsx`'s internal candidate model.
- No Watchlist feature.
- No merge to `main`, no changes to `feature/autopilot`.
- PI-0015 / Portfolio Intelligence corrections are not part of this sprint.

## 10. Backlog Items Surfaced During Implementation (not part of this frozen sprint)

- Give `/engine` (or a new page) a real, live `DecisionAnalysis[]` feed by calling the existing `POST /api/autopilot/recommendations` route and holding results in page state, so the Best Opportunities panel can render live data.
- Give `app/rinse-repeat/page.tsx` a stable, exported candidate contract so Repeat Trade candidates can be adapted into `OpportunityCandidate`.
- Design and build a Watchlist candidate model, then adapt it.
- Consider reconciling `app/engine/page.tsx`'s own heuristic SPX/SPY/Wheel suggestion scans with the canonical Decision Engine, so all candidates on that page eventually carry a real `DecisionAnalysis`.
