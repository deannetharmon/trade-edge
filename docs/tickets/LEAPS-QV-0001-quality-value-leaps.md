# LEAPS-QV-0001 — Quality Value LEAPS Discovery

**Product:** TradeEdge  
**Ticket:** LEAPS-QV-0001  
**Strategy:** Quality Value LEAPS  
**Initial Strategy Version:** QV-v1.0  
**Status:** APPROVED — IMPLEMENTATION AUTHORIZED  
**Current Gate:** Gate 3 — QV-v1.0 Underlying Strategy  
**Current Gate Status:** IMPLEMENTED — PENDING REVIEW  
**Implementation Agent:** Claude Code  
**Facilitator:** Frank  
**Product Owner:** Paul  
**Investment / Portfolio / Options:** Ian  
**Engineering:** Dane  
**Architecture / Quality:** Quinn  
**Sponsor:** Dean

## 1. Purpose

TradeEdge currently provides an existing **Find LEAPS** capability. This ticket adds a second, independent discovery methodology: **Find Quality Value LEAPS**.

The governing investment principle is:

> **Quality + Valuation Dislocation + Fundamental Thesis Intact + Stabilization/Recovery Evidence + Efficient LEAPS Structure**

Do not reduce the strategy to “low P/E + low RSI = buy LEAPS.” P/E and RSI are evidence inside a broader framework.

## 2. Core Decision Sequence

QV-v1.0 answers two independent questions in order.

### A. Is the underlying attractive?

Evaluate business quality, valuation, growth-adjusted valuation, fundamental integrity/momentum, technical condition, and risk/event exposure.

### B. Is there an attractive LEAPS structure?

Only after the underlying qualifies, evaluate expiration, delta/exposure, debit, capital efficiency, extrinsic value, theta, IV/vega, liquidity, breakeven, and scenario economics.

A good company does not automatically imply a good LEAPS trade. An attractive-looking option does not compensate for a failed underlying thesis.

## 3. Existing Find LEAPS Protection

The existing **Find LEAPS** functionality remains supported and behaviorally unchanged. QV-v1.0 does not replace it.

The existing finder may eventually operate behind a shared strategy abstraction only if behavioral equivalence is demonstrated by regression tests. If migration creates meaningful regression risk, do not migrate it during QV-v1.0.

## 4. User Experience

TradeEdge ultimately exposes:

- **Find LEAPS** — existing methodology.
- **Find Quality Value LEAPS** — QV-v1.0.

Rankings remain independent. If a ticker independently qualifies under both, display **CROSS-STRATEGY MATCH**. This is informational in v1.0 and creates no automatic ranking bonus.

## 5. Discovery Pipeline

Stock Universe → Quality Gate → Historical Valuation / Valuation Dislocation → Growth-Adjusted Valuation → Fundamental Integrity / Momentum → Technical Opportunity → Risk / Event Evaluation → Candidate Classification → LEAPS Availability & Suitability → Underlying Ranking → Contract Ranking → Scenario Analysis.

Use staged evaluation. Expensive option-chain retrieval should occur only after inexpensive stock-level evaluation substantially reduces the universe.

## 6. Discovery Strategy Architecture

QV-v1.0 should be implemented through a reusable **TradeEdge Discovery Strategy Engine**.

Conceptual flow:

Market / Fundamental / Options Data → Provider Adapters → Normalized Metrics → Versioned Strategy Engine → Candidate Classification → LEAPS Contract Engine → Scenario Engine → Presentation / Tracking.

Potential provider boundaries include FundamentalsProvider, EstimatesProvider, MarketDataProvider, OptionsProvider, and EventsProvider. Names are conceptual, not mandatory.

**Rule:** strategy logic consumes normalized TradeEdge data rather than provider-specific response structures.

## 7. Strategy Versioning

Every evaluation identifies strategy ID and strategy version. Initial version is **QV-v1.0**. Future investment-logic changes require an intentional version decision. Historical QV-v1.0 decisions must remain reproducible.

## 8. Normalized Metric Semantics

Every normalized metric must distinguish:

- VALID
- UNAVAILABLE
- STALE
- INVALID

Missing data must not silently become zero, average, neutral, pass, or fail. TradeEdge must distinguish a failed criterion from inability to evaluate it.

## 9. Data Completeness

Data completeness is separate from investment quality. Expose **Data Completeness** alongside investment evaluation. Missing critical evidence may prevent ACTIONABLE even when available metrics look attractive.

## 10. Quality Gate

Quality measures business durability, including as appropriate:

- 5Y revenue CAGR and consistency
- EPS growth and consistency
- Operating margin and trend
- FCF and FCF margin
- ROIC/appropriate return measures
- Earnings/margin/FCF stability
- Debt, net debt, net debt/EBITDA, liquidity, interest burden
- Defensible quantitative durability proxies

Do not claim a mathematically measured “moat” without supporting data.

## 11. Valuation Dislocation

Do not define cheapness solely by P/E. Use appropriate measures such as TTM P/E, forward P/E, historical P/E distribution, 3Y/5Y medians, historical valuation percentile, discount/premium to historical regime, EV/EBITDA, historical EV/EBITDA where feasible, FCF yield, Price/FCF, and PEG where meaningful.

Not every metric applies to every company. Support sector/company-appropriate treatment.

## 12. Historical Valuation

Historical valuation percentile is important. Where practical, calculate distributions internally from reliable historical prices and fundamentals.

