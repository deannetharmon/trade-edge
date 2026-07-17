# PI-0012 — Portfolio Review Architecture

Status: Design only. No application code, components, APIs, or business logic were changed to produce this document.
Branch: `feature/portfolio-intelligence`

## Executive Summary

Portfolio Intelligence already computes almost everything a "Portfolio Review" needs. Across eleven prior PI tickets this codebase built: a per-position Health Score, a portfolio-level Health Score that already aggregates ten factors (including two of this ticket's own candidate metrics — average decision confidence and Decision Review follow-up count), a canonical ranked objective list covering both position-level and portfolio-level concerns (concentration, buying power, idle cash, income), a Priority Score ordering layer, a Today's Priorities/Mission Control orchestration layer, a Decision Review outcome-tracking system, and an automatic (but never-persisted, never-fed-back) Decision Outcome Analysis that judges recommendation accuracy once a position closes.

None of that is duplicated in this proposal. Portfolio Review is designed as a thin composition layer — `lib/portfolioReview/` — that reads these existing outputs and adds exactly two genuinely new aggregations that do not exist anywhere today: a trailing realized-performance rollup (win rate, P&L, by strategy, sourced from the existing Trade Log reconstruction) and a portfolio-level Decision Quality rollup (recommendation accuracy rate, sourced from the existing per-review Outcome Analysis). Both are arithmetic over already-computed values — counting, averaging, bucketing — not new scoring models.

The recommendation is to ship this as four small sprints, each independently useful and each keeping "Portfolio Review" a read-only reporting layer, never a second decision engine.

## Goals

- Give the trader a periodic, retrospective view of the whole portfolio — "how are we doing" — distinct from Mission Control's "what needs attention today."
- Compose the view entirely from existing engines wherever an existing engine already answers the question.
- Add new calculations only where no existing module answers the question, and keep those additions narrowly scoped, read-only, and free of any new scoring philosophy.
- Avoid recreating a metric or concept this codebase has already named once (Health, Priority, Confidence, Concentration) under a second name or a second formula.
- Leave every existing recommendation, scoring weight, and API untouched.

## Existing Reusable Capabilities

Everything below already exists, is tested, and can be consumed by Portfolio Review as-is.

**Portfolio Health Score** (`lib/portfolioHealth/portfolioHealth.ts`, PI-0011B) — a 0-100 score with status (`Healthy` / `Needs Attention` / `Action Required`) and top positive/negative contributors, already weighting: immediate-action count, critical-position count, earnings concentration, capital deployment, cash allocation, sector concentration (inert — see Gap Analysis), position concentration, average position health, average decision confidence, and Decision Review follow-up count. This is the headline number Portfolio Review should reuse verbatim rather than recompute.

**Canonical Portfolio Objectives** (`lib/portfolio-intelligence/evaluatePortfolioObjectives.ts` + `adapters/portfolioIntelligenceAdapter.ts`) — the ranked `PortfolioObjective[]` list, already covering both per-position concerns (threatened positions, DTE management, close-for-profit) and portfolio-level concerns: `REDUCE_CONCENTRATION` (symbol and sector, with Wheel-aware exceptions), `PRESERVE_BUYING_POWER` (drawdown circuit breaker + utilization ceiling), `DEPLOY_IDLE_CASH`, `INCREASE_INCOME`. Portfolio Review's "current state" section is a direct read of this list, filtered to portfolio-level `subject.type`s — no re-evaluation.

**Today's Priorities / Mission Control** (`lib/todaysPriorities/`, `features/portfolio/missionControl/MissionControl.tsx`) — already the orchestration precedent this ticket should copy: a page-agnostic module that computes nothing, only buckets and ranks values other modules already produced. Mission Control's five-section layout (Summary, Top Priority, Work Queue, Health, Opportunity Summary) is the direct UI ancestor of a Portfolio Review card.

**Priority Score** (`lib/priorityScore/priorityScore.ts`) — the existing "what deserves attention first" ordering layer. Portfolio Review's "Top Risks" list should reuse `PrioritizedObjective[]` heads exactly as Mission Control's Top Priority section does, not re-rank.

**Concentration & Balances Normalization** (`lib/portfolio-intelligence/adapters/balancesNormalization.ts`) — `derivePositionConcentration()` and `deriveWheelDominance()` already compute per-symbol concentration and Wheel-managed exposure fraction from raw balances. Any "Portfolio Composition" breakdown reuses these functions, never re-derives concentration independently.

**Decision Review + Outcome Tracking** (`lib/decision-review/`) — `DecisionReview` records (trader-logged action, trader-set outcome status) plus `reviewsNeedingFollowUp()`, already surfaced in the Health Score's `decisionReviewFollowUp` factor. `outcomeAnalysis.ts`'s `analyzeDecisionOutcome()` already computes, per review, a `recommendationAccuracy` (`CORRECT` / `INCORRECT` / `INCONCLUSIVE`) by joining Position Snapshot close events to reconstructed Trade Log entries — computed fresh on read, never persisted, never fed back into scoring. This is the raw material for Decision Quality; nothing about how it's computed needs to change.

**Position Snapshot Engine** (`lib/position-snapshot/`) — event-driven lifecycle history (`POSITION_DETECTED` / `RECOMMENDATION_CHANGE` / `POSITION_CLOSE`), already the bridge `outcomeAnalysis.ts` uses to match a Decision Review to a closed trade.

**Trade Log Reconstruction** (`lib/tradeLog/reconstructTrades.ts`) — the shared `ClosedTrade[]` pipeline already used by both the Trade Log and Performance pages, carrying `pnl`, `pnlPct`, `outcome` (`WIN` / `LOSS` / `SCRATCH`), `holdDays`, `strategy`, and a `reconstructionStatus` (`COMPLETE` / `INCOMPLETE`) data-quality flag. No portfolio-level rollup of this data exists yet outside the Performance page's own presentation layer.

**Remaining Opportunity, Management Intent, Decision Quality Matrix** (`lib/portfolio-intelligence/remainingOpportunity.ts`, `managementIntent.ts`, `decisionQualityMatrix.ts`) — the canonical per-position recommendation-selection machinery. Portfolio Review never calls these directly; it only reads their already-computed outputs via `PortfolioObjective.managementIntent` and `.confidence`.

**Portfolio Summary** (`features/portfolio/briefing/portfolioSummary.ts`) — a natural-language presence/absence readout over the same objective list, already the precedent for turning objective types into plain-English lines without any new evaluation.

## Gap Analysis

Two categories of gaps exist: things that need new arithmetic (but not a new engine), and one naming hazard to actively avoid repeating.

**Gap 1 — Trailing realized performance has no portfolio-level rollup.** `reconstructTrades()` produces individual `ClosedTrade` records; the Trade Log and Performance pages render them, but nothing aggregates them into "win rate over the last 90 days," "total realized P&L this quarter," or "P&L by strategy." This is new, but it is pure aggregation (grouping, summing, averaging) over a field set that already exists — not a new scoring model, and not a duplicate of anything, since no such rollup exists today anywhere in the codebase.

**Gap 2 — Recommendation accuracy has no portfolio-level rollup.** `analyzeDecisionOutcome()` already judges a single review's accuracy; `reviewsNeedingFollowUp()` already counts pending reviews whose position has closed. But "what percentage of recommendations we followed turned out correct" does not exist as a portfolio-level statistic anywhere — the closest existing thing, Health Score's `averageDecisionConfidence` factor, measures confidence in current recommendations, not the historical accuracy of past ones. This is a new, additive rollup over `analyzeAllDecisionOutcomes()`'s existing output.

**Gap 3 — No historical trend for the Portfolio Health Score itself.** `calculatePortfolioHealthScore()` is stateless and recomputed fresh every page load; there is no persisted series to show "health over the last 30 days" the way Position Snapshot shows a single position's history. Closing this gap would mean adding a new lightweight, append-only snapshot store mirroring `lib/position-snapshot`'s existing pattern — a real new capability, not a duplicate, but the highest-effort and highest-risk item in this proposal (see Risks), and one this document recommends deferring past the first phases.

**Gap 4 (naming hazard, not a data gap) — "Portfolio Health" already exists twice.** `features/portfolio/briefing/portfolioHealth.ts` (PI-0004D, a three-level `healthy`/`attention`/`action` status derived from the single top-ranked objective) predates and is now superseded in spirit by `lib/portfolioHealth/portfolioHealth.ts` (PI-0011B, the real 0-100 weighted score) — MissionControl's own module doc says as much. The older one is still live, unmodified, on the Briefing tab. Portfolio Review must not introduce a third health concept, a third name, or a third formula; it reuses `lib/portfolioHealth`'s `PortfolioHealthResult` exactly. (Retiring or renaming the older PI-0004D module is out of scope here — flagged for a future, separate cleanup ticket, consistent with "do not change existing business logic.")

**Non-gap — sector concentration.** Both `lib/portfolioHealth` and `evaluatePortfolioObjectives`'s concentration logic already carry a sector-concentration code path that is permanently inert (weight 0 / always-empty `sectorConcentrationPct`) because no sector data source exists anywhere in this codebase. Portfolio Review inherits this same, already-accepted limitation. This is explicitly not something to fix here (would require new market data, which is out of scope).

**Non-gap — strategy-level income/composition mix.** `PortfolioPositionInput.strategy` (BPS/BCS/IC/CSP/CC/STOCK/OTHER) already exists on every position; a "composition by strategy" breakdown is straightforward arithmetic over a field that's already there, not a new data source or new concept.

## Proposed Architecture

A new top-level package, `lib/portfolioReview/`, sitting beside `lib/todaysPriorities/` and `lib/portfolioHealth/` rather than inside `lib/portfolio-intelligence/` — the same reasoning `lib/todaysPriorities`'s own module doc already gives: this module needs to import from `lib/portfolio-intelligence`, `lib/portfolioHealth`, `lib/decision-review`, and `lib/tradeLog`, and putting it inside any one of those would create the exact circular dependency their existing one-way-dependency boundaries were designed to prevent.

```
lib/portfolioReview/
  types.ts                 -- PortfolioReviewSnapshot and its sub-types (new, composition only)
  buildPortfolioReview.ts   -- the one orchestrator function; computes nothing itself
  performanceRollup.ts      -- NEW aggregation: trailing win rate / P&L / by-strategy from ClosedTrade[]
  decisionQualityRollup.ts  -- NEW aggregation: portfolio-level accuracy rate from DecisionOutcomeAnalysis
  index.ts                  -- public surface
```

Dependency direction (one-way, matching every existing PI package):

```
lib/portfolioReview
   -> lib/portfolio-intelligence   (PortfolioObjective[], types only)
   -> lib/portfolioHealth          (PortfolioHealthResult, reused verbatim)
   -> lib/priorityScore            (PrioritizedObjective, reused verbatim)
   -> lib/decision-review          (DecisionReview[], analyzeAllDecisionOutcomes())
   -> lib/tradeLog                 (ClosedTrade[])
   -> lib/portfolio-intelligence/adapters/balancesNormalization (concentration helpers)

lib/portfolio-intelligence, lib/portfolioHealth, lib/decision-review, lib/tradeLog
   -> (never import lib/portfolioReview)
```

`buildPortfolioReview()` is a pure function, no fetch/Redis/React, following every existing orchestrator's shape (`buildTodaysPrioritiesDashboard(input)`, `calculatePortfolioHealthScore(input)`): given already-assembled data, return an already-composed result. The caller (`app/portfolio/page.tsx`) is responsible for supplying `PortfolioObjective[]`, the already-computed `PortfolioHealthResult`, `ClosedTrade[]` (already fetched for Trade Log/Performance), and the Decision Review store + snapshot store (already fetched for Decision History) — nothing new is fetched by this module.

## Data Model

```ts
// lib/portfolioReview/types.ts (proposed, not implemented)

export type PortfolioReviewWindow = '30d' | '90d' | '1y' | 'all';

// -- Current State: 100% reused, zero new calculation --------------------
export interface PortfolioReviewCurrentState {
  health: PortfolioHealthResult;                 // lib/portfolioHealth, reused verbatim
  topRisks: PrioritizedObjective[];               // heads of Immediate Action / Review Today, reused
  concentrationConcerns: PortfolioObjective[];    // REDUCE_CONCENTRATION objectives, reused
  capitalConcerns: PortfolioObjective[];          // PRESERVE_BUYING_POWER / DEPLOY_IDLE_CASH, reused
  incomeConcern: PortfolioObjective | null;       // INCREASE_INCOME, reused
}

// -- Portfolio Composition: thin arithmetic over already-known fields -----
export interface PortfolioReviewComposition {
  positionCount: number;
  byStrategy: Record<PortfolioIntelligenceStrategy, number>;   // count per strategy
  symbolConcentrationPct: Record<string, number>;               // reuses derivePositionConcentration()
  maxSymbolConcentrationPct: number;
  wheelManagedFraction: number;                                 // reuses deriveWheelDominance() aggregate
}

// -- Performance Rollup: NEW aggregation, Gap 1 ---------------------------
export interface PortfolioReviewPerformance {
  window: PortfolioReviewWindow;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  scratchCount: number;
  winRatePct: number | null;            // null when tradeCount is 0 -- never fabricated
  totalRealizedPnl: number;
  avgHoldDays: number | null;
  byStrategy: Record<ClosedTrade['strategy'], { tradeCount: number; winRatePct: number | null; totalPnl: number }>;
  incompleteReconstructionCount: number; // surfaced data-quality caveat, from ClosedTrade.reconstructionStatus
}

// -- Decision Quality Rollup: NEW aggregation, Gap 2 ----------------------
export interface PortfolioReviewDecisionQuality {
  window: PortfolioReviewWindow;
  sampleSize: number;                    // count of reviews with a resolved analysis
  accuracyRatePct: number | null;        // null when sampleSize < MIN_SAMPLE_SIZE -- see Risks
  followedRecommendationRatePct: number | null;
  reviewsNeedingFollowUpCount: number;    // reuses reviewsNeedingFollowUp(), not recomputed
}

export interface PortfolioReviewSnapshot {
  generatedAt: string;
  currentState: PortfolioReviewCurrentState;
  composition: PortfolioReviewComposition;
  performance: PortfolioReviewPerformance;
  decisionQuality: PortfolioReviewDecisionQuality;
}
```

Every field is either a direct pass-through of an existing type (`PortfolioHealthResult`, `PrioritizedObjective`, `PortfolioObjective`) or a plain aggregate primitive (`count`, `Pct`, `Record<string, number>`) — no new nested scoring object, matching this codebase's established preference for "arithmetic over existing evidence" over "a new model."

## UI Layout Proposal

A new top-level tab, not a Mission Control addition — Mission Control is already five sections deep and answers "what do I do today"; Portfolio Review answers "how has this portfolio been doing," a distinct, retrospective question that deserves its own space rather than a sixth Mission Control section.

```
┌─────────────────────────────────────────────────────────────────────┐
│  PORTFOLIO REVIEW                              [30d ▾] [Refresh]    │
├─────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────┐  ┌───────────────────────────────────┐   │
│  │ PORTFOLIO HEALTH       │  │ TOP RISKS                        │   │
│  │  82  Healthy           │  │ • AAPL BPS -- Review Today (91)  │   │
│  │  + No critical pos.    │  │ • TSLA CSP -- Earnings risk (74) │   │
│  │  + BP utilization ok   │  │ • Sector concentration: Tech 41% │   │
│  │  - Idle cash elevated  │  │                                   │   │
│  └───────────────────────┘  └───────────────────────────────────┘   │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ PORTFOLIO COMPOSITION                                         │  │
│  │  14 positions   ·   CSP 6  ·  BPS 4  ·  CC 3  ·  IC 1         │  │
│  │  Max single-symbol: AAPL 18.2%     Wheel-managed: 32%         │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌───────────────────────┐  ┌───────────────────────────────────┐   │
│  │ TRAILING PERFORMANCE   │  │ DECISION QUALITY                 │   │
│  │  (last 30 days)        │  │  (last 30 days)                  │   │
│  │  Win rate: 78% (14/18) │  │  Recommendation accuracy: 71%     │  │
│  │  Realized P&L: +$4,210 │  │       (12 of 17 resolved reviews) │  │
│  │  Avg hold: 11 days     │  │  Followed rec.: 82% of the time   │  │
│  │  ⚠ 2 trades incomplete │  │  3 reviews awaiting follow-up      │  │
│  │    reconstruction      │  │                                   │  │
│  └───────────────────────┘  └───────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

Component-level notes for a future implementation ticket (not built here): the Health and Top Risks cards are near-literal reuses of MissionControl.tsx's existing Portfolio Health section and `<PriorityRankedList>`; Trailing Performance and Decision Quality are the only genuinely new presentation components, and both should render `null`/insufficient-sample states explicitly (e.g., "Not enough resolved reviews yet to show an accuracy rate") rather than a misleading 0% or 100%, matching every existing PI component's "null means not yet available" convention.

## Scoring Proposal

Recommendation: **do not add a new score.** The Portfolio Health Score (`lib/portfolioHealth`) remains the one headline 0-100 number. Portfolio Review's two new metrics — win rate and recommendation accuracy — are reported as plain rates/counts, not folded into a composite "Portfolio Review Score," for three reasons: (1) it directly avoids this ticket's own stated risk (a second layer of calculations drifting from position-level intelligence over time); (2) sample sizes for both new metrics will often be small early on, and a composite score would either need to hide that fragility or expose it awkwardly, whereas a plain rate with a visible sample size ("12 of 17") is self-documenting; (3) Health Score already has a `decisionReviewFollowUp` factor and an `averagePositionHealth`/`averageDecisionConfidence` factor — a second score double-counting the same underlying signals would be exactly the "duplicated concept" this ticket exists to prevent.

If a future ticket does want the two new metrics to influence Health Score directly (e.g., a portfolio with a poor historical accuracy rate should score lower), that is a `lib/portfolioHealth/config.ts` weight/factor addition to the existing engine — not a reason to build a second one. Flagged here as a natural, explicit follow-on, deliberately not decided in this document.

Minimum-sample-size gating (a config value, e.g. `MIN_DECISION_QUALITY_SAMPLE_SIZE = 5`) is recommended for `accuracyRatePct` specifically, mirroring `lib/portfolioHealth`'s own "insufficient data returns null/neutral, never a fabricated number" posture.

## Recommended Implementation Phases

**Phase 1 (PI-0012A) — Current-State Composition.** Build `lib/portfolioReview/types.ts` and `buildPortfolioReview()` covering only `currentState` and `composition` — a pure re-packaging of `PortfolioHealthResult`, `PrioritizedObjective[]`, `PortfolioObjective[]`, and the existing concentration helpers. Zero new metrics. Ship the first version of the UI tab against this alone, so the architecture and layout are validated before any new arithmetic is added. Smallest, lowest-risk phase; validates the composition approach end-to-end.

**Phase 2 (PI-0012B) — Trailing Performance Rollup.** Add `performanceRollup.ts` (Gap 1): win rate, realized P&L, avg hold days, by-strategy breakdown, over a selectable trailing window, sourced from the existing `ClosedTrade[]` the Trade Log/Performance pages already fetch. Wire into the UI's Trailing Performance card.

**Phase 3 (PI-0012C) — Decision Quality Rollup.** Add `decisionQualityRollup.ts` (Gap 2): portfolio-level accuracy rate and followed-recommendation rate, sourced from `analyzeAllDecisionOutcomes()`, with the minimum-sample-size gate described above. Wire into the UI's Decision Quality card.

**Phase 4 (PI-0012D) — Polish & Window Selector.** Time-window switcher (30d/90d/1y/all) across Performance and Decision Quality, empty/loading states, and a pass to confirm nothing in Phases 2-3 introduced any dependency `lib/portfolio-intelligence`, `lib/portfolioHealth`, or `lib/decision-review` would need to import back from `lib/portfolioReview` (preserving the one-way boundary).

Historical Health Score trending (Gap 3) is deliberately not included in these four phases — it requires a new persisted store, not just new arithmetic, and is a reasonable candidate for its own future ticket (PI-0013?) once the read-only composition proves out.

## Risks

**Small sample sizes producing misleading rates.** Both new metrics (win rate, decision accuracy) can be computed from very few data points on a portfolio with few closed trades or few resolved Decision Reviews. Mitigated by the null-below-minimum-sample-size gating described in Scoring Proposal — the existing codebase-wide convention for this exact situation.

**Trade Log reconstruction quality.** `ClosedTrade.reconstructionStatus === 'INCOMPLETE'` rows (best-effort approximations) would silently skew a win-rate/P&L rollup if included without a caveat. Mitigated by surfacing `incompleteReconstructionCount` directly in the UI rather than hiding it, matching this ticket's own "do not fabricate certainty" posture elsewhere in the codebase.

**Strategy bucket coverage.** `ClosedTrade.strategy` is `'BPS' | 'BCS' | 'IC' | 'SPREAD' | 'OTHER'` — narrower than the live-position `PortfolioIntelligenceStrategy` union (`CSP`, `CC`, `STOCK` fold into `'OTHER'` on the Trade Log side). A by-strategy performance breakdown will be coarser than the by-strategy composition breakdown; this is an existing Trade Log limitation, not something to fix as part of this ticket, but worth stating plainly rather than presenting the two breakdowns as if they share one taxonomy.

**Scope creep toward a second scoring engine.** The central risk this whole ticket exists to manage. Mitigated structurally: `lib/portfolioReview` has no `config.ts` of weights, no `calculateXScore()` function, and the Scoring Proposal explicitly recommends against adding one. Any future contributor tempted to add a composite score here should be pointed at `lib/portfolioHealth/config.ts` instead.

**Naming/discoverability collision.** As noted in Gap 4, this codebase already has two things informally called "portfolio health." A third package (`lib/portfolioReview`) sitting near both increases the chance of a future contributor conflating the three. Mitigated by this document's explicit naming and by keeping `lib/portfolioReview` free of any function or type with "health" in its name — it only ever imports and re-displays `PortfolioHealthResult`, never redefines it.

**UI real estate / page proliferation.** The Portfolio page already has seven tabs. An eighth should be justified by genuinely distinct intent (retrospective vs. actionable), which this document argues it is — but worth confirming with the trader before building, since "yet another tab" has its own cost.

## Alternatives Considered

**Extend Mission Control directly with new sections.** Rejected: Mission Control is already five sections and explicitly framed as "what needs my attention today" (see its own module doc); bolting a retrospective Performance/Decision-Quality view onto it would blur that framing and make an already-dense page denser. A separate tab keeps the "today" vs. "how have we been doing" distinction clean, matching how Today's Priorities and Decision History are already split into their own tabs rather than folded into Mission Control.

**Build a new independent Portfolio Review scoring engine.** Rejected outright — this is precisely the outcome the ticket's own rationale warns against. A second engine computing its own version of "health" or "priority" from raw position data would drift from `lib/portfolio-intelligence`'s canonical outputs over time as each is tuned independently, exactly the failure mode described in "Why I'm recommending this."

**Compute Performance and Decision Quality inline in `app/portfolio/page.tsx` rather than a new `lib/` package.** Rejected: every existing orchestration layer in this codebase (Today's Priorities, Portfolio Health, Decision Review) lives in its own page-agnostic `lib/` package precisely so it stays independently testable and reusable outside the Portfolio page's 10,000+ line file. Following that precedent is both consistent and, given the page's existing size, actively necessary.

**Fold Decision Quality's accuracy rate directly into Portfolio Health Score's existing `averageDecisionConfidence` factor, skipping a separate rollup entirely.** Considered as a lighter-weight alternative to a full `decisionQualityRollup.ts` module. Not recommended for Phase 1-4 because confidence (a property of current, unresolved recommendations) and accuracy (a property of past, resolved ones) are genuinely different questions — conflating them would itself be the kind of duplicated-concept-under-one-name this ticket is trying to avoid. Kept as two distinct, clearly-labeled numbers instead.

## Final Recommendation

Build `lib/portfolioReview/` as a thin, read-only composition layer with no scoring config of its own, phased as PI-0012A through PI-0012D above. Reuse `lib/portfolioHealth`, `lib/todaysPriorities`/`lib/priorityScore`, `lib/portfolio-intelligence`'s objective list, and the concentration helpers verbatim for everything they already answer. Add exactly two new, narrowly-scoped aggregations — trailing performance and decision-quality rollups — both gated on minimum sample size and both surfacing their own data-quality caveats rather than presenting false precision. Ship Phase 1 alone first to validate the composition-only architecture and the new tab's layout before adding either new aggregation. Do not add a composite "Portfolio Review Score" — Portfolio Health Score remains the one headline number, with Performance and Decision Quality as supporting, plainly-labeled rates.
