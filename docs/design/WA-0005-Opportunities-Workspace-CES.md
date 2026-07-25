# WA-0005 — Opportunities Workspace CES

**Status:** Product Owner accepted and frozen. Implementation authorized against §20's Acceptance Criteria and §26's Proposed Implementation Sequence, without further design escalation.
**Branch:** `feature/wa-0005-opportunities-workspace-design`, based on `main`/`origin/main` @ `f0b884dea5d0d3d2f2324e92e525f6a8f079f584` (WA-0004 merged).
**Author:** Dane (Lead Engineer).
**Depends on:** OE-0001 (`docs/design/OE-0001-Opportunity-Engine-Foundation.md`), OE-0002A (`docs/design/OE-0002A-Opportunity-Engine-Activation.md`), OE-0002B (`docs/design/OE-0002B-Recommendation-Service-Foundation.md`), TC-0001 (`docs/design/TC-0001-Trade-Command-Center.md`), MB-0002 (`docs/design/MB-0002-Mission-Control-Implementation.md`), WA-0001 (`docs/design/WA-0001-Workspace-Content-Ownership-Audit.md`), WA-0003 (`docs/design/WA-0003-Todays-Priorities-Finite-Queue-CES.md`), WA-0004 (`docs/design/WA-0004-Briefing-Separation-CES.md`).
**Precedes:** WA-0006 (Legacy Priority List retirement) — untouched by this CES.

---

## 1. Executive Summary

WA-0001's Final Product Ruling 2 (§7) already decided *where* the Opportunities workspace lives: **the existing `/screener` route becomes the Opportunities workspace, as-is — no new page, no new route.** `/screener` already scans the market, ranks candidates through the canonical Opportunity Engine (`lib/opportunity-engine`), and renders the real, tested `BestOpportunitiesPanel`. WA-0005 does not reopen that ruling.

This corrected draft resolves, as **binding Product Owner rulings** (§10), the two decisions the prior draft had left open:

- **Ruling 1 (available capital):** `OpportunityContext.availableCapital` stays `0` — unchanged design, unchanged Opportunity Engine behavior. WA-0005 instead adds a required, persistent, non-dismissible capital-limitation notice next to the ranked Opportunities presentation, and forbids the UI from implying "nothing worth considering exists" merely because `RECOMMENDED` is currently unreachable. Canonical capital integration is deferred to **OE-0003** (already tracked in `planning/SPRINT_STATUS.md` and `docs/roadmap/ROADMAP.md` as "wire real, portfolio-mode-gated capital/exposure data into `OpportunityContext`, once `/screener`'s PortfolioMode gating question is resolved" — the same scope this CES would otherwise have re-invented).
- **Ruling 2 (`/screener` information hierarchy):** the page is reordered to scan controls → Ranked Opportunities → "All Scan Results," preserving every existing scan mechanic untouched.

Both rulings are recorded as resolved, binding decisions in §10 — **this CES ends with zero unresolved Product Owner decisions required to freeze.**

This corrective round also fixed five internal-consistency defects the prior draft's acceptance review found: a missing Acceptance Criteria section (§20); a self-contradictory "no qualifying opportunities" contract that conflated an all-`REJECTED` result with a genuinely empty one (§15); a self-contradictory candidate-detail contract ("required" vs. "optional") that additionally cited an unverified passthrough claim — verified here to require a real, narrowly-scoped, additive presentation-only seam, not a simple field check (§13); an unspecified staleness threshold (§16); and a citation of `id="best-opportunity"` as though it existed on `/screener`, when repository verification shows that id exists only on Mission Control's own section wrapper (`components/mission-control/NewOpportunitiesSection.tsx:21`) and on the orphaned `components/command-center/CommandCenter.tsx:31` — never on `/screener` itself (§17).

---

## 2. Problem Statement