Handle negative/near-zero earnings, abnormal observations, missing history, splits, material corporate events, fiscal-period changes, and restatements where data exposes them. Invalid observations must not contaminate distributions.

## 13. Growth-Adjusted Valuation

Distinguish temporary multiple compression in a durable business from rational repricing caused by deteriorating economics. Consider historical/current/forward growth where reliable, margin trajectory, EPS trajectory, FCF trajectory, and growth-adjusted measures such as PEG where meaningful.

## 14. Fundamental Integrity and Momentum

Price momentum and fundamental momentum are separate.

Fundamental state:
- DETERIORATING
- STABILIZING
- IMPROVING

Inputs may include revenue, EPS, FCF, margin trajectory, company guidance, and analyst revisions where available.

## 15. Analyst Estimates and Revisions

Analyst revisions are **CONDITIONAL**, not universally mandatory.

Where reliable data exists, consider EPS/revenue revisions over useful horizons, current/next-year changes, and revision breadth.

Where unavailable, explicitly report **Analyst Revision Data: UNAVAILABLE**. Do not classify missing revisions as neutral/stable/positive. Other independent fundamental evidence may support the thesis but must not be mislabeled as analyst revisions.

Missing revisions become more consequential when other fundamentals deteriorate.

## 16. Technical State

Do not implement “RSI < X = buy.”

Classify:
- DECLINING
- OVERSOLD
- STABILIZING
- RECOVERING

Inputs may include weekly RSI, RSI slope, monthly RSI, distance from 52-week high, moving-average relationships/trends, relative strength, base formation, and momentum inflection.

Highest-conviction opportunities may occur during STABILIZING → RECOVERING rather than at the lowest RSI.

## 17. Fundamental + Technical Convergence

Examples:
- Fundamentals deteriorating + technicals declining → weak.
- Fundamentals intact + oversold but still declining → WATCH.
- Fundamentals stable/improving + technical stabilization → SETUP.
- Valuation dislocated + fundamentals intact/improving + recovery beginning → stronger setup.

QV-v1.0 rules must be deterministic and versioned.

## 18. Risk / Event Evaluation

Risk is first-class. Consider available evidence for earnings, guidance changes, regulatory events, litigation, corporate actions, binary events, balance-sheet stress, abnormal volatility, liquidity, and company-specific event risk.

Routine upcoming earnings do not automatically disqualify long-duration LEAPS. Flag and evaluate event/IV relevance. Binary thesis-changing events require stronger handling.

## 19. Candidate Lifecycle

Persistent lifecycle:

DISCOVERED → WATCH → SETUP → ACTIONABLE

Reverse transitions are permitted. Additional states:
- INVALIDATED
- EXPIRED

Definitions:
- **DISCOVERED:** entered QV evaluation universe.
- **WATCH:** potential opportunity but convergence insufficient.
- **SETUP:** thesis attractive but entry/contract requirements incomplete.
- **ACTIONABLE:** required QV-v1.0 underlying criteria and acceptable LEAPS structure satisfied.
- **INVALIDATED:** underlying thesis materially failed; preserve history.
- **EXPIRED:** no longer relevant under applicable horizon.

## 20. Insufficient Data

Add **INSUFFICIENT_DATA** as an evaluation result distinct from investment failure. It need not be a persistent lifecycle state.

## 21. State Transition History

Material transitions record fromState, toState, timestamp, strategy, strategyVersion, metricSnapshotId, and reasonCodes.

## 22. Explainability

Explainability is mandatory. Decisions emit structured reason codes, e.g.:

- QUALITY_FCF_POSITIVE
- QUALITY_MARGIN_STABLE
- VALUATION_PE_PERCENTILE_LOW
- VALUATION_FCF_YIELD_ATTRACTIVE
- FUNDAMENTAL_MOMENTUM_STABILIZING
- TECHNICAL_RSI_RECOVERING
- TECHNICAL_STATE_DECLINING
- RISK_EARNINGS_APPROACHING
- DATA_ANALYST_REVISIONS_UNAVAILABLE

Exact names may change. Human-readable explanations must derive from the same structured decision evidence used by the strategy, not an independent UI explanation algorithm.

## 23. Ranking Model

Maintain independent dimensions:
- Quality
- Valuation Opportunity
- Fundamental Momentum
- Technical State
- Risk
- LEAPS Efficiency
- Data Completeness

An overall ranking may be calculated, but component rankings remain visible/explainable. High theoretical option return cannot override a required Quality or Risk failure.

## 24. Underlying vs Contract Ranking

Keep separate:
- **Underlying Ranking:** attractiveness of stock under QV-v1.0.
- **Contract Ranking:** efficiency of a LEAPS contract for an attractive underlying.

## 25. LEAPS Suitability

Evaluate DTE, strike, delta, dollar delta, debit, effective leverage, theta, extrinsic value, IV, vega, bid/ask, OI, volume, and breakeven.

If underlying qualifies but no acceptable contract exists, preserve it as e.g. **SETUP — No Suitable LEAPS Structure**.

## 26. Historical IV

Current IV is usable if reliable. Do not display IV Rank or IV Percentile without sufficient historical IV observations to calculate it correctly.

## 27. Scenario Analysis

QV-v1.0 emphasizes expiration economics. Generate Bear/Base/Bull scenarios with visible assumptions.

For each show:
- Earnings/fundamental assumption
- Valuation multiple
- Implied underlying price
- Expiration
- Strike
- Original debit
- Expiration intrinsic value
- Dollar gain/loss
- Percentage return
- Breakeven relationship

At expiration: `optionValue = max(stockPrice - strike, 0)`.

These are conditional scenarios, not forecasts. Pre-expiration theoretical option pricing is out of scope unless separately approved.

## 28. Persistent Discovery Snapshot

Persist where applicable:
- Strategy ID/version
- Timestamp
- Underlying and price
- Metric values and validity
- Gate outcomes
- Reason codes
- Candidate state
- Component/overall rankings
- Risk flags
- Data completeness
- Selected LEAPS contract
- Contract market data
- Scenario assumptions/results

## 29. Survivorship Bias Protection

Retain winners, losers, invalidated theses, WATCH candidates that never progress, SETUP candidates that regress, ACTIONABLE candidates that later fail, and insufficient-data evaluations.

## 30. Future Validation

Full backtesting is outside QV-v1.0, but captured data must support later comparison against broad/sector benchmarks, comparable non-qualifiers, and existing Find LEAPS.

Potential measures: absolute/excess return, hit rate, MFE, MAE, drawdown, time to recovery, underlying return, and LEAPS return.

QV-v1.0 is an investment hypothesis being operationalized and measured; profitability is not assumed.

## 31. Observability

Capture strategy/version, universe size, gate pass/fail counts, missing/invalid data counts, provider failures, option-chain failures, scan duration, resource/API use where practical, candidate-state counts, and invalidation transitions.

The system must distinguish “no opportunities found” from “scan failed to evaluate correctly.”

## 32. Testing Requirements

Quinn owns the quality gate. Required categories include normalized metric tests, investment-rule tests, classification fixtures, boundary tests, missing/stale/invalid-data tests, provider normalization, strategy-version reproducibility, existing Find LEAPS regression, scenario tests, reason-code/explanation tests, state-transition tests, and pipeline/integration tests.

## 33. Performance Architecture

Use staged evaluation: broad universe → inexpensive quality/basic valuation → smaller universe → detailed valuation/fundamental/technical analysis → risk enrichment → qualifying universe → option-chain retrieval → LEAPS analysis.

Do not make expensive options calls for equities already failing underlying requirements.

## 34. Discovery Is Not an Order

QV classifications are WATCH, SETUP, ACTIONABLE—not BUY. This ticket does not authorize automated orders.

## 35. QV-v1.0 MVP Scope

Included:
- Strategy Engine capabilities required for QV
- Versioning
- Normalized metrics
- Quality
- Historical/growth-adjusted valuation
- Fundamental integrity/momentum
- Technical state
- Risk
- Candidate lifecycle
- Missing-data handling
- LEAPS suitability
- Underlying/contract ranking
- Expiration scenarios
- Explainability
- Cross-strategy matching
- Persistent snapshots
- Observability
- Testing

## 36. Explicitly Out of Scope

- Automated order execution
- Portfolio allocation
- Automated position management/rolling
- Notifications
- AI discretionary overrides
- Full historical backtesting platform
- Momentum/Growth/other discovery strategies
- Unrelated redesign of existing Find LEAPS

## 37. Data Feasibility Findings

Expected available/derivable: historical prices; revenue/EPS/margin/cash-flow/balance-sheet history; daily technicals; weekly/monthly RSI; moving averages; relative strength; current option chains/Greeks/OI/volume/bid-ask/LEAPS expirations/current IV.

Implementation validation needed: historical valuation distributions and canonical ROIC.

Potential external-data constraints: historical analyst estimate/revision data and historical IV series.

No silent substitution of investment-significant unavailable inputs.

## 38. Roles

- **Claude Code:** implementation agent; reads entire spec and implements only authorized gate.
- **Dane:** engineering authority.
- **Quinn:** architecture/quality authority.
- **Ian:** investment authority.
- **Paul:** Product Owner.
- **Frank:** facilitator; drives gates, reviews, corrections, and approvals continuously.
- **Dean:** sponsor; escalate material product/investment/scope changes or unresolved controversial issues, not routine handoffs.

## 39. Claude Code Execution Protocol

This is the authoritative specification.

Claude must:
1. Read the entire ticket before modifying code.
2. Inspect existing TradeEdge architecture/conventions.
3. Understand future gates when making architectural decisions.
4. Implement **only the currently authorized gate**.
5. Run applicable tests and regressions.
6. Review its own diff.
7. Produce the Gate Completion Report.
8. STOP before the next gate.

Possession of the full specification is not authorization to implement all gates.

## 40. Gate Completion Report

At the end of every gate return:
- **Implementation Summary**
- **Files Changed** and purpose
- **Architecture Decisions** and rationale
- **Tests Added**
- **Tests Executed** and results
- **Regression Status**
- **Deviations**
- **Data Findings**
- **Concerns**
- **Branch + Commit SHA**

Then: **STOP. Do not begin the next gate.**

# 41. Implementation Gates

## GATE 1 — Discovery Framework Foundation
**Status: APPROVED (Quinn, final commit 729124f78b48336c9ba9f4694a2af036827006b5)**

Objective: establish architecture without QV investment logic.

Implement:
1. Strategy identity/versioning
2. Strategy execution contract/interface
3. Normalized metric contracts
4. Metric validity: VALID / UNAVAILABLE / STALE / INVALID
5. Structured reason-code model
6. Lifecycle: DISCOVERED / WATCH / SETUP / ACTIONABLE / INVALIDATED / EXPIRED
7. INSUFFICIENT_DATA evaluation outcome
8. Candidate snapshot model
9. State-transition history
10. Scan observability model
11. Unit tests