Per the sprint sequence (WA-0001 → WA-0002 → WA-0003 → WA-0004, all merged), Opportunities is the last of the five frozen workspaces (Mission Control, Today's Priorities, Briefing, Positions, Opportunities) without its own CES. Unlike the other four, its physical location was already decided by WA-0001 (`/screener`, no new route) — but no CES has since verified that `/screener`'s current OE-0002A-era wiring genuinely satisfies "the full Opportunities workspace experience" WA-0001 assumed, documented its real state/truthfulness contract, or resolved the Mission Control drift discovered during this investigation (§5.3). Without this CES, WA-0005's implementation phase (not yet authorized) would have no binding source of ownership, presentation, or safety rules to build against — the same gap WA-0002/WA-0003/WA-0004 each closed for their respective workspaces.

---

## 3. Accepted Product Outcome

Opportunities answers: **"What new trades are worth considering, why, and what should I inspect before deciding whether to act?"** It is a discovery-and-evaluation workspace, not a position-management surface, not an action queue, not a briefing, and not a second scoring engine. Per `lib/autopilot/decision/types.ts` metadata (`executionAllowed: false`, `paperExecutionAllowed: false` on every `DecisionAnalysis`), **trade execution is out of scope for this entire codebase today, not merely this sprint** — no existing, approved order-submission workflow exists anywhere for the Opportunity Engine to hand off to. WA-0005 does not design order submission.

---

## 4. User Jobs and Primary Questions

- "Are there any new trades worth looking at right now?" (discovery)
- "Why is this one ranked above that one?" (ranking transparency)
- "What's actually wrong with this candidate — rejected outright, or just risky?" (disposition legibility)
- "Is this data current, or am I looking at a stale scan?" (freshness/trust)
- "What would I need to check before I'd actually consider this?" (informed evaluation, not execution)
- "Did the scan run and find nothing, or did it not run at all?" (absence-of-signal vs. confirmed-empty — §15)
- "Why don't I see any Recommended picks — is that a data gap or a quality judgment?" (capital-limitation legibility — §10.1, new)

---

## 5. Current-State Repository Findings

### 5.1 Opportunity Engine foundation (`lib/opportunity-engine/`) — re-verified

Files: `types.ts`, `ruleIds.ts`, `evaluateOpportunityCandidate.ts`, `rankOpportunityCandidates.ts`, `adapters/decisionAnalysisAdapter.ts`, `index.ts`, plus `__tests__/` (39 tests across adapter/per-candidate/batch-rank suites).

- **`OpportunityCandidateSource`** (`types.ts:27-32`) = `'screener' | 'hunter' | 'repeat_trades' | 'watchlist' | 'manual'`. Only `'screener'` has a real producer today (§5.2) — `'hunter'` is a placeholder for provenance labeling with no adapter behind it (there is no separate Hunter surface, §5.2).
- **`OpportunityDisposition`** (`types.ts:37-41`), confirmed by direct read of the type definition = `'RECOMMENDED' | 'ACCEPTABLE_ALTERNATIVE' | 'WATCH' | 'REJECTED'`, in exactly that display-precedence order.
- **`OpportunityCandidate`** (`types.ts:49-84`) carries `decisionAnalysis: DecisionAnalysis` verbatim, plus its own narrower fields (`id`, `source`, `symbol`, `strategy`, `expiration?`, `dte?`, `capitalRequired`, `sector?`, `earningsRisk?`, `wheelSuitable?`, `navigationMetadata?`) — the Opportunity Engine never recomputes score, confidence, or disposition itself; it only sequences and gates candidates already evaluated by `lib/decision-engine`.
- **`OpportunityContext`** (`types.ts:92-113`), confirmed by direct read: `{ availableCapital: number; netLiquidity?; existingTickerExposure?; existingStrategyExposure?; existingSectorExposure?; existingOpenPositionKeys?; portfolioRiskPosture?; generatedAt: string }`. `availableCapital` is a required, non-optional `number` field — no default in the type itself; **the hardcoded `0` is a call-site decision**, confirmed at `lib/command-center/screenerOpportunityRecommendations.ts:49` (`buildOpportunityRecommendations(analyses, { availableCapital: 0, generatedAt })`), the sole real call site feeding both `/screener` and (via `RecommendationService`) `/dashboard`.
- **`OpportunityRecommendation`** (`types.ts:119-165`), confirmed by direct read — **critical finding not previously verified**: this output type carries **no** candidate-shape fields at all. It has `candidateId`, `source`, `symbol`, `strategy`, `rank`, `disposition`, `opportunityScoreTotal`, `decisionConfidenceTotal`, `primaryReason`, `supportingFactors[]`, `riskTradeoffs[]`, `portfolioConflicts[]`, `exposureDisclosures[]`, `rejectionReasons[]`, `missingInformationDisclosures[]`, `whatWouldImprove[]`, `decisionAnalysisId`, `ruleIds[]` — **no expiration, DTE, strikes, underlying price, credit/debit, capital requirement, return measures, probability/delta, volatility, or earnings fields**. `rankOpportunityCandidates.ts:201-204` confirms the mapping: `displayOrder.map((item) => ({ ...item.recommendation, rank }))` — the richer `OpportunityCandidate`/`DecisionAnalysis` objects are never carried through to the returned array, only their id strings (`decisionAnalysisId`, `candidateId`) for traceability. This directly falsifies the prior draft's §12 claim that field passthrough was "confirm at implementation time" — it is a real, verified gap requiring a new seam (§13).
- **The one real adapter**, `decisionAnalysisToOpportunityCandidate()` / `decisionAnalysesToOpportunityCandidates()` (`adapters/decisionAnalysisAdapter.ts`), normalizes `DecisionAnalysis[]` into `OpportunityCandidate[]`, returning `null` (never fabricating) for candidates it cannot represent. No Repeat-Trade or Watchlist adapter exists — explicitly out of scope per OE-0001 §6.2/6.3.
- **Ranking is genuinely two-pass** (`rankOpportunityCandidates.ts`), confirmed by both the implementation and 21 batch-ranking tests:
  - *Pass 1 (evaluation order):* candidates are sorted by Decision Engine status rank → opportunity score desc → confidence desc → id tiebreak, then walked in that order while `evaluateOpportunityCandidate()` consumes a running `capitalRemaining` pool and tracks `symbol::strategy::expiration` duplicates.
  - *Pass 2 (display order):* the evaluated recommendations are re-sorted purely by `DISPOSITION_SORT_RANK` (RECOMMENDED=0, ACCEPTABLE_ALTERNATIVE=1, WATCH=2, REJECTED=3), then the same tiebreak, and `rank` is assigned 1-indexed from that order.
  - **Confirmed: no candidate is ever dropped from the returned array** — `displayOrder` is a re-sort of the exact same `evaluated` set built in Pass 1, one entry per input candidate. `REJECTED` candidates are never filtered out by `rankOpportunityCandidates` itself (§15's "no qualifying opportunities" contract depends on this).
  - This split is load-bearing: a high-score candidate evaluated first (and thus given first claim on capital) can still be demoted to `ACCEPTABLE_ALTERNATIVE`, and Pass 2 guarantees a demoted candidate never displays above a clean `RECOMMENDED` one evaluated later (test scenarios 16–21).
- **Disposition rules** (`evaluateOpportunityCandidate.ts`), in order: Decision Engine `not_recommended` → `REJECTED` (final); Decision Engine `conditional` → `WATCH`; exceeds the entire capital pool → `WATCH`; exact symbol+strategy+expiration duplicate → `ACCEPTABLE_ALTERNATIVE`; capital already claimed by a higher-ranked pick → `ACCEPTABLE_ALTERNATIVE`; otherwise → `RECOMMENDED` (only this branch consumes capital). **With `availableCapital: 0`, "exceeds the entire capital pool" is true for every candidate that would otherwise reach `RECOMMENDED`, so the only way a candidate can still reach `RECOMMENDED` today is if it requires exactly `0` capital — a degenerate case; in practice `RECOMMENDED` is unreachable, confirmed unchanged from the prior draft's finding.**
- **Confidence/score are never recalculated**: `opportunityScoreTotal: analysis.opportunityScore?.total ?? null`, `decisionConfidenceTotal: analysis.confidence.overall`, read straight through.
- **Rule identifiers** (`ruleIds.ts`, `OE_RULE_IDS`): `hardRejectedByDecisionEngine`, `conditionalByDecisionEngine`, `insufficientTotalCapital`, `capitalConsumedByHigherRanked`, `duplicateExposureDetected` (disposition-changing), `missingSectorDisclosure`/`missingEarningsDisclosure`/`tickerExposureDisclosed`/`sectorExposureDisclosed` (informational-only, never disposition-changing), `recommendedTopPick`.
- **Test-verified correction round:** ordinary nonzero ticker/sector exposure is disclosed but never demotes disposition (scenarios 8–9); disposition precedence always wins over raw evaluation order at display time (scenarios 16–21); a hard-rejected candidate with a deliberately high score never outranks a clean recommended one (scenario 2); reversing candidate input order produces identical output (scenarios 11, 20).

### 5.2 Discovery surfaces — what's real, what isn't

- **`/screener`** (`app/screener/page.tsx`, ~6,200+ lines): the real discovery surface. Internally still named "Hunter" throughout (`localStorage` keys `hunter-*`, IndexedDB name `hunter-db`, comments referring to "Run Hunter") — **"Hunter" is not a separate surface; it is Screener's legacy internal branding.** `OpportunityCandidateSource` includes `'hunter'` as a type placeholder only; no route or adapter produces it. `components/command-center/CommandCenterNav.tsx` links to `/screener` under the label `"Screener / Hunter"`, confirming this.
- **`/rinse-repeat`** (Repeat Trade): a real, separate page with its own page-local, non-exported candidate types (`SpreadCandidate`, `RRResult`). OE-0001 §6.2 explicitly scoped it out: "adapting them would require refactoring that page to expose a stable candidate contract... outside this sprint's frozen scope." It shares spread-finding logic with Screener (a code-reuse comment reading "copied from Hunter") but has no Opportunity Engine adapter and does not import `BestOpportunitiesPanel`.
- **`/engine`** ("Income Engine"): its SPX/SPY/Wheel suggestion cards are produced by a page-local TastyTrade chain-scan heuristic (delta targeting, credit ratio, POP approximation) that never touches `evaluateSingleCandidate()`. It does not import `BestOpportunitiesPanel`. This is the page OE-0001 originally tried and failed to mount the panel on (§5.4).
- **Conclusion: no genuine "Hunter" surface exists to reconcile.** Repeat Trade and Income Engine are real, separate, differently-scoped surfaces that legitimately do not participate in the Opportunity Engine today — WA-0005 does not attempt to unify them (see §23 Out-of-Scope, §25 Deferred).

### 5.3 `BestOpportunitiesPanel` — actual mount status and rendering, re-verified

`components/opportunity-engine/BestOpportunitiesPanel.tsx` is purely presentational: no fetch, no scoring, no interactive elements (no button/input/select/form/anchor), verified by direct read of the full file (177 lines) and its own 15-test suite. **Confirmed: it has no `id` attribute anywhere in the file** — any anchor id associated with "Best Opportunities" comes only from whatever wraps it (§5.8, §17).

Its top-of-file comment still claims **"STATUS: intentionally NOT mounted anywhere in production"** — this is stale and must not be relied on. A repo-wide import grep shows it is mounted in three places:

1. **`app/screener/page.tsx`** (import line 56, mount ~line 6231) — via OE-0002A, gated on `results.length > 0`, directly beneath `SmartSuggestionsPanel`, passed `recommendations={opportunityRecommendations}`, `generatedAt={opportunityGeneratedAt}`, `th`, and `blockerNotice` (set to the error message when `opportunityState === 'error'`, or `'Ranking opportunities from these scan results…'` when `'loading'`, else `undefined`).
2. **`components/mission-control/NewOpportunitiesSection.tsx`** (import line 11, mount line 23) — via MB-0002, rendered inside `MissionControl` on the current `/dashboard`. Its header comment states it "reuses the existing, tested `BestOpportunitiesPanel` (OE-0001) *verbatim*."
3. **`components/command-center/BestOpportunityCard.tsx`** (TC-0001's original mount) — but this component tree is **orphaned**: `components/command-center/CommandCenter.tsx` (which contains it) is not imported by any page (confirmed by grep; only its own test file references it). MB-0002 replaced it on `/dashboard`.

**Component behavior, verified by direct read (`BestOpportunitiesPanel.tsx:147-176`, `RecommendationCard`, lines 52-145):**
- **Props (exact):** `{ recommendations: OpportunityRecommendation[]; generatedAt?: string; th: (typeof THEMES)[Theme]; blockerNotice?: string }`.
- **Empty state:** `recommendations.length === 0` renders a single bordered box, "No ranked opportunities to display." — this fires whenever the array is empty for *any* reason (zero evaluated candidates, evaluation failure upstream with no fallback, etc.) — it does **not** distinguish "scan found nothing" from "nothing was recommendable" from "evaluation failed," because those are all upstream states the panel itself has no visibility into. Since `rankOpportunityCandidates` never drops `REJECTED` candidates (§5.1), an all-`REJECTED` result is **never** empty at this component — it renders every `REJECTED` card with its `rejectionReasons`. The prior draft's §14 state table conflated these; corrected in §15.
- **Loading/error state:** the `blockerNotice` prop renders as a single amber-tinted banner above the recommendation list (or empty state) — the panel itself has no internal loading/error state machine; that entirely belongs to the caller (`app/screener/page.tsx`'s `opportunityState`/`opportunityError`).
- **Per-candidate fields actually rendered by `RecommendationCard`:** rank badge (`#rec.rank`), symbol, strategy, source, disposition pill (color class + `DISPOSITION_LABEL` text — non-color-only already satisfied), `opportunityScoreTotal` (or `—` if null), `decisionConfidenceTotal` (`.toFixed(0)`), `primaryReason`, `supportingFactors[]` (prefixed `+`), `riskTradeoffs[]` (prefixed `~`, amber), `portfolioConflicts[]` (prefixed `⚠`, blue — disposition-changing), `exposureDisclosures[]` (prefixed `ℹ`, muted — informational-only, visually distinct from `portfolioConflicts`), `rejectionReasons[]` (prefixed `✕`, red), `missingInformationDisclosures[]` (prefixed `?`, italic), `whatWouldImprove[]` (italic, joined string).
- **Fields on the type but never rendered by this component today:** none — every field on `OpportunityRecommendation` is rendered.
- **Fields not present on `OpportunityRecommendation` at all, and therefore not rendered today under any circumstance:** expiration, DTE, strikes, underlying price, credit/debit, capital requirement, return measures, probability/delta, volatility context, earnings/event context — confirmed absent from the type itself (§5.1), not merely unrendered.

**Finding — Mission Control contradicts WA-0001's own binding ruling.** WA-0001's Ownership Matrix (§3, quoted in §6 below) rules: `/screener` owns the full panel; `/dashboard`'s duplicate full panel is **removed**; Mission Control keeps **"a compact count, not the panel."** The current implementation of `NewOpportunitiesSection.tsx` does the opposite — it mounts the full `BestOpportunitiesPanel` verbatim on `/dashboard`. This predates WA-0001's audit (MB-0002 built it before or concurrently with the audit) and was not corrected by WA-0002 (scoped to Positions/legacy Mission Control cleanup, not opportunities). This is an outstanding implementation gap against an already-binding ruling — see §9 (Component Reuse/Retirement Recommendations) for the resolution, made directly in this CES since WA-0001 already settled the product question; only the timing of the fix is new.

### 5.4 Why the panel was originally unmounted, and the real activation chain

Per `docs/design/OE-0001-Opportunity-Engine-Foundation.md` §7 and `docs/reviews/OE-0001-Implementation-Report.md` §10.1: an early OE-0001 round mounted `BestOpportunitiesPanel` on `app/engine/page.tsx`, rendering an empty array with a blocker notice, because `/engine` had no real `DecisionAnalysis[]` feed. **The Product Owner rejected this**: "an unmounted component with no live consumer is preferable to a production surface with nothing behind it." `app/engine/page.tsx` was reverted to be byte-identical to `main`. The component was kept, fully tested, waiting for a real feed.

Activation chain, in order:
- **OE-0002A** (merged `7acb641`) added `lib/command-center/screenerOpportunityRecommendations.ts` and wired `/screener` to `POST /api/autopilot/recommendations` on every scan-results change, translating and mounting the panel. `OpportunityContext.availableCapital` was **hardcoded to `0`**, deliberately, since `/screener` is not PortfolioMode-gated. Confirmed at `lib/command-center/screenerOpportunityRecommendations.ts:48-51`.
- **OE-0002B** added `lib/recommendations/RecommendationService.ts`, an in-memory pub-sub singleton (`RecommendationSet = { analyses: DecisionAnalysis[]; generatedAt: string | null }`) so Screener (producer) publishes raw `DecisionAnalysis[]` and any consumer (e.g. Dashboard) reads it via `useCurrentRecommendations()`. **Confirmed by direct read (`RecommendationService.ts`): the full, unstripped `DecisionAnalysis[]` — including every candidate's `expectedOutcome`, `candidate?: AutopilotCandidate`, `alternatives[]`, `reviewTriggers[]`, and `concerns[]` — is already held in this service and already reachable by both `/screener` (its own local `rawAnalyses` variable, published at `app/screener/page.tsx:5551`) and `/dashboard` (via `useCurrentRecommendations()`).** This is the basis for the candidate-detail seam design in §13 — no new data acquisition is required, only a new, additive, presentation-only index keyed by `decisionAnalysisId`.
- **TC-0001** first mounted the panel in production on the original `/dashboard`, via `BestOpportunityCard`/`CommandCenter` — now orphaned (§5.3).
- **MB-0002** replaced TC-0001's `CommandCenter` with `MissionControl` on `/dashboard`; `NewOpportunitiesSection` reuses `BestOpportunitiesPanel` verbatim, carrying forward TC-0001's `id="best-opportunity"` anchor (referenced by `CommandCenterNav.tsx`'s "Opportunity Review" link).

### 5.5 Actual current data flow, end-to-end

```
User runs a Screener scan → setResults(ScreenResult[])
  → useEffect in app/screener/page.tsx (~line 5516–5564) fires
  → POST /api/autopilot/recommendations → DecisionAnalysis[]
  → opportunityRecommendationsFromApiResponse(body) [lib/command-center/screenerOpportunityRecommendations.ts]
      → buildOpportunityRecommendations(analyses, { availableCapital: 0, generatedAt })
  → renders on /screener via BestOpportunitiesPanel (live, real)
  → simultaneously: publishRecommendations(rawAnalyses, generatedAt) → RecommendationService

app/dashboard/page.tsx (MissionControl, current /dashboard):
  → useCurrentRecommendations() reads the same published DecisionAnalysis[]
  → buildOpportunityRecommendations(analyses, { availableCapital: 0, generatedAt })
  → NewOpportunitiesSection → same BestOpportunitiesPanel
```

This is genuinely wired end-to-end, not scaffolding — a real scan on `/screener` populates real ranked cards on both `/screener` and `/dashboard`, client-side navigation only (no hard-reload persistence, `RecommendationService` is in-memory). **`availableCapital: 0` is hardcoded on both consumers** — per `evaluateOpportunityCandidate.ts`'s rules (§5.1), a candidate can only reach `RECOMMENDED` by successfully consuming capital from the pool; with a `0`-sized pool, **no candidate can reach `RECOMMENDED` disposition in either live consumer today.** Both implementation reports treat this as intentional, honest behavior (a portfolio-neutral view), not a defect. **Per Ruling 1 (§10.1), this behavior is unchanged by WA-0005**; what changes is that the UI must now disclose this limitation explicitly rather than leaving it implicit.

### 5.6 Canonical evaluation contract consumed by the Opportunity Engine (`lib/decision-engine`, `lib/autopilot/decision`) — re-verified

`DecisionAnalysis` (`lib/decision-engine/types.ts:117-141`), produced by `evaluateSingleCandidate()` (`lib/decision-engine/evaluateSingleCandidate.ts:344`), is — per `lib/autopilot/decision/types.ts:33-37` — "the canonical recommendation output contract for both Autopilot and every other TradeEdge surface (Portfolio, Screener, Hunter, Repeat Trades, Pending Orders)." WA-0005 does not redesign any part of it; it documents the shape only, confirmed by direct read of `lib/decision-engine/types.ts:1-141`:

| Field | Shape | Notes |
|---|---|---|
| `recommendation.status` | `'recommended' \| 'conditional' \| 'not_recommended'` | Feeds directly into `OpportunityDisposition` via `lib/opportunity-engine`'s rules |
| `recommendation.action` | `DecisionAction` (`WAIT`, `BUY_SHARES`, `SELL_CSP`, `WRITE_CC`, `OPEN_BPS`, `OPEN_BCS`, `OPEN_IC`, `ROLL`, `CLOSE`, `MANAGE`, `HOLD`, `AVOID`) | Critical concern → `AVOID`/`not_recommended`; high concern/low confidence/uncertain bias → `WAIT`/`conditional` |
| `confidence` | `DecisionConfidence` (`overall, market, portfolio, execution, income, risk`, 0–100, plus optional `framework`) | `overall` computed at `evaluateSingleCandidate.ts:369-371`; required (non-optional) field |
| `rationale`, `supportingEvidence[]`, `concerns[]` (severity `low\|medium\|high\|critical`), `alternatives[]`, `reviewTriggers[]`, `expectedOutcome` | Prose + structured reasoning | All required (non-optional) array/object fields on `DecisionAnalysis` (may be empty arrays); individual `ExpectedOutcome` sub-fields (`expectedCredit`, `expectedAnnualizedReturnPct`, `capitalRequired`, `theoreticalMaxLoss`, `assignmentProbabilityPct`, `expectedHoldingDays`) are each optional |
| `candidate?` | `AutopilotCandidate \| undefined` | **Optional field.** `AutopilotCandidate` (`lib/autopilot/types.ts:124-145`) carries `id`, `strategy`, `symbol`, `underlyingPrice` (required number), `legs: AutopilotLeg[]` (each leg's `strike?`/`expiration?` individually optional), `estimatedCredit` (required number), `theoreticalMaxLoss` (required number), and optional `pop`, `roc`, `ivr`, `annualizedYield`, `technicalFit`, `goalAlignment`, `betaWeightedDelta`, `sector`, `earningsDate`, `marketTrend`, `notes` |
| `metadata` | `source`, `executionAllowed: false`, `paperExecutionAllowed: false`, `rulesEvaluated[]`, `rulesBlocked[]` | Confirms execution is out of scope app-wide, not just this sprint |

Real-market adapter: `lib/autopilot/decision/screenerCandidateAdapter.ts::screenResultsToAutopilotCandidates()` converts real `ScreenResult[]` into `AutopilotCandidate[]`; `SUPPORTED_STRATEGIES = {'BPS','BCS','IC','CSP'}` — PMCC and CC are explicitly out of scope with documented reasons. Because this adapter is the real, always-used producer for every candidate that reaches `/screener`'s pipeline, `candidate` is populated in practice for every candidate today, but it remains formally optional on the type — this CES's field-availability contract (§13) treats it as optional, not guaranteed, consistent with the type.

### 5.7 Navigation and workspace shell — re-verified

- `app/portfolio/page.tsx` tab bar (lines ~9216–9242): six tabs — `todays-priorities`, `briefing`, `positions`, `priorities` (legacy Priority List), `history`, `balances`. The `tab` deep-link query-param allow-list (line ~8762–8767) recognizes only `'todays-priorities' | 'briefing' | 'positions' | 'history'`, confirming WA-0003/WA-0004's documented convention. **No "Opportunities" tab or placeholder exists** anywhere in this file's tab bar or state.
- Top nav bar rendered on `/portfolio` (line 9206, confirmed by direct grep): `<Link href="/screener" ...>SCREENER</Link>` — **the primary-navigation label is confirmed, verbatim, to be `SCREENER`**, not "Opportunities" or any other label. `HOME` (`/`), `PORTFOLIO`, `SCREENER` (`/screener`), `INCOME ENGINE` (`/engine`), `WHEEL` (`/wheel`), `REPEAT STRATEGIES` (`/rinse-repeat`), `TRADE LOG`, `PERFORMANCE`, `HELP`. **Screener is already a top-level route, not a Portfolio sub-tab** — this is the existing precedent for how discovery surfaces are organized, consistent with WA-0001's ruling that Opportunities stays at `/screener` rather than becoming a `/portfolio` sub-tab. WA-0005 does not rename this label or restructure broader navigation.
- `components/command-center/CommandCenterNav.tsx` (Mission Control's nav): `Portfolio`, `Screener / Hunter`, `Opportunity Review` (`href: '#best-opportunity'`), `Paper Trading`, `Performance`, `Trade Log`.

### 5.8 Mission Control's opportunities entry point — re-verified, with the anchor-location correction

`components/mission-control/NewOpportunitiesSection.tsx` (27 lines, read in full): renders `<section id="best-opportunity" aria-label="New Opportunities">` with an `<h2>New Opportunities</h2>` and mounts `BestOpportunitiesPanel`, passing through the full `OpportunityRecommendation[]` (`items` prop) verbatim. As established in §5.3, this contradicts WA-0001's binding ruling that Mission Control should show a compact count, not the panel.

**Corrected finding (repository-verified, previously unverified):** `id="best-opportunity"` exists in exactly two places in the entire repository — `components/mission-control/NewOpportunitiesSection.tsx:21` (the live `/dashboard` mount) and `components/command-center/CommandCenter.tsx:31` (orphaned, no live route). **It does not exist anywhere in `app/screener/page.tsx`.** `components/command-center/CommandCenterNav.tsx:17`'s `#best-opportunity` link is an in-page anchor that today only resolves to something real on `/dashboard` (via `NewOpportunitiesSection`) — it has never pointed at `/screener`, despite WA-0001 §3/§7's stated intent ("Opportunity Review nav anchor... MOVE (repoint from the in-page `/dashboard` anchor to `/screener`)"). The prior CES draft's §5.4/§16 citations of `#best-opportunity` as though it were (or would remain) a `/screener`-owned anchor were therefore unverified and are corrected in §17: WA-0005 defines a new, `/screener`-owned anchor id (`ranked-opportunities`, §17) that Mission Control's link is repointed to, finally closing WA-0001's own stated intent rather than perpetuating the confusion.

### 5.9 Today's Priorities' explicit exclusion of new-trade discovery

`lib/morning-briefing/attentionFeed.ts:198-210` (which `buildTodaysPrioritiesQueue.ts` builds on, unchanged per its own module doc):

```
// CES section 5 "Excluded in MB-0001A": these three sources are
// deliberately NOT read or converted by this function --
//   dashboard.reviewToday.needsFollowUp
//   dashboard.opportunities.coveredCallOpportunities
//   dashboard.opportunities.screenerCandidatesAvailable (a navigation/
//     availability flag, not a ranked recommendation)
// A future sprint may add an explicit adapter for one or more of these;
// silently coercing them into AttentionItem here would mix incompatible
// models, which the CES explicitly forbids.
```

Enforced by `lib/morning-briefing/__tests__/attentionFeed.test.ts:550-551` (`'never converts needsFollowUp, coveredCallOpportunities, or screenerCandidatesAvailable into AttentionItems'`). `lib/todays-priorities-queue/types.ts:15` confirms the queue only adds `covered_call_opportunity` and `needs_follow_up` item kinds on top of Attention — no new-trade-candidate kind. **This is the boundary WA-0005 must respect from the other side: Opportunities must never feed candidates into the Today's Priorities queue, and must not duplicate its roll/CC/CSP-on-existing-positions content.**

### 5.10 Refresh and persistence (`TE-0005A`, `RankedScanTaskMirror`, `ScreenerJobStatus`, `screenerJobStore`) — re-verified, including the staleness-threshold question

Per `docs/tickets/TE-0005A-background-ranked-scan-infrastructure.md`: only **Ranked Scan mode** was migrated to background (Task-Manager-backed) execution, explicitly excluding "Migrate Screener" (the other scan modes) as a non-goal.

- `components/tasks/RankedScanTaskMirror.tsx` mirrors `kind === 'ranked-scan'` Task Manager state into `lib/screener/screenerJobStore.ts` regardless of route — progress/completion visibility survives in-app navigation away from `/screener`, but execution itself does not move to the server.
- `app/providers.tsx:35-37` mounts `RankedScanTaskMirror`, `ScreenerCardPolish`, and `ScreenerJobStatus` once at the app-shell level (inside `TaskProvider`/`CommandProvider`/`PortfolioDataProvider`), so the global scan-status toast is available app-wide.
- `lib/screener/screenerJobStore.ts` is a module-level `useSyncExternalStore` singleton persisted to `localStorage` (`trade-edge-screener-job-state`) — survives in-app navigation and page reload for **job status only** (not full ranked results). **Verified by direct read (`screenerJobStore.ts:56-59`): the only elapsed-time rule in this file is `if (next.phase === 'running' && next.startedAt && Date.now() - next.startedAt > 60 * 60 * 1000) { phase = 'stopped' }`** — this self-heals a rehydrated *in-progress* job that can no longer be running (since a reload kills the in-browser async scan), it is **not** a staleness threshold for *completed, currently-displayed ranked results*. No repository-wide elapsed-time-based staleness rule for ranked recommendation output exists anywhere. This directly informs §16's staleness rule.
- `components/ScreenerJobStatus.tsx` renders a fixed-position, app-wide toast with STOP SCAN / OPEN RESULTS / DISMISS.
- The other three scan modes (filter/targeted/PMCC/CSP, via `runScreen()`, `runTargetedScan()`, `runPMCCScan()`, `runCspScan()` in `app/screener/page.tsx`) remain plain page-local async functions — their *last-known* status is still mirrored into the shared toast/store, but they do not survive unmounting `/screener` the way Ranked Scan does.
- **`RecommendationService` (§5.4) is in-memory only** — the Opportunity Engine's ranked output does not survive a hard reload at all, regardless of scan mode. There is no persisted "previous completed scan" identity/result set to diff a new scan against — **confirmed there is no mechanism today to prove a given ranked candidate is "new" relative to a prior scan** (this directly determines the Mission Control count-label rule, §11).

---

## 6. Existing Producer and Consumer Map

| Producer | Consumes | Feeds | Consumer(s) |
|---|---|---|---|
| `lib/decision-engine::evaluateSingleCandidate` | `SingleCandidateDecisionContext` | `DecisionAnalysis` | `POST /api/autopilot/recommendations`, Autopilot, Pending Orders (unrelated to this CES) |
| `lib/autopilot/decision/screenerCandidateAdapter` | `ScreenResult[]` (real scan output) | `AutopilotCandidate[]` | Feeds into `evaluateSingleCandidate` pipeline |
| `POST /api/autopilot/recommendations` | scan results | `DecisionAnalysis[]` | `app/screener/page.tsx` (OE-0002A) |
| `lib/command-center/screenerOpportunityRecommendations.ts` | API response body | `OpportunityRecommendation[]` (via `lib/opportunity-engine`) | `/screener`'s `BestOpportunitiesPanel` |
| `lib/recommendations/RecommendationService.ts` | published raw `DecisionAnalysis[]` | in-memory pub-sub (full, unstripped `DecisionAnalysis[]`) | `useCurrentRecommendations()` on `/dashboard`; also the source for the new candidate-detail index (§13) |
| `lib/opportunity-engine::rankOpportunityCandidates` | `OpportunityCandidate[]`, `OpportunityContext` | `OpportunityRecommendation[]` (no candidate-shape fields, §5.1) | Both `/screener` and `/dashboard`, via `buildOpportunityRecommendations` |
| `components/opportunity-engine/BestOpportunitiesPanel` | `OpportunityRecommendation[]`, plus (new, §13) an optional candidate-detail index keyed by `decisionAnalysisId` | rendered UI | `/screener` (primary), `NewOpportunitiesSection` on `/dashboard` (reduced per §9) |

WA-0001's Ownership Matrix (§3, quoted): *"Opportunities — the existing `/screener`, per product ruling; no new route or duplicate experience... OWN (`/screener`, full — already renders `BestOpportunitiesPanel`); REMOVE (`/dashboard`'s duplicate full panel); Mission Control keeps a compact count, not the panel."* This CES reaffirms and operationalizes that ruling (§9).

---

## 7. Canonical Source-of-Truth Decisions

| Concept | Competing implementations found | Canonical producer (this CES's ruling) | Non-canonical implementation's fate |
|---|---|---|---|
| Candidate evaluation (disposition/confidence/reasoning) | `lib/decision-engine::evaluateSingleCandidate` only — no competitor found | **`lib/decision-engine`, unchanged** | N/A — not redesigned |
| Candidate ranking/sequencing | `lib/opportunity-engine::rankOpportunityCandidates` only — no competitor found | **`lib/opportunity-engine`, unchanged** | N/A — not redesigned |
| Candidate presentation (opportunity cards) | `BestOpportunitiesPanel` (real); `BestOpportunityCard`/`CommandCenter` (orphaned, TC-0001) | **`BestOpportunitiesPanel`** | `CommandCenter`/`BestOpportunityCard` — no live consumer; disposition per §9 |
| Screener's own scan-result presentation (filter/rank/targeted tables) | `app/screener/page.tsx`'s native `ScreenResult[]` table/cards, driven by page-local `RankConfig`/`lib/scans/rank-scoring.ts` | **Retained as a distinct, legitimate concern — raw scan mechanics, not opportunity evaluation.** Relabeled "All Scan Results" and demoted to third in page order per Ruling 2 (§10.2) | Not touched functionally; only its position and section label change |
| Mission Control's opportunities entry point | `NewOpportunitiesSection` currently embeds the full panel; WA-0001 ruled it should be a compact count | **Compact count/link, per WA-0001's binding ruling** — this CES operationalizes it, does not re-decide it | Full-panel embedding removed at implementation time (§9, §21) |
| New-trade discovery inside Today's Priorities | None — WA-0003/MB-0001A explicitly excluded `screenerCandidatesAvailable`/`coveredCallOpportunities` from the queue | **Opportunities workspace owns all new-trade discovery; Today's Priorities never re-derives it** | N/A — boundary already enforced by tests (§5.9) |
| Available capital for disposition gating | Hardcoded `0` in both `/screener` and `/dashboard` consumers | **Resolved — Ruling 1 (§10.1): stays `0`; canonical integration deferred to OE-0003** | N/A — not a WA-0005 change |
| `/screener` information hierarchy (raw results vs. ranked view) | Raw results rendered first today, Opportunity Engine panel second | **Resolved — Ruling 2 (§10.2): scan controls → Ranked Opportunities → "All Scan Results"** | Raw-results table retained unchanged in content/mechanics, moved in position only |

---

## 8. Workspace Ownership Boundaries

| Workspace | Owns | Opportunities may reference but not own |
|---|---|---|
| **Opportunities (`/screener`)** | New-trade discovery, candidate evaluation display, ranking/disposition presentation, candidate detail inspection, capital-limitation disclosure | — |
| **Mission Control (`/dashboard`)** | Portfolio Health, Top Risks, Lead Item, Review Complete | A **compact count/link** into Opportunities (§9, §11) — never the full ranked list |
| **Today's Priorities** | Action queue for existing positions (roll/CC/CSP-on-book, Immediate Action, Review Today) | Nothing from Opportunities — explicitly excluded (§5.9) |
| **Briefing** | Since Your Last Review, Executive Summary, Upcoming Events | Nothing opportunity-specific |
| **Positions** | Composition, position-specific risk, Greeks, bulk actions | Nothing — Opportunities never manages existing positions |
| **Repeat Trades (`/rinse-repeat`)**, **Income Engine (`/engine`)** | Their own page-local discovery heuristics, explicitly out of OE-0001's adapted scope | Opportunities does not absorb or link deeply into these this sprint (§23) |

---

## 9. Component Reuse/Retirement Recommendations

| Component | Recommendation | Evidence |
|---|---|---|
| `lib/opportunity-engine/*` | **Reuse unchanged** | Canonical, fully tested (39 tests), no redesign in scope |
| `BestOpportunitiesPanel.tsx` | **Reuse, extended per this CES**: (1) correct its stale top-of-file comment ("intentionally NOT mounted anywhere"); (2) add the required Detailed tier (§13) via a new optional candidate-detail index prop; (3) add the capital-limitation notice (§10.1) as a new optional/required banner region; (4) add non-color-only staleness treatment (§16, §19) | Purely presentational, 15 tests, no interactive surface — safe to extend as the single canonical opportunity-card renderer; none of this touches ranking/scoring |
| `app/screener/page.tsx`'s legacy scan/filter/rank UI | **Retain fully, relabel and reposition per Ruling 2 (§10.2)**: renamed "All Scan Results" in its section heading, moved to third position (after scan controls and Ranked Opportunities) | Actively used, page-local `RankConfig`/`rank-scoring.ts`, CSV export, three scan modes — none of this duplicates Opportunity Engine concerns; content/mechanics unchanged |
| `lib/command-center/screenerOpportunityRecommendations.ts` | **Reuse unchanged** | Pure translation function, no ranking logic of its own; `availableCapital: 0` unchanged per Ruling 1 |
| `lib/recommendations/RecommendationService.ts` | **Reuse unchanged** | Deliberately stores raw `DecisionAnalysis[]`, lets each consumer apply its own `OpportunityContext` — correct architecture for Mission Control's reduced-scope consumption too, and the source for the new candidate-detail index (§13) |
| `components/mission-control/NewOpportunitiesSection.tsx` | **Reuse with refactoring — reduce to a compact count/link, per WA-0001's already-binding ruling and this CES's exact contract (§11)** | Currently embeds the full panel, contradicting WA-0001 §3/§7 verbatim quote (§5.3, §6); Mission Control's own frozen scope (WA-0001 §9) is compact-summary-only |
| `components/command-center/BestOpportunityCard.tsx`, `components/command-center/CommandCenter.tsx` | **Defer disposition to a later cleanup ticket — do not retire in WA-0005** | Confirmed orphaned (no live page import) but the MB-0002 report already flagged this as "a candidate for a future cleanup ticket," and this CES's scope is Opportunities' presentation contract, not general dead-code sweeps |
| `app/rinse-repeat/page.tsx`, `app/engine/page.tsx` | **Retain as specialized workspaces, unchanged** | Legitimately different candidate models (§5.2); OE-0001 already scoped adaptation out; no consumer evidence justifies forcing them into Opportunity Engine this sprint |
| `OpportunityCandidateSource: 'hunter'` type value | **Retain as an unused placeholder, do not remove** | Removing it is a type-contract change to `lib/opportunity-engine`, which this CES is barred from touching; it is harmless as an unused union member |

None of the above changes ranking, scoring, evaluation, recommendation, disposition, or confidence logic. `OpportunityContext.availableCapital` remains `0` (Ruling 1). The `NewOpportunitiesSection` refactor changes only *how much* of the already-computed `OpportunityRecommendation[]` Mission Control displays (a count/link vs. the full list) — it does not touch how that list is computed. The `BestOpportunitiesPanel` extensions add optional new props (detail index, capital-limitation copy) and new, additive rendering branches — they do not change the meaning of any existing field.

---

## 10. Resolved Product Owner Rulings

Both decisions the prior draft left open are now binding. **No Product Owner decision remains open for this CES to freeze** (see also §28).

### 10.1 Ruling 1 — Available capital: stays `0`; capital-limitation notice required; OE-0003 is the named follow-on

**Decision:** `OpportunityContext.availableCapital` remains hardcoded `0`. WA-0005 does not gate `/screener` behind PortfolioMode, does not add a manually-entered or any other secondary capital source, and does not change any Opportunity Engine disposition logic. This is unchanged, existing, already-shipped behavior (§5.5) — WA-0005 does not touch it.

**Binding requirement — capital-limitation notice.** An explicit, persistent (not user-dismissible), non-color-only, user-facing notice must render immediately adjacent to (above) the Ranked Opportunities presentation, whenever that presentation has evaluated at least one candidate (i.e., whenever `recommendations.length > 0`, regardless of disposition mix). This is a **capability limitation**, not an error, empty, or candidate-rejection state, and must be visually and semantically distinct from `blockerNotice` (loading/error) and from the staleness indicator (§16).

**Frozen content contract (exact copy, binding — implementation must render this text verbatim or an approved localized equivalent, and automated tests must assert on it):**

> "Available capital is not connected for this scan, so candidates cannot be classified as Recommended. The absence of a Recommended pick does not mean no worthwhile candidates exist — review Watch and Acceptable Alternative candidates below on their own merits."

Testable content contract, if exact-string assertion is impractical for a given test tier: the rendered notice **must** contain the substring "Available capital is not connected" and **must not** contain, anywhere in the Ranked Opportunities section, any phrase implying "no recommendable trades exist," "nothing qualifies," or "no suitable candidates" as a *quality* conclusion tied to the absence of `RECOMMENDED`.

**Binding requirement — no false absence-of-quality implication.** Per §15 (state contract), the UI must never present the absence of a `RECOMMENDED` disposition as evidence that no candidate is worth considering. This applies everywhere ranked results are summarized: the Ranked Opportunities section itself, the Mission Control compact summary (§11), and any future surface.

**Deferred follow-on ticket: OE-0003 (Optional Opportunity Context).** Confirmed via `docs/roadmap/ROADMAP.md:68` and `planning/SPRINT_STATUS.md`: OE-0003 is already the named, tracked ticket for "wire real, portfolio-mode-gated capital/exposure data into `OpportunityContext`, once `/screener`'s PortfolioMode gating question is resolved" — genuinely the same scope this ruling defers to, not a new identifier. **OE-0003's own scope statement must prefer canonical, portfolio-derived capital with PortfolioMode handling, and explicitly forbids introducing a manually-entered capital figure as a second source of truth alongside PortfolioMode's own** — this closes off Option (c) from the prior draft's §21.1 discussion permanently, not just for WA-0005.

### 10.2 Ruling 2 — `/screener` information hierarchy

**Binding order**, confirmed against `app/screener/page.tsx`'s real structure (§5.3, §11):

1. **Scan controls** (existing — mode selector, filters, run/stop) — unchanged, first.
2. **Ranked Opportunities** (`BestOpportunitiesPanel`, extended per §13) — second, appearing only once a scan has produced evaluable results (defined precisely in §11).
3. **"All Scan Results"** — the existing raw filter/rank/targeted results table/cards, explicitly relabeled with that heading, retained with all existing filtering, CSV export, scan-mode switching, and other mechanics fully intact — third.

**Explicitly preserved, unmodified:** raw results, filtering, exports (`downloadCSV`), all three/four scan modes (filter/rank/targeted/PMCC/CSP), `SmartSuggestionsPanel`, earnings-follow-up scheduling, and every other existing Screener mechanic — none removed or functionally reduced. Only position and section labeling change.

**Refresh behavior:** per repository evidence (§5.10), refreshing (re-running a scan) must preserve the last valid Ranked Opportunities presentation on screen while visibly communicating refresh status via the existing `blockerNotice`/`opportunityState` mechanism — no repository constraint was found preventing this (the current code already keeps `opportunityRecommendations` in state across a re-fetch; the effect only replaces it on a new resolved response, §11, §16).

**Navigation label:** confirmed unchanged, `SCREENER` (§5.7) — WA-0005 does not rename it or restructure broader navigation. This ruling does not begin WA-0006 or any broader navigation restructuring.

---

## 11. Proposed Information Architecture

Opportunities remains `/screener`. Per Ruling 2 (§10.2), its page is organized (top to bottom) as:

1. **Scan controls** (existing — mode selector, filters, run/stop) — unchanged.
2. **Ranked Opportunities** — `BestOpportunitiesPanel`, extended with the capital-limitation notice (§10.1) and the Detailed tier (§13). Section wrapper gets a new, `/screener`-owned anchor id, `id="ranked-opportunities"` (§17) — the first anchor of this kind to genuinely exist on `/screener` (§5.8's corrected finding).
3. **"All Scan Results"** — the existing raw filter/rank/targeted table/cards, explicitly relabeled, retained unchanged in mechanics.
4. **Candidate detail** — inline expansion within `BestOpportunitiesPanel`'s existing `RecommendationCard` (§13) — no new route, no new drawer/modal.

**"Evaluable results" — precise definition (required by Ruling 2, previously undefined):** Ranked Opportunities must not render before a scan has produced evaluable results. "Evaluable results" means: `results.length > 0` (i.e., the current scan mode has produced at least one raw `ScreenResult`) **and** the recommendations fetch (`opportunityState`) has left `'idle'` — i.e., either `'loading'`, `'loaded'`, or `'error'`. Concretely:

- Before any scan has ever run this session (`results.length === 0 && opportunityState === 'idle'`): Ranked Opportunities section does not render at all (§15, Initial/not-run state).
- Scan running or results just arrived, recommendations fetch in flight (`results.length > 0 && opportunityState === 'loading'`): Ranked Opportunities section renders with the existing prior valid recommendations (if any) still visible, plus the `blockerNotice` loading banner (§16).
- Scan complete, recommendations fetch resolved successfully (`opportunityState === 'loaded'`): Ranked Opportunities renders the current `OpportunityRecommendation[]`, including the capital-limitation notice.
- Scan complete, recommendations fetch failed (`opportunityState === 'error'`): Ranked Opportunities section still renders (`results.length > 0` still true) with the last known-valid recommendations if any (§16), plus the `blockerNotice` error banner.

No `/portfolio` sub-tab is created; no new top-level route is created. This affirms WA-0001's ruling directly (§1, §5.7) rather than re-deciding it.

---

## 12. Discovery-to-Evaluation Workflow

```
Discovery (scan runs, ScreenResult[] produced)
  → Eligibility (screenerCandidateAdapter: SUPPORTED_STRATEGIES = BPS/BCS/IC/CSP only)
  → Evaluation (evaluateSingleCandidate → DecisionAnalysis, unchanged)
  → Ranking (rankOpportunityCandidates, two-pass, unchanged; availableCapital: 0, unchanged per Ruling 1)
  → Disposition (RECOMMENDED / ACCEPTABLE_ALTERNATIVE / WATCH / REJECTED, unchanged;
     RECOMMENDED structurally unreachable today -- disclosed via capital-limitation notice, §10.1)
  → Detailed inspection (RecommendationCard's Summary/Expanded/Detailed tiers, §13 --
     Detailed tier is new, required UI work reading the same already-published data)
  → [WA-0005 scope ends here -- no next-action design]
```

**WA-0005 scope:** discovery through detailed inspection, all reusing existing producers.
**Explicitly not WA-0005 scope:** any transition from "inspected" to "acted upon" (order entry, paper-trade submission, or otherwise) — no approved workflow owns this anywhere in the codebase (§3, §5.6 `executionAllowed: false`).

---

## 13. Candidate Summary and Detail Contracts

`RecommendationCard` (inside `BestOpportunitiesPanel.tsx`) already renders, per candidate: rank badge, symbol/strategy/source, disposition pill (color **and** text label — `DISPOSITION_LABEL`, non-color-only already satisfied), score, confidence, primary reason, `supportingFactors`, `riskTradeoffs`, `portfolioConflicts` (disposition-changing, ⚠) distinct from `exposureDisclosures` (informational-only, ℹ — visually distinguished), `rejectionReasons` (✕), `missingInformationDisclosures` (italic, "?"), `whatWouldImprove`.

**Binding correction to the prior draft: the Detailed tier is a required WA-0005 outcome, not optional, but only with truthfully-available canonical data.** The prior draft's "confirm at implementation time whether `RecommendationCard` needs a candidate passthrough" was itself an unverified claim — it has now been verified (§5.1, §5.4): `OpportunityRecommendation` (what the card receives today) carries none of the candidate-shape fields; they exist only on `DecisionAnalysis`/`AutopilotCandidate`, which are already fully available in both `/screener`'s local state and `RecommendationService` (§5.4), just not threaded through to the card.

**Required implementation seam (additive, presentation-only, does not touch canonical domain types):** a new module, `lib/command-center/opportunityCandidateDetails.ts` (exact responsibility specified here; exact internal helper names are an implementation-time detail, but the file's public contract is fixed by this CES), that builds `Record<string /* decisionAnalysisId */, OpportunityCandidateDetail>` from the same `DecisionAnalysis[]` already held by the caller (`rawAnalyses` in `app/screener/page.tsx`, or `useCurrentRecommendations().analyses` on `/dashboard`) — a pure projection, no new fetch, no new producer, no change to `lib/opportunity-engine` or `lib/decision-engine` types. `BestOpportunitiesPanel`/`RecommendationCard` receive this index as a new, optional prop (`candidateDetails?: Record<string, OpportunityCandidateDetail>`) and look up each card's detail by `rec.decisionAnalysisId`; when absent for a given id, the Detailed tier renders "Not available" for every field (§13's non-fabrication rule), never a missing section.

**Field-by-field classification, verified against `lib/decision-engine/types.ts` and `lib/autopilot/types.ts` (§5.6):**

| Field | Classification | Source |
|---|---|---|
| symbol, strategy, source, disposition, score, confidence, primary reason | **Guaranteed** (already on `OpportunityRecommendation` today) | `types.ts:119-165` |
| Underlying price | **Optional** — present only when `decisionAnalysis.candidate` is populated (true in practice for every real screener-sourced candidate, not type-guaranteed) | `AutopilotCandidate.underlyingPrice` |
| Strikes | **Optional** — per-leg (`AutopilotLeg.strike?`), depends on `candidate.legs` | `AutopilotLeg.strike?` |
| Expiration | **Optional** — per-leg (`AutopilotLeg.expiration?`) | `AutopilotLeg.expiration?` |
| DTE | **Optional** — not stored on `DecisionAnalysis`/`AutopilotCandidate` at all; must be computed from the latest leg expiration at presentation time (the same logic `adapters/decisionAnalysisAdapter.ts::calculateDte` already uses, reused as a presentation-layer utility, not re-implemented as domain logic) | Derived |
| Credit/debit | **Optional** — `candidate?.estimatedCredit` and/or `expectedOutcome.expectedCredit?` | `AutopilotCandidate.estimatedCredit`, `ExpectedOutcome.expectedCredit?` |
| Capital requirement | **Optional** — `expectedOutcome.capitalRequired?` and/or `candidate?.theoreticalMaxLoss` | `ExpectedOutcome.capitalRequired?`, `AutopilotCandidate.theoreticalMaxLoss` |
| Return measures (ROC, annualized yield/return) | **Optional** — `candidate?.roc?`, `candidate?.annualizedYield?`, `expectedOutcome.expectedAnnualizedReturnPct?` | as named |
| Probability/delta | **Optional** — `candidate?.pop?`, `candidate?.betaWeightedDelta?`, `expectedOutcome.assignmentProbabilityPct?` | as named |
| Volatility context | **Optional** — `candidate?.ivr?` | `AutopilotCandidate.ivr?` |
| Earnings/event context | **Optional** — `candidate?.earningsDate?` | `AutopilotCandidate.earningsDate?` |
| `alternatives[]`, `reviewTriggers[]`, `expectedOutcome` (object), full `concerns[]` with severity, `metadata.rulesEvaluated`/`rulesBlocked` | **Guaranteed once the seam is implemented** — non-optional array/object fields on `DecisionAnalysis` itself (arrays may be empty) | `DecisionAnalysis` |
| Genuinely unavailable from any canonical producer | **None found** — every field in the task's checklist traces to either `OpportunityRecommendation` directly or `DecisionAnalysis`/`AutopilotCandidate` via the seam above | — |

**Tiers, updated:**

| Tier | Fields |
|---|---|
| **Summary** (always visible) | rank, symbol, strategy, source, disposition pill, score, confidence |
| **Expanded** (existing card body, currently always shown — no collapse today) | primary reason, supporting factors, risk tradeoffs, conflicts/disclosures, rejection reasons, missing-information disclosures, what-would-improve |
| **Detailed** (new, required, inline `aria-expanded` expansion — §17, matching `TodaysPrioritiesQueueView.tsx`'s existing collapse pattern) | expiration, DTE, strikes, underlying price, credit/debit, capital requirement, return measures, probability/delta, volatility context, earnings/event context, `alternatives[]`, `reviewTriggers[]`, `expectedOutcome` fields, full `concerns[]` with severity, `metadata.rulesEvaluated`/`rulesBlocked` |

**Unavailable-value rendering rule:** any Detailed-tier field that is `undefined`/absent for a given candidate renders as an explicit "Not available" (or the panel's existing em-dash convention, `'—'`, already used for `opportunityScoreTotal ?? '—'`) — never a fabricated `0`, blank, or omitted row. This is consistent with the existing codebase-wide convention (`BestOpportunitiesPanel.tsx:76`) and with §15's confidence-unavailable rule.

---

## 14. Ranking/Sorting/Filtering Contracts

**Corrective round 3 finding:** the prior draft described new Ranked Opportunities-specific user sorting and a disposition filter (hiding `REJECTED` by default) as though they were part of this sprint's design, but §20's acceptance criteria, §21's implementation seams, §26's sequence, and §27's artifacts never actually authorized building either control. That is now resolved explicitly: **WA-0005 does not add any new sorting or filtering control to Ranked Opportunities.**

- **Canonical default ordering, unchanged**: Pass 2's `DISPOSITION_SORT_RANK` order (RECOMMENDED → ACCEPTABLE_ALTERNATIVE → WATCH → REJECTED), then score/confidence/id tiebreak, exactly as `rankOpportunityCandidates` already produces (§5.1). **Verified, not assumed** — the "two-pass" characterization is accurate to the real implementation, confirmed against `rankOpportunityCandidates.ts` and its 21 tests. This is the **only** display order Ranked Opportunities uses in WA-0005 — no user-selectable re-sort is built.
- **No new Ranked Opportunities sorting control.** WA-0005 does not add score/symbol/strategy re-sort or any other user-selectable ordering to Ranked Opportunities. The canonical order (above) is the only order shown.
- **No new Ranked Opportunities disposition filter, and `REJECTED` is not hidden by default.** Every candidate — including every `REJECTED` candidate — remains visible and inspectable in the Ranked Opportunities presentation at all times; there is no toggle to hide or show them, because none is hidden. This is required, not optional, by §15's state-3 contract ("never 'nothing to display'" for an all-`REJECTED` result) — a default-hide-then-reveal design would contradict that contract at first render.
- **Existing Screener discovery filters are preserved unchanged**, page-local, and entirely separate from Ranked Opportunities — this sprint does not touch them.
- **No ranking rule is modified.** Any proposed rule change (e.g., different tiebreak weighting) is recorded only as a future consideration (§25), not this sprint's scope.
- **Deferred, not designed here:** Ranked Opportunities-specific user sorting and disposition filtering (including any future hide/show control for `REJECTED`) are recorded as a deferred opportunity (§25) for a later sprint, contingent on real trader feedback that the canonical order alone is insufficient — not assumed necessary by this CES.

---

## 15. State and Safety Contracts

Mirrors WA-0004 §10's "tracking-active vs. genuinely-empty" discipline (`TRADER_COMMITMENT_TRACKING_ACTIVE`) — an empty array must never be read as "no opportunities exist" unless the full evaluation/ranking process actually completed successfully.

**Corrected "no qualifying opportunities" contract** — the prior draft conflated an empty-array state with an all-`REJECTED` result, which repository verification (§5.1, §14) shows are never the same state. **Corrective round 3 finding:** states 2 and 5, as originally drafted, both resolved to the same practical trigger (`recommendations.length === 0` after a successful evaluation response) and were not separately testable. They are now redefined using `rawAnalyses.length` — the count of raw `DecisionAnalysis[]` already held by the caller (§5.8, §13, §21) before OE-0001's adapter/ranker ever runs — as the discriminating signal between "analyses existed but didn't become recommendations" (state 2) and "no analyses were produced at all" (state 5). These are six distinct, individually defined, mutually exclusive states:

| # | State | Trigger (repository-verified, mutually exclusive) | Required distinct behavior |
|---|---|---|---|
| 1 | Scan completed, zero raw candidates | `results.length === 0` after a completed scan (not `!loading` and not `idle`) | Distinct "Empty universe" message — the scan found literally nothing to evaluate; Ranked Opportunities does not render (§11, "evaluable results") |
| 2 | Analyses existed, but none became Opportunity Recommendations | `rawAnalyses.length > 0` **and** `recommendations.length === 0`, with a successful (non-error) evaluation response | Distinct message: "Candidates were analyzed, but none could be adapted or ranked." — never rendered identically to state 1 or state 5; never called "no qualifying opportunities" |
| 3 | Evaluation succeeded, every candidate is `REJECTED` | `recommendations.length > 0`, every entry's `disposition === 'REJECTED'` | **Never** "nothing to display." Every `REJECTED` candidate remains rendered with its `rejectionReasons` (per §14) — this is a populated, inspectable list, not an empty state |
| 4 | Evaluation succeeded, `WATCH`/`ACCEPTABLE_ALTERNATIVE` present, none `RECOMMENDED` | `recommendations.length > 0`, disposition mix includes non-`REJECTED` entries but no `RECOMMENDED` | Renders normally; the capital-limitation notice (§10.1) is the only messaging tied to the absence of `RECOMMENDED` — never framed as a candidate-quality conclusion |
| 5 | Recommendations API completed successfully, but produced no analyses | `results.length > 0` **and** `rawAnalyses.length === 0` **and** `recommendations.length === 0` | Distinct message: "Scan results existed, but the evaluation service produced no candidate analyses." — never the generic `BestOpportunitiesPanel` "No ranked opportunities to display" copy, since that copy hides this distinction; never rendered identically to state 1 or state 2; never called "no qualifying opportunities" |
| 6 | Evaluation failed or incomplete | `opportunityState === 'error'`, or `POST /api/autopilot/recommendations` errored | Distinct failure state via the existing `blockerNotice`/`opportunityError` mechanism — never silently falls back to an empty list; last known-valid results remain visible per §16 |

States 2 and 5 are now mutually exclusive by construction: state 2 requires `rawAnalyses.length > 0`; state 5 requires `rawAnalyses.length === 0`. Both require `recommendations.length === 0`, so `rawAnalyses.length` is the sole, necessary discriminator — no other combination of the three counts (`results.length`, `rawAnalyses.length`, `recommendations.length`) can satisfy both rows simultaneously. Neither state's copy may be interchanged with the other's, and neither is worded as "no qualifying opportunities."

Additional, previously-defined states, retained and reconciled:

| State | Trigger | Required distinct behavior |
|---|---|---|
| **Initial / not yet run** | No scan has been run this session (`results.length === 0 && opportunityState === 'idle'`) | Explicit "run a scan to see opportunities" prompt — not an empty-results message; Ranked Opportunities section does not render (§11) |
| **Loading** | Scan/recommendations fetch in progress | Existing `ScreenerJobStatus` toast + `blockerNotice` prop already supports this; last valid results remain visible underneath (§16) |
| **Partial data** | Some candidates evaluated, others skipped (adapter's `null` returns, §5.1) | Must be disclosed via `blockerNotice` or an explicit count ("N of M candidates evaluated"), not hidden |
| **Stale data** | Ranked Opportunities predates the most recently completed scan (session-supersession rule, §16 — not an elapsed-time threshold) | Non-color-only stale indicator; results remain inspectable, never hidden (§16) |
| **Confidence-unavailable** | `analysis.confidence.overall` missing/null | Must render as "confidence unavailable," never coerced to `0` (which would visually read as "very low confidence" rather than "unknown") |
| **RECOMMENDED structurally unreachable** | `availableCapital: 0` (Ruling 1, §10.1) | The capital-limitation notice (§10.1) is the required, permanent disclosure; the UI must never imply the absence of `RECOMMENDED` means "nothing good exists" |

Portfolio-fit concerns (`portfolioConflicts`) and candidate-quality concerns (`rejectionReasons`, `concerns[]`) are already visually distinguished in `RecommendationCard` (⚠ vs ✕, plus disposition-changing vs. informational-only exposure disclosures) — this contract must be preserved, not merged, in any presentation changes.

**Hard rule carried through from `lib/opportunity-engine`'s own design**: a candidate ranking highly is never sufficient grounds to imply it is safe, suitable, executable, or approved. `RecommendationCard` already avoids this (no "Buy" or "Execute" affordance exists) — any new UI work, including the Detailed tier and capital-limitation notice, must preserve that absence.

---

## 16. Refresh and Persistence Behavior

Per §5.10, confirmed from repository evidence, not assumption:

- Ranked-Scan-mode results/progress **do** survive in-app navigation (Task-Manager-backed, `RankedScanTaskMirror` + `screenerJobStore`, app-wide mount in `app/providers.tsx`).
- Filter/targeted/PMCC/CSP scan modes' live execution does **not** survive unmounting `/screener` — only their last-known status is mirrored into the shared toast.
- `RecommendationService`'s published `DecisionAnalysis[]` (the Opportunity Engine's actual input) is **in-memory only** — lost on hard reload for all scan modes, including Ranked Scan.
- Refresh today is scan-triggered (manual "run scan" action), not a periodic auto-refresh; Ranked Scan's progress push is automatic once running, but nothing re-runs a scan on its own.

**Refresh/staleness contract, corrected and completed (previously left as an unspecified "implementation detail"):**

| State | Behavior |
|---|---|
| Initial load, no scan run | No Ranked Opportunities section rendered (§11) |
| First scan in progress | Loading indicator only; nothing to preserve yet |
| Refresh (re-scan) with prior valid results | **Prior valid results remain visible** during the refresh, with the loading `blockerNotice` overlaid/appended — confirmed no repository constraint prevents this (§10.2); state is not cleared until the new response resolves |
| Successful refresh | New `OpportunityRecommendation[]` and `generatedAt` replace the prior set; staleness clears |
| Failed refresh, prior valid results exist | Prior valid results **remain visible** (per Ruling 2, §10.2), marked with the existing `opportunityError`/`blockerNotice` failure banner; results are not blanked out |
| Failed first scan, no prior results | Empty/failure state per §15 state 6 — no results to fall back to |
| Partial adapter/evaluation success | Partial-data disclosure per §15 |
| Scan producer failure | Existing scan-level error handling (unchanged); Ranked Opportunities does not render if `results.length === 0` |
| Recommendations API/evaluation failure | §15 state 6 |
| Stale persisted job status | `screenerJobStore`'s existing 60-minute rehydration self-heal (§5.10) — unchanged, out of scope for this CES since it governs job *status*, not ranked *results* |
| Stale ranked recommendation output | See staleness rule below |
| Hard reload with no in-memory recommendations | `RecommendationService` resets to `EMPTY_STATE` (confirmed, `RecommendationService.ts:48`) — Ranked Opportunities on `/dashboard` shows no data until a new scan publishes; `/screener` itself shows no prior recommendations either, consistent with "in-memory only" (§5.10) |

**Staleness threshold rule (binding, corrected):** repository evidence (§5.10) supports no fixed elapsed-time threshold for ranked-result staleness — the only elapsed-time rule found anywhere (`screenerJobStore.ts`'s 60-minute job-status self-heal) governs a different concern (in-progress job rehydration, not displayed results). Per this CES's binding ruling, **staleness = scan-identity/session supersession, not a raw clock threshold**: a Ranked Opportunities presentation is "stale" if and only if a newer scan has completed since it was generated (i.e., a new `generatedAt`/scan identity exists that supersedes the currently displayed one) — never based on how much wall-clock time has elapsed. An elapsed-time-based staleness *warning* (e.g., "this scan is 2 hours old") is recorded as **deferred future work** (§25), not part of this freeze, since no repository evidence today supports picking a specific threshold value.

**Stale-disclosure UI behavior:** stale results remain fully visible and inspectable — never hidden — labeled with a non-color-only indicator (icon + text, e.g. "Superseded by a newer scan," not a color change alone), consistent with §19's accessibility requirements.

**No new backend infrastructure is proposed by this CES.** The gap (full ranked results not surviving hard reload) is real but has no repository evidence that the accepted product outcome (§3) requires solving it this sprint — it is recorded as deferred (§25), consistent with `TE-0005A`'s own explicit non-goal of migrating the other three scan modes.

---

## 17. Navigation and Deep-Link Contract

- No new route, no new `/portfolio` tab, no change to the `tab` deep-link allow-list (`todays-priorities`/`briefing`/`positions`/`history`).
- `/screener` remains the sole Opportunities entry point at the URL level, per WA-0001's binding ruling (§1).
- **Corrected anchor contract.** `id="best-opportunity"` exists today only on `components/mission-control/NewOpportunitiesSection.tsx:21` (live, `/dashboard`) and the orphaned `components/command-center/CommandCenter.tsx:31` — **it does not exist on `/screener`** (§5.8). This CES defines a new, `/screener`-owned anchor id, **`id="ranked-opportunities"`**, on the Ranked Opportunities section wrapper added in §11. `components/command-center/CommandCenterNav.tsx`'s "Opportunity Review" link is repointed from `#best-opportunity` to `/screener#ranked-opportunities`, finally realizing WA-0001 §3/§7's stated (but never implemented) intent to move this anchor to `/screener`. Mission Control's own reduced summary section (§9, §11) retains its own, separate `id="best-opportunity"` wrapper (now wrapping the compact count/link, not the full panel) so no existing bookmark/link to `/dashboard#best-opportunity` breaks — **no duplicate id exists on any single page**, since the two ids live on two different routes.
- Navigation label: confirmed via direct grep (`app/portfolio/page.tsx:9206`) to be exactly `SCREENER` in primary nav — retained unchanged. WA-0005 does not rename it or restructure broader navigation (§10.2).

---

## 18. Mobile/Tablet/Desktop Behavior

Applies to the actual restructured `/screener` page (scan controls → Ranked Opportunities → "All Scan Results," §11):

| Aspect | Existing convention (evidence) | Opportunities' behavior |
|---|---|---|
| Overall page composition, all widths | No responsive breakpoint classes exist in `BestOpportunitiesPanel`/`RecommendationCard` today (`sm:`/`md:`/`lg:` absent) — a single fluid stacked layout | Preserved for Ranked Opportunities; the three-section vertical stack (scan controls / Ranked Opportunities / All Scan Results) reflows identically at all widths — no new breakpoint logic introduced |
| Raw-results table (now "All Scan Results") | Existing horizontal-scroll/table behavior in `app/screener/page.tsx`'s native results table | **Unchanged** — retained exactly as it is today; not redesigned, not given new responsive treatment, per Ruling 2's "preserve every existing Screener mechanic" |
| Touch targets, new controls (Detailed-tier expand trigger, staleness indicator if interactive) | Existing interactive control sizing conventions in `TodaysPrioritiesQueueView.tsx`'s expand/collapse toggle | Reused verbatim — no new sizing convention invented |
| Section wrapper | `<section aria-label="...">` convention used by `TodaysPrioritiesQueueView.tsx` (`aria-label="Today's Priorities"`, `aria-label="Open Priorities"`) and `HealthyMonitoringSection.tsx` (`aria-label="Healthy Position Monitoring"`) | Reused for the new `id="ranked-opportunities"` wrapper (§17) and the relabeled "All Scan Results" section |
| Collapsible content | `TodaysPrioritiesQueueView.tsx` uses `aria-expanded` on its Completed Priorities toggle | Reused for the Detailed tier (§13) inline expansion |
| Live-region status | `role="status"` used for the amber notice banner in `TodaysPrioritiesQueueView.tsx:201` | Reused for `blockerNotice`, the capital-limitation notice, and staleness banners |
| Dense options data (strikes, DTE, credit) — Detailed tier | No existing horizontal-scroll table pattern found in `BestOpportunitiesPanel` — data is presented as labeled key/value pairs within the stacked card | Detailed tier continues the labeled key/value pattern, not a new wide table — avoids new overflow/touch-target problems |

No new design system is introduced; all patterns above are reused verbatim from Today's Priorities and Positions' existing conventions.

---

## 19. Accessibility Requirements

- Disposition is already communicated via color **and** text label (`DISPOSITION_LABEL`) in `RecommendationCard` — preserved unchanged.
- **Non-color-only requirement extended to new states**: staleness, confidence-unavailable, and the capital-limitation notice must each use icon/text/pattern (not color alone) — matching the existing convention exemplified by `RecommendationCard`'s `⚠`/`✕`/`ℹ`/`?` prefixes (§13) and `features/portfolio/positions/PositionRiskBadges.tsx`'s text-labeled badges (never color-only). No new design language is introduced for these.
- Section-level `aria-label`s (§18) must be preserved/extended for any new subsections — the new `id="ranked-opportunities"` wrapper and the relabeled "All Scan Results" section each need their own accessible name.
- `aria-expanded` on the Detailed-tier trigger, matching `TodaysPrioritiesQueueView.tsx`'s existing pattern (`completedExpanded`, line 258).
- `role="status"` for all new transient banners (staleness, capital-limitation, partial-data, failure), matching the existing convention (`TodaysPrioritiesQueueView.tsx:201`).
- **Heading hierarchy after reorder**: promoting Ranked Opportunities above "All Scan Results" does not change heading *levels* — both remain sibling `<h2>`-equivalent section headings (matching `NewOpportunitiesSection`'s existing `<h2>New Opportunities</h2>` pattern), only their document order changes. No heading is demoted or promoted a level; the scan-controls region's existing heading (if any) remains first.
- **Focus behavior**: inline expansion (Detailed tier) is not a modal/drawer, so no focus-trap is required. On expand, focus is not force-moved (consistent with `TodaysPrioritiesQueueView.tsx`'s existing toggle, which does not relocate focus); the trigger retains focus after toggling, and its `aria-expanded` state updates in place — this is a deliberate simplicity win, not an oversight, matching existing convention.
- **Visible-focus requirement**: reuse the existing focus-ring convention already applied to interactive elements elsewhere in this codebase (e.g. `TodaysPrioritiesQueueView.tsx`'s toggle) — no new focus style introduced.
- **Status/error announcements**: `role="status"`/`aria-live` behavior for the capital-limitation notice, staleness indicator, and `blockerNotice` all follow the existing `role="status"` convention (§18) — no `aria-live="assertive"` is introduced anywhere in this CES, consistent with the non-blocking, non-error nature of these disclosures (only genuine failures use the existing `opportunityError`/`blockerNotice` failure path).
- **Dynamic text resilience**: existing `RecommendationCard` uses flexible `flex`/`space-y` layout, not fixed-width containers — the Detailed tier and capital-limitation notice follow the same pattern to avoid truncation at larger text sizes.

---

## 20. Acceptance Criteria

Every criterion is individually numbered, testable, and tagged with its verification level: **[C]** component test, **[P]** page/integration test, **[R]** repository/static inspection.

| # | Criterion | Level |
|---|---|---|
| AC-1 | `/screener` remains the canonical Opportunities route; no new route is created | R |
| AC-2 | No `/portfolio` "Opportunities" tab or sub-tab is added; the `tab` deep-link allow-list is unchanged | R |
| AC-3 | On `/screener`, scan controls render first, above both Ranked Opportunities and "All Scan Results" | P |
| AC-4 | Ranked Opportunities renders above "All Scan Results" whenever both are present | P |
| AC-5 | "All Scan Results" retains its existing filtering, CSV export, and all existing scan-mode mechanics unchanged | P |
| AC-6 | Ranked Opportunities does not render before a scan has produced evaluable results, per §11's definition | P |
| AC-7 | Mission Control (`NewOpportunitiesSection`) renders only a compact count/link — never the full `BestOpportunitiesPanel` recommendation list | C |
| AC-8 | Mission Control's count equals the number of non-`REJECTED` recommendations (`RECOMMENDED` + `ACCEPTABLE_ALTERNATIVE` + `WATCH`) in the current ranked set; it never labels this count "new" | C |
| AC-9 | Mission Control's link targets `/screener#ranked-opportunities`, and that id exists, unique, on `/screener` | P |
| AC-10 | No page in the app contains two elements with the same `id` among `best-opportunity`/`ranked-opportunities` | R |
| AC-11 | The Detailed tier renders for every candidate card, expandable via `aria-expanded`, showing the fields specified in §13's tier table | C |
| AC-12 | Every Detailed-tier field absent for a given candidate renders "Not available" (or `'—'`), never a fabricated value | C |
| AC-13 | Refreshing (re-running a scan) preserves the last valid Ranked Opportunities presentation on screen until the new result resolves | P |
| AC-14 | Initial/not-yet-run state shows an explicit "run a scan" prompt, not an empty-results message, and Ranked Opportunities does not render | P |
| AC-15 | Empty-universe state (zero raw candidates) is visually and textually distinct from "no qualifying opportunities" | P |
| AC-16 | An all-`REJECTED` ranked result renders every `REJECTED` card with its `rejectionReasons` — never "nothing to display" | C |
| AC-17 | A ranked result with `WATCH`/`ACCEPTABLE_ALTERNATIVE` but no `RECOMMENDED` renders normally, with the capital-limitation notice as the only messaging tied to that absence | C |
| AC-18 | State 5 (`results.length > 0`, `rawAnalyses.length === 0`, `recommendations.length === 0`) renders the distinct "Scan results existed, but the evaluation service produced no candidate analyses." message — never `BestOpportunitiesPanel`'s generic "No ranked opportunities to display" copy, and never state 2's message | P |
| AC-18a | State 2 (`rawAnalyses.length > 0`, `recommendations.length === 0`, successful evaluation response) renders the distinct "Candidates were analyzed, but none could be adapted or ranked." message — never state 5's message, and never state 1's "Empty universe" message | P |
| AC-19 | A scan-producer or recommendations-evaluation failure renders the existing `blockerNotice`/`opportunityError` failure state, never a silent empty list | P |
| AC-20 | Stale ranked results (superseded by a newer completed scan) remain visible and inspectable, with a non-color-only stale indicator | P |
| AC-21 | Confidence-unavailable (`confidence.overall` missing/null) renders as "confidence unavailable," never coerced to `0` | C |
| AC-22 | The capital-limitation notice renders, persistent and non-dismissible, whenever `recommendations.length > 0`, using the frozen copy (§10.1) | C |
| AC-23 | No text anywhere in the Ranked Opportunities section implies "no recommendable trades exist" due solely to the absence of `RECOMMENDED` | P |
| AC-24 | Detailed-tier expansion is keyboard-operable and uses `aria-expanded`; focus is not force-relocated on toggle | C |
| AC-25 | All new banners (capital-limitation, staleness, partial-data) use `role="status"`, matching existing convention | C |
| AC-26 | Disposition, staleness, and capital-limitation states are each communicated via icon/text, not color alone | C |
| AC-27 | Heading hierarchy after reorder keeps Ranked Opportunities and "All Scan Results" as sibling-level headings; no level is promoted/demoted | R |
| AC-28 | The primary-navigation label remains exactly `SCREENER`; no rename occurs | R |
| AC-29 | Mobile/tablet/desktop: no new responsive breakpoint is introduced; raw-results table retains existing horizontal-scroll behavior unchanged | P |
| AC-30 | No execution/order-submission affordance (button, form, or otherwise) exists anywhere in the Opportunities workspace | R |
| AC-31 | No file under `lib/opportunity-engine/`, `lib/decision-engine/`, or `lib/autopilot/decision/` is modified by this sprint's implementation | R |
| AC-32 | `OpportunityContext.availableCapital` remains `0`; no PortfolioMode gating is added to `/screener` | R |
| AC-33 | WA-0006 (Legacy Priority List retirement) is untouched — no file under its scope is modified | R |
| AC-34 | No new Ranked Opportunities sorting or disposition-filter control exists; the canonical `DISPOSITION_SORT_RANK` order is the only display order; every `REJECTED` candidate remains visible and inspectable by default, with no hide/show toggle | R |

---

## 21. Required Implementation Seams

1. `NewOpportunitiesSection.tsx` — reduce to a compact count/link ("N ranked opportunities — Review", per §11's exact count contract); remove the embedded full `BestOpportunitiesPanel` mount; repoint its own internal anchor usage if needed, retaining its own `id="best-opportunity"` for backward link compatibility (§17).
2. `BestOpportunitiesPanel.tsx` — correct its stale top-of-file comment; add the required Detailed tier (§13) as inline `aria-expanded` expansion, accepting a new optional `candidateDetails` prop; add the capital-limitation notice region (§10.1); add non-color-only staleness rendering (§16, §19).
3. `app/screener/page.tsx` — reorder sections per Ruling 2 (§10.2, §11); relabel the raw-results section "All Scan Results"; add the `id="ranked-opportunities"` anchor; add staleness (session-supersession) and partial-data disclosure per §15/§16; preserve last-valid results during refresh.
4. **New file**: `lib/command-center/opportunityCandidateDetails.ts` (or equivalent narrowly-scoped, additive, presentation-only module) — projects the already-available `DecisionAnalysis[]` (from `rawAnalyses`/`useCurrentRecommendations()`) into a `decisionAnalysisId`-keyed detail index for the Detailed tier (§13). Presentation-only; does not modify `lib/opportunity-engine` or `lib/decision-engine` types.
5. `components/command-center/CommandCenterNav.tsx` — repoint the "Opportunity Review" link from `#best-opportunity` to `/screener#ranked-opportunities` (§17).

None of the above modifies `lib/opportunity-engine`, `lib/decision-engine`, or `lib/autopilot/decision`. `OpportunityContext.availableCapital` remains `0` (Ruling 1, §10.1) — not listed as a seam here, since this CES does not change it.

---

## 22. Required Test Plan

**Corrective round 3 finding:** the prior draft assigned all six §15 states to `BestOpportunitiesPanel`'s component suite. Several states depend on page-owned inputs (`results`, `rawAnalyses`, `opportunityState`, `opportunityError`, prior-valid-results snapshot) that are never passed to `BestOpportunitiesPanel` as isolated props — a component-level render of the panel cannot construct these states on its own. Test ownership is corrected below to match what each layer can actually express.

**`components/opportunity-engine/BestOpportunitiesPanel.test.tsx` (component-level — presentation states expressible solely through panel props):**
- All-`REJECTED` presentation (state 3): `rejectionReasons` rendered for every card, never "nothing to display."
- `WATCH`/`ACCEPTABLE_ALTERNATIVE`-without-`RECOMMENDED` presentation (state 4): renders normally, capital-limitation notice is the only messaging tied to the absence.
- Candidate-detail (Detailed tier) availability: expansion behavior, "Not available" rendering for missing fields.
- Capital-limitation notice: presence, exact copy (§10.1), persistence, non-color-only treatment.
- Confidence-unavailable: `confidence.overall` missing/null renders "confidence unavailable," never coerced to `0`.
- Genuinely-supplied empty recommendation presentation, if still applicable: a narrow, panel-only unit test asserting the panel itself does not crash or fabricate content when passed `recommendations={[]}` directly as a prop, independent of *why* the array is empty — this is a component-isolation safety test, not a substitute for the page-level state-2/state-5 distinction below, which the panel cannot express on its own.

**`app/screener/__tests__/` page/integration test (new — exact filename to be determined at implementation time; no `app/screener` test file exists in the repository today, per §5/§21, so this follows the established `app/<route>/__tests__/<PageName>.test.tsx` convention already used by `app/portfolio/__tests__/PortfolioPage.test.tsx`, rather than inventing a specific filename here):**
- Initial/not-yet-run state (no scan run this session).
- Completed scan with zero raw candidates (state 1, "Empty universe").
- Raw analyses present but zero adapted/ranked recommendations (state 2) — asserts AC-18a's exact message, distinct from state 5.
- Successful evaluation returning zero analyses (state 5) — asserts AC-18's exact message, distinct from state 2 and never the generic `BestOpportunitiesPanel` empty copy.
- Partial evaluation (some candidates evaluated, others skipped) — disclosed via `blockerNotice` or an explicit count.
- First-scan failure (no prior valid results) — distinct from failed refresh below.
- Failed refresh with prior valid results — prior results remain visible, not replaced by the failure state.
- Refresh preservation — last valid Ranked Opportunities presentation stays on screen until the new result resolves (§16).
- Session-supersession staleness — non-color-only stale indicator, results remain inspectable.
- Section order (scan controls → Ranked Opportunities → "All Scan Results"), the "evaluable results" gating (§11), and the new `id="ranked-opportunities"` anchor's uniqueness.

**`components/mission-control/NewOpportunitiesSection.test.tsx`** — confirms it renders a count/link, not the full recommendation list; that the count equals non-`REJECTED` entries; that the link resolves to `/screener#ranked-opportunities`.

**`lib/command-center/opportunityCandidateDetails.test.ts` (new)** — unit tests confirming correct id-keyed projection, correct handling of a missing `candidate`/individual optional fields (never fabricating values), and no mutation of the input `DecisionAnalysis[]`.

**`components/command-center/__tests__/CommandCenter.test.tsx`** — updated to assert the "Opportunity Review" link targets `/screener#ranked-opportunities`.

No changes required to `lib/opportunity-engine/__tests__/*`, `lib/decision-engine`, or `lib/autopilot/decision` test suites — none of their logic changes.

---

## 23. Out-of-Scope List

- Trade execution / order submission (no approved workflow exists anywhere in the codebase, §3).
- Any redesign of scoring, ranking, evaluation, recommendation, disposition, confidence, portfolio-health, strategy-eligibility, or risk-gate logic.
- Mounting or un-orphaning `components/command-center/CommandCenter.tsx`/`BestOpportunityCard.tsx` (deferred, §9).
- Building a Repeat-Trade or Watchlist Opportunity Engine adapter (explicitly out of OE-0001's scope, §5.2).
- Any change to `/rinse-repeat` or `/engine`'s internal candidate models.
- Today's Priorities queue behavior (frozen, WA-0003).
- WA-0006's navigation/legacy-Priority-List retirement work.
- Autopilot execution work.
- New backend/persistence infrastructure for full ranked-result survival across hard reloads (§16).
- PortfolioMode gating and canonical capital wiring for `/screener` (Ruling 1, §10.1) — deferred to OE-0003.
- Any elapsed-time-based staleness threshold (§16) — deferred future work, not part of this freeze.

---

## 24. Risks and Prior Review Findings

- **Stale documentation risk**: `BestOpportunitiesPanel.tsx`'s own top-of-file comment is actively misleading about mount status (§5.3) — corrected by this CES's implementation seam (§21).
- **Mission Control drift risk**: `NewOpportunitiesSection` diverged from a binding ruling for at least one prior sprint (WA-0002) without being caught — the fix in §9/§21 closes this.
- **Anchor-location drift risk (newly surfaced by this corrective round)**: WA-0001 stated the intent to move `#best-opportunity` to `/screener` (§5.8) but that never happened across three subsequent sprints (WA-0002 through the prior WA-0005 draft, which itself repeated the unverified claim). §17's `id="ranked-opportunities"` finally closes this — future CES authors should re-verify anchor claims against source, not against prior CES prose, going forward.
- **Capital-limitation notice risk**: if implementation drifts from the frozen copy (§10.1) or makes the notice dismissible, the binding "no false absence-of-quality implication" requirement (§15) could silently regress — mitigated by AC-22/AC-23 (§20) asserting on exact behavior, not just presence.

---

## 25. Deferred Opportunities

- PortfolioMode-gating `/screener` and wiring real available capital — tracked as **OE-0003** (§10.1), not a new ticket.
- Repeat-Trade/Watchlist Opportunity Engine adapters, unifying discovery across `/rinse-repeat`/`/engine`/`/screener` (explicitly deferred by OE-0001, reaffirmed here).
- Full ranked-result persistence across hard reload (§16) — no evidence yet that the accepted product outcome requires it.
- Extending `TE-0005A`-style background execution to filter/targeted/PMCC/CSP scan modes.
- Retiring `components/command-center/CommandCenter.tsx`/`BestOpportunityCard.tsx` (orphaned, zero-risk cleanup, not this ticket's job — §9).
- Any future ranking-rule changes (recorded only as a future consideration, not designed here, §14).
- An elapsed-time-based staleness *warning* on top of the session-supersession rule (§16) — no repository evidence today supports a specific threshold value.

---

## 26. Proposed Implementation Sequence

1. Correct `BestOpportunitiesPanel.tsx`'s stale status comment (documentation-only).
2. Reduce `NewOpportunitiesSection.tsx` to a compact count/link (§9, §21) — operationalizes WA-0001's already-binding ruling.
3. Implement `/screener`'s IA reorder per Ruling 2 (§10.2, §11): scan controls → Ranked Opportunities (new `id="ranked-opportunities"` anchor) → "All Scan Results."
4. Repoint `CommandCenterNav.tsx`'s "Opportunity Review" link to `/screener#ranked-opportunities` (§17, §21).
5. Add the capital-limitation notice (§10.1) to `BestOpportunitiesPanel`.
6. Add staleness (session-supersession) and partial-data disclosure states (§15, §16).
7. Add `lib/command-center/opportunityCandidateDetails.ts` and extend `RecommendationCard` with the Detailed tier (§13).
8. Write/extend the test suites per §22.

No step depends on OE-0003 (Ruling 1's follow-on) or any other still-unscoped ticket.

---

## 27. Exact Expected Implementation Artifacts

| File | Change |
|---|---|
| `components/mission-control/NewOpportunitiesSection.tsx` | Reduce to compact count/link; remove full `BestOpportunitiesPanel` embed; count/link contract per §11 |
| `components/mission-control/NewOpportunitiesSection.test.tsx` (or equivalent, if exists) | New/updated tests for compact rendering, count contract, link target |
| `components/opportunity-engine/BestOpportunitiesPanel.tsx` | Correct stale top-of-file comment; add required Detailed-tier inline expansion; add capital-limitation notice; add non-color-only staleness rendering |
| `components/opportunity-engine/BestOpportunitiesPanel.test.tsx` | Extend for Detailed-tier expansion, capital-limitation notice, confidence-unavailable, states 3 and 4 only, plus the panel-isolation empty-props test — per §22's corrected ownership, not all six §15 states |
| `app/screener/page.tsx` | IA reorder per Ruling 2; "All Scan Results" relabel; `id="ranked-opportunities"` anchor; staleness/partial-data state rendering; preserve-on-refresh behavior |
| `app/screener/__tests__/` (new page/integration test; exact filename determined at implementation time, following the `app/<route>/__tests__/<PageName>.test.tsx` convention — no `app/screener` test file exists today, §22) | States 1, 2, 5, 6, partial-evaluation, first-scan failure, failed refresh, refresh preservation, session-supersession staleness, section order, evaluable-results gating, anchor uniqueness — per §22's corrected ownership |
| `lib/command-center/opportunityCandidateDetails.ts` (new) | Additive, presentation-only projection from `DecisionAnalysis[]` to a `decisionAnalysisId`-keyed detail index (§13, §21) |
| `lib/command-center/opportunityCandidateDetails.test.ts` (new) | Unit tests for the projection module |
| `components/command-center/CommandCenterNav.tsx` | Repoint "Opportunity Review" link to `/screener#ranked-opportunities` |
| `components/command-center/__tests__/CommandCenter.test.tsx` | Update assertion for the new link target |
| `docs/design/WA-0005-Opportunities-Workspace-CES.md` | This document (design-only artifact of this sprint) |
| `docs/implementation/WA-0005-Opportunities-Workspace-Implementation-Report.md` | To be written when implementation is authorized and completed (not part of this sprint) |

No file under `lib/opportunity-engine/`, `lib/decision-engine/`, or `lib/autopilot/decision/` appears in this table — none of them change.

---

## 28. Stop/Go Recommendation

**Go** — this corrected draft resolves both Product Owner decisions the prior draft left open (§10) as binding rulings, closes the internal-consistency defects the acceptance review found (Acceptance Criteria §20, the no-qualifying-opportunities contract §15, the candidate-detail contract §13, the staleness contract §16, and the anchor-location correction §17), and ends with **zero unresolved Product Owner decisions required to freeze.**

**Product Owner acceptance recorded: this document is accepted and frozen. Implementation of WA-0005 is authorized** against §20's Acceptance Criteria and §26's Proposed Implementation Sequence, without further design escalation, since no open product decision remains.