Do not implement QV thresholds/scoring, valuation calculations, technical/fundamental investment rules, scenario engine, QV UI, new LEAPS ranking, or existing finder redesign.

**Exit review: Quinn** — architecture, isolation, testability, versioning, state/snapshot model, missing-data semantics, reason codes, regression risk. Gate 2 requires Quinn approval.

## GATE 2 — Normalized Metrics & Data Audit
**Status: APPROVED (Dane + Quinn, final Gate 2 commit d518bc53aad6c0537c9ccd8f27ee888ab6fd2e93)**

Implement/map quality, valuation, fundamental, technical, and existing options metrics. Classify each AVAILABLE / DERIVABLE / CONDITIONAL / UNAVAILABLE. Investigate analyst revisions and historical IV. No silent substitutes.

**Exit review: Dane + Quinn.** Escalate investment-significant data limitations to Ian.

## GATE 2b — SEC Fundamentals Adapter
**Status: APPROVED / CLOSED (final Gate 2b commit a8d5b65)**

Objective: make the approved QV Quality/Valuation evidence operational using SEC EDGAR XBRL/companyfacts without introducing Gate 3 investment logic.

Implement only the provider/data work required to feed the normalized fundamentals layer: ticker→CIK resolution; SEC-compliant User-Agent/rate limiting; caching; deterministic/versioned XBRL concept resolution; fiscal-period and TTM construction; amended/restated filing handling; provenance; fail-closed ambiguity handling; historical fundamental observations sufficient for supported valuation history; tests and observability. Unsupported/non-covered securities remain UNAVAILABLE, never investment failures.

Do not implement Gate 3 thresholds, scores, classifications, rankings, or lifecycle decisions. Forward estimates/revisions/guidance remain UNAVAILABLE unless a separately approved reliable source exists.

**Ian methodology rulings before Gate 2b:** ROIC-v1 approved as defined; QV-v1.0 primary relative-strength benchmark = SPY over 126 trading days; provider IV Rank remains source-labelled informational evidence only; analyst revisions remain optional/explicitly UNAVAILABLE when absent; close-based 52-week high is accepted when labelled; ACTIONABLE later requires sufficient evidence of business quality, valuation dislocation, and intact/non-deteriorating fundamentals, but not every catalog metric. Forward estimates, analyst revisions, company guidance, historical IV, PEG, and event feeds are optional enrichments and do not independently block a candidate solely because unavailable. Deterministic consistency/stability formulas and investment thresholds are Gate 3 work after Gate 2b data is validated.

**Exit review: Dane + Quinn for data correctness/architecture; Ian for whether the resulting fundamental evidence is fit for Gate 3.**

## GATE 3 — QV-v1.0 Underlying Strategy
**Status: AUTHORIZED**

Implement the approved deterministic QV-v1.0 underlying-stock strategy specified in **Section 45 — Gate 3 Final Strategy Specification**.

Gate 3 determines underlying eligibility and lifecycle/evaluation classification only. It must not implement LEAPS contract ranking, DTE/delta selection, option liquidity/entry pricing, scenario analysis, QV UI, portfolio sizing/allocation, execution, rolling, notifications, or AI discretionary overrides.

Prove representative DISCOVERED, WATCH, SETUP, UNDERLYING ACTIONABLE, INVALIDATED, and INSUFFICIENT_DATA cases without contract ranking.

**Exit review: Quinn + Ian + Paul, facilitated by Frank.** Gate 4 remains blocked.

## GATE 4 — LEAPS Integration
**Status: BLOCKED**

Implement LEAPS availability, eligibility, DTE, delta/exposure, debit, capital efficiency, extrinsic value, theta, IV, vega, liquidity, breakeven, and contract ranking. Keep underlying and contract attractiveness separate.

**Exit review: Ian + Quinn.**

## GATE 5 — Scenario Engine
**Status: BLOCKED**

Implement transparent Bear/Base/Bull expiration economics from Section 27 with visible/reproducible assumptions.

**Exit review: Ian + Quinn.**

## GATE 6 — Quality Value UI
**Status: BLOCKED**

Implement **Find Quality Value LEAPS** while preserving existing **Find LEAPS**. Expose candidate state, component dimensions, risk, LEAPS efficiency, data completeness, explanations, scenarios, and cross-strategy match.

**Exit review: Paul + Quinn.**

## GATE 7 — Persistence & Learning Dataset
**Status: BLOCKED**

Implement/verify persistence of scans, versions, evaluations, metrics/validity, gates, states/transitions, reasons, rankings, risk, contracts, and scenarios. Preserve failures/invalidations.

**Exit review: Quinn + Ian.**

## GATE 8 — Final Validation & Release
**Status: BLOCKED**

Dane: technical/performance validation.  
Quinn: architecture/test/data-quality/regression.  
Ian: investment-behavior validation.  
Paul: product acceptance.  
Frank: drive findings to closure.

Required final checks: existing Find LEAPS unchanged; QV deterministic/reproducible; correct missing-data semantics; explanations match decisions; transitions/options/scenarios correct; acceptable scan performance; provider failures visible; no silent substitutions; snapshots retained; required tests passing.

# 42. Approval History

- Paul — Product: APPROVED
- Ian — Investment: APPROVED WITH INCORPORATED REFINEMENTS
- Dane — Technical/Data: APPROVED WITH DATA CAVEATS
- Quinn — Architecture/Quality: APPROVED WITH INCORPORATED REQUIREMENTS
- Paul + Ian Reconciliation: APPROVED
- Frank Full Team Review: APPROVED
- Implementation: AUTHORIZED
- Gate 1 Exit Review — Quinn: APPROVED at 729124f78b48336c9ba9f4694a2af036827006b5 (after corrections B2, S1, B3)
- Gate 2 Exit Review — Quinn: APPROVE WITH CHANGES at 8092be1508d0c641039dd8452c8a7f32a61556df (G2-B1 catalog completeness; FMP wording; SEC path documented; questions routed to Ian)
- Gate 2 Correction: APPROVED at d518bc53aad6c0537c9ccd8f27ee888ab6fd2e93
- Gate 2b Exit Review: APPROVED / CLOSED at a8d5b65
- Gate 3 Methodology: APPROVED by Ian with refinements incorporated by Paul; Quinn implementation-readiness review PASS; Frank gate review PASS
- **Current Authorization: GATE 3 ONLY.** Gate 4 remains blocked.

# 43. Execution Ledger

### Gate 1
Status: APPROVED  
Final Implementation Commit: 729124f78b48336c9ba9f4694a2af036827006b5  
Quinn Architecture/Quality Review: APPROVED  
GitHub CI: PASS  
Vercel: PASS  
Discovery Tests: 113 PASS  
Existing LEAPS Regression Tests: 521 PASS

### Gate 2
Status: APPROVED  
Final Implementation Commit: d518bc53aad6c0537c9ccd8f27ee888ab6fd2e93  
Dane Technical/Data Review: APPROVED  
Quinn Architecture/Quality Review: APPROVED  
GitHub CI: PASS (run 37136402226)  
Vercel: PASS  
Discovery Tests: 182 PASS  
Existing LEAPS Regression Tests: 521 PASS

### Gate 2b
Status: APPROVED / CLOSED  
Final Implementation Commit: a8d5b65  
Purpose: SEC EDGAR fundamentals adapter required to operationalize QV Quality/Valuation evidence before Gate 3.  
Paul Scope/Dependency Approval: APPROVED  
Dane Technical/Data Review: APPROVED  
Quinn Architecture/Quality Review: APPROVED  
Ian Investment/Data-Fitness Review: APPROVED  
Docs: docs/analysis/LEAPS-QV-0001-gate2b-sec-fundamentals.md

### Gate 2c
Status: PROPOSED — NOT AUTHORIZED (specification only; no code)  
Purpose: technical direction metrics (rsi_weekly_slope_1w, price_vs_sma50_gap_change_4w_pp, relative_return_126d_change_4w_pp), SPY benchmark/loader exposure/completed-bar enforcement, and fcf_annual_history_5y from the existing SEC annualSeries. Unblocks Gate 3 SETUP/ACTIONABLE in production.  
Spec: docs/analysis/LEAPS-QV-0001-gate2c-technical-direction-and-fcf-history.md  
Reviews required (none recorded): Ian, Alan, Quinn, Paul

### Gate 3
Status: IMPLEMENTED — PENDING REVIEW (Quinn, Ian, Paul, Frank closure)  
Docs: docs/analysis/LEAPS-QV-0001-gate3-underlying-strategy.md  
Code: lib/discovery/qv/  
Review round 1: CHANGES REQUIRED at e0398a9 — Technical State confluence (direction evidence), missing-trend semantics, assumptions review; corrections implemented, pending re-review. Open: Technical direction metrics (rsi_weekly_slope_1w, price_vs_sma50_gap_change_4w_pp, relative_return_126d_change_4w_pp) are not produced by the normalizer, so no candidate can reach SETUP/ACTIONABLE until they exist; Ian policy questions A1–A6, A8 (see Gate 3 doc); Gate 7 must pass previous state to the strategy. Ratification of A1–A8: NOT REVIEWED.  
Review round 2 (baseline 76dee26): adverse Technical State confluence corrected (DECLINING needs 2+ distinct bearish feature groups; NOT_ESTABLISHED/OVERSOLD/unavailable kept distinct); Gate 2c amendment SPECIFIED, NOT AUTHORIZED: docs/analysis/LEAPS-QV-0001-gate2c-technical-direction-and-fcf-history.md; policy proposals for A1–A6, A8 with examples, NOT APPROVED: docs/analysis/LEAPS-QV-0001-gate3-policy-decisions.md.  
Review round 3 (team review CHANGES REQUIRED at 7a913b4): OVERSOLD now needs non-RSI confirmation; adverse evidence preserved as a trace when data is missing; risk gate NOT_EVALUABLE when event coverage is UNKNOWN; A1/A3 alternatives with counterexamples and A2/A4/A5/A7/A8 REVIEW RECOMMENDATIONS recorded (nothing ratified); Gate 2c spec corrected (6.1 withdrawn implication, calendar/alignment/FCF contract, fixtures). Status tracks: Gate 3 algorithm = IMPLEMENTED — PENDING REVIEW; Gate 2c data = SPECIFIED, NOT AUTHORIZED; production integration = NOT STARTED; Gate 7 previous-state = NOT STARTED. Gate 4 blocked.  
PRODUCTION BLOCKER: no candidate can reach SETUP/UNDERLYING ACTIONABLE until Gate 2c (or equivalent) exists — direction metrics, SPY benchmark (the loader fetches none, so the relative-strength level is UNAVAILABLE in production), technical metrics returned by the loader, completed-bar enforcement. Taxonomy gap (NOT_ESTABLISHED) and strict relative-strength change vs acceleration await Ian. Reviews: none recorded for Gate 2c or A1–A8.  
Gate 3 Tests: see Gate Completion Report for the final counts  
TypeScript (tsconfig.check.json): PASS  
GitHub CI / Vercel: see Gate Completion Report for the exact head  
Specification: Section 45  
Investment Methodology: Ian APPROVED WITH REFINEMENTS; incorporated below  
Quinn Implementation-Readiness Review: PASS  
Frank Gate/Scope Review: PASS

### Gates 4–8
Status: BLOCKED

# 44. Current Claude Instruction

Read this entire document before making changes and inspect the existing TradeEdge implementation and repository conventions.

You are authorized to execute **GATE 3 — QV-v1.0 UNDERLYING STRATEGY ONLY**, exactly as specified in Section 45.

Implementation requirements:
1. Implement Gate 3 policy centrally in the versioned discovery strategy layer.
2. Consume normalized metrics only; no provider-specific strategy logic.
3. Implement Data Sufficiency, Quality, Valuation Dislocation, Growth-Adjusted Valuation, Fundamental Integrity, Fundamental Momentum, Technical State, supported Risk evaluation, and lifecycle/evaluation classification through UNDERLYING ACTIONABLE.
4. Emit structured reason codes/evidence from the same rules used to classify candidates.
5. Preserve VALID / UNAVAILABLE / STALE / INVALID semantics.
6. Implement all Section 45 boundary and behavioral tests.
7. Prove hard-gate failures cannot be overridden by stronger evidence elsewhere.
8. Prove technical regression changes ACTIONABLE -> SETUP/WATCH rather than INVALIDATED when the thesis remains intact.
9. Do not implement Gate 4 functionality.
10. Do not change existing Find LEAPS behavior.
11. Do not add UI work.
12. Do not add new data-provider dependencies merely to satisfy Gate 3.
13. Run TypeScript/type check, Gate 3/discovery tests, relevant fundamentals regressions, and existing Find LEAPS regression suite.
14. Self-review the complete diff for scope leakage and duplicated strategy logic.
15. Update the ticket/gate ledger and relevant Gate 3 implementation documentation.
16. Commit and push the completed Gate 3 implementation.
17. Wait for exact-head CI and Vercel results.
18. Return the Gate Completion Report from Section 40, including branch, SHA, parent SHA, changed files, decisions, tests, CI, Vercel, deviations, and unresolved issues.
19. **STOP. Do not begin Gate 4.**



# 45. Gate 3 Final Strategy Specification

## 45.1 Objective

Implement the deterministic QV-v1.0 **underlying-stock strategy**:

> **Quality + Valuation Dislocation + Fundamental Thesis Intact + Stabilization/Recovery Evidence**

Gate 3 determines whether the underlying is DISCOVERED, WATCH, SETUP, UNDERLYING ACTIONABLE, or INVALIDATED, or produces INSUFFICIENT_DATA. Gate 3 does not determine whether a LEAPS contract should be purchased.

## 45.2 Data Sufficiency

Missing evidence must never be converted into neutral evidence. Each normalized metric retains VALID / UNAVAILABLE / STALE / INVALID semantics.

Required evaluable domains:
1. Quality
2. Valuation
3. Fundamental Integrity / Momentum
4. Technical State

If a required domain cannot be reliably evaluated, return INSUFFICIENT_DATA. Do not use INSUFFICIENT_DATA for unfavorable evidence; high leverage, poor growth, expensive valuation, and weak technicals are investment evidence.

## 45.3 Quality

Quality is multidimensional. Evaluate business durability, profitability, cash generation, balance-sheet strength, and capital efficiency. No single positive metric establishes Quality.

### Revenue durability
- STRONG: 5Y revenue CAGR >= 5%
- ACCEPTABLE: 5Y revenue CAGR >= 0% and < 5%
- WEAK: 5Y revenue CAGR < 0%

Current TTM revenue growth relative to the long-term trend provides reacceleration/deceleration evidence. Negative long-term growth is a significant concern but does not independently cause INVALIDATED.

### Profitability
For the ordinary profitable-company QV-v1.0 universe, operating_margin_ttm > 0 is required.

### Free cash flow
Positive FCF is expected. Distinguish persistent negative FCF, deterioration into negative FCF, and isolated temporary negative FCF using available annual history. One temporary negative period must not automatically invalidate an otherwise intact business.

### ROIC evidence bands
- STRONG: >= 15%
- ACCEPTABLE: >= 10% and < 15%
- WEAK: < 10%

ROIC alone is not a universal hard gate.

### Leverage: Net Debt / EBITDA
- STRONG: <= 1x
- ACCEPTABLE: > 1x to 2x
- ELEVATED: > 2x to 3x
- HIGH: > 3x

HIGH is unfavorable evidence, not INSUFFICIENT_DATA. For ordinary operating companies, HIGH leverage combined with another material Quality weakness fails Quality. If Net Debt/EBITDA is structurally inappropriate and TradeEdge lacks an authorized alternative, that component may become INSUFFICIENT_DATA.

## 45.4 Valuation Dislocation

Historical valuation is primary. Use current P/E, 5Y P/E percentile, 5Y median P/E, discount/premium to 5Y median, reliable 3Y history when 5Y is unavailable, and FCF yield / Price-to-FCF / EV-to-EBITDA as supporting evidence.

### STRONG DISLOCATION
Either:
- 5Y P/E percentile <= 20, OR
- discount to 5Y median >= 20%

### MODERATE DISLOCATION
Either:
- 5Y P/E percentile > 20 and <= 35, OR
- discount to 5Y median >= 10% and < 20%

### NO MATERIAL DISLOCATION
Both:
- 5Y P/E percentile > 35, AND
- discount to 5Y median < 10%

When reliable 5Y evidence is unavailable but reliable 3Y evidence exists, apply the same economic thresholds with reduced confidence; do not invent separate 3Y economic thresholds.

At least MODERATE DISLOCATION is required for SETUP or UNDERLYING ACTIONABLE. Supporting valuation evidence may identify conflicts but does not receive arbitrary cross-industry absolute cutoffs in QV-v1.0. STRONG valuation cannot rescue failed fundamentals.

If percentile and median-discount disagree, either criterion can independently establish its applicable dislocation class. Example: percentile 18 with only 5% median discount is STRONG DISLOCATION.

## 45.5 Growth-Adjusted Valuation

Classify INTACT / MIXED / DETERIORATING using revenue, EPS, operating-margin, FCF, and appropriate leverage trajectories.

- INTACT: no major fundamental growth dimension is materially deteriorating.
- MIXED: one important dimension deteriorates while broader evidence remains stable or improving.
- DETERIORATING: at least two independent major dimensions materially deteriorate, with particular weight to revenue, EPS, operating margin, and FCF.

DETERIORATING cannot become UNDERLYING ACTIONABLE.

## 45.6 Fundamental Integrity

A single weak quarter does not automatically break a long-duration thesis.

QV-v1.0 hard thesis-break rule: **at least three major fundamental dimensions materially deteriorate concurrently** among revenue, EPS, operating margin, FCF, and leverage.

When this occurs, emit FUNDAMENTAL_THESIS_BROKEN. A previously active candidate may become INVALIDATED. Do not implement discretionary "severe deterioration" logic in V1.

## 45.7 Fundamental Momentum

Classify independently from price momentum:
- DETERIORATING
- STABILIZING
- IMPROVING

Use trend direction rather than merely counting positive current values. At least three evaluable fundamental dimensions should normally exist for confident classification.

- IMPROVING: a majority of available major dimensions improve and no major dimension exhibits severe deterioration.
- STABILIZING: previous deterioration has stopped, or the majority of available evidence is stable while broad deterioration is absent.
- DETERIORATING: multiple independent fundamental dimensions continue worsening.

If required fundamental momentum cannot be classified reliably, return INSUFFICIENT_DATA for the component/evaluation as appropriate.

Analyst revisions remain OPTIONAL. When unavailable, emit ANALYST_REVISION_DATA_UNAVAILABLE. Missing revisions receive no neutral score and do not independently block ACTIONABLE.

## 45.8 Technical State

Classify:
- DECLINING
- OVERSOLD
- STABILIZING
- RECOVERING

Use confluence among weekly RSI level/slope, 4-week RSI change, monthly RSI, SMA50 relationship, SMA200 relationship/trend, distance from 52-week high, and 126-day relative strength versus SPY. RSI alone must not determine state.

### DECLINING
Multiple trend indicators demonstrate continuing downside deterioration.

### OVERSOLD
Price/momentum evidence is unusually depressed, but stabilization is not established. OVERSOLD is not a buy signal.

### STABILIZING
Evidence indicates deterioration is ceasing. Core evidence includes weekly RSI slope no longer negative, 4-week RSI change non-negative, and relative-strength deterioration no longer accelerating. Price need not already exceed SMA50.

### RECOVERING
Positive momentum inflection exists through confluence including rising weekly RSI, positive 4-week RSI change, improving relationship to SMA50, and improving relative strength versus SPY. Price above SMA200 is not required.

## 45.9 Risk

Evaluate available evidence for earnings/event proximity, material corporate events, leverage, data completeness, valuation conflicts, and fundamental deterioration.

Ordinary earnings proximity is not an automatic disqualifier for long-duration LEAPS. Where available emit RISK_EARNINGS_APPROACHING. Binary/corporate events may block ACTIONABLE when supported by reliable evidence. Missing event data remains explicitly unavailable.

## 45.10 Lifecycle / Evaluation Classification

### DISCOVERED
Candidate is in the QV universe but has not established the complete QV thesis.

### WATCH
Examples: insufficient valuation dislocation; technically DECLINING; OVERSOLD without stabilization; unresolved valuation conflict; mixed fundamental evidence requiring observation; or loss of prior recovery confirmation without thesis break.

### SETUP
Requires all:
- Quality PASS
- valuation >= MODERATE DISLOCATION
- growth-adjusted valuation INTACT or MIXED
- Fundamental Integrity PASS
- Fundamental Momentum STABILIZING or IMPROVING
- Technical State STABILIZING
- sufficient required evidence
- no disqualifying risk

Meaning: QV thesis established; recovery confirmation incomplete.

### UNDERLYING ACTIONABLE
Requires all:
- Quality PASS
- valuation >= MODERATE DISLOCATION
- growth-adjusted valuation INTACT or MIXED
- Fundamental Integrity PASS
- Fundamental Momentum STABILIZING or IMPROVING
- Technical State RECOVERING
- sufficient required evidence
- no disqualifying risk

Meaning: underlying qualifies for LEAPS contract evaluation. It does not mean a trade should be placed.

### INVALIDATED
Reserved for durable thesis failure. Do not invalidate merely because price falls, RSI declines, valuation becomes less attractive, technical state regresses, or optional data disappears. Loss of technical confirmation normally causes ACTIONABLE -> SETUP/WATCH rather than INVALIDATED.

## 45.11 Hard-Gate Principle

No aggregate score or ranking may override a failed hard gate. Extraordinary cheapness cannot rescue failed Quality, broken fundamentals, or insufficient required evidence. Technical recovery cannot rescue a fundamentally broken business.

## 45.12 Required Reason Codes

At minimum support structured concepts for:
- QUALITY_REVENUE_STRONG
- QUALITY_REVENUE_ACCEPTABLE
- QUALITY_REVENUE_WEAK
- QUALITY_FCF_POSITIVE
- QUALITY_FCF_DETERIORATING
- QUALITY_ROIC_STRONG
- QUALITY_ROIC_ACCEPTABLE
- QUALITY_ROIC_WEAK
- QUALITY_LEVERAGE_STRONG
- QUALITY_LEVERAGE_ACCEPTABLE
- QUALITY_LEVERAGE_ELEVATED
- QUALITY_LEVERAGE_HIGH
- VALUATION_DISLOCATION_STRONG
- VALUATION_DISLOCATION_MODERATE
- VALUATION_NO_MATERIAL_DISLOCATION
- VALUATION_CONFLICT
- GROWTH_ADJUSTED_INTACT
- GROWTH_ADJUSTED_MIXED
- GROWTH_ADJUSTED_DETERIORATING
- FUNDAMENTAL_MOMENTUM_IMPROVING
- FUNDAMENTAL_MOMENTUM_STABILIZING
- FUNDAMENTAL_MOMENTUM_DETERIORATING
- FUNDAMENTAL_THESIS_BROKEN
- TECHNICAL_DECLINING
- TECHNICAL_OVERSOLD
- TECHNICAL_STABILIZING
- TECHNICAL_RECOVERING
- ANALYST_REVISION_DATA_UNAVAILABLE
- RISK_EARNINGS_APPROACHING
- REQUIRED_DATA_UNAVAILABLE

The same structured evidence must drive classification and explanation.

## 45.13 Required Boundary Tests

Test immediately below, exactly at, and immediately above:
- P/E percentile 20 and 35
- historical discount 10% and 20%
- Net Debt/EBITDA 1x, 2x, 3x
- ROIC 10% and 15%
- revenue CAGR 0% and 5%

Also test conflicting valuation signals, including percentile 18 with 5% median discount => STRONG DISLOCATION.

## 45.14 Required Behavioral Tests

1. Classic setup: Quality + discounted + intact fundamentals + STABILIZING => SETUP.
2. Recovery confirmed: same but RECOVERING => UNDERLYING ACTIONABLE.
3. Falling knife: Quality + cheap + oversold + still technically deteriorating => WATCH.
4. Value trap: extremely cheap + revenue/EPS/margins deteriorating => not SETUP/ACTIONABLE.
5. Expensive quality: excellent company + RECOVERING + insufficient valuation dislocation => DISCOVERED/WATCH.
6. Missing analyst revisions: otherwise qualifies => qualification remains possible with explicit unavailable reason.
7. Missing required evidence: cannot establish required domain => INSUFFICIENT_DATA.
8. Technical regression: ACTIONABLE -> STABILIZING while thesis intact => SETUP, not INVALIDATED.
9. Great company/tiny discount: percentile 45 + 5% discount + RECOVERING => not SETUP/ACTIONABLE.
10. Unusual valuation without large median discount: percentile 18 + 5% discount + Quality PASS + RECOVERING => valuation STRONG.
11. Cheap collapsing business: percentile 5 + 30% discount + three deteriorating fundamental dimensions => not SETUP/ACTIONABLE; thesis-break behavior where applicable.

## 45.15 Architecture / Implementation Requirements

Quinn requirement: centralize QV-v1.0 classifications and thresholds in versioned strategy policy. Do not scatter strategy thresholds/classification logic across UI, API routes, or provider code. Strategy consumes normalized metrics only. No network/provider logic belongs in the strategy engine.

Every classifier returns structured evidence/reason codes. Missing evidence never becomes neutral. Hard-gate failures cannot be overridden by stronger evidence elsewhere.

Preserve existing Find LEAPS behavior.

## 45.16 Explicit Gate 3 Exclusions

Do not implement:
- LEAPS contract ranking or suitability
- DTE/delta selection
- option liquidity or entry-price methodology
- Bear/Base/Bull scenario engine
- QV UI
- position sizing or portfolio allocation
- order execution
- rolling/position management
- notifications
- AI discretionary overrides

Gate 4 and later gates remain blocked.

## 45.17 Implementation Principle

Prefer false negatives over false positives. QV-v1.0 will eventually feed leveraged long-duration option exposure; therefore fail closed on required evidence, require fundamental confluence, require meaningful valuation dislocation, require stabilization/recovery evidence, preserve WATCH when evidence is unresolved, and never manufacture confidence from missing data.
