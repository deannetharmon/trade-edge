# LEAPS-QV-0001 — Quality Value LEAPS Discovery

**Product:** TradeEdge  
**Ticket:** LEAPS-QV-0001  
**Strategy:** Quality Value LEAPS  
**Initial Strategy Version:** QV-v1.0  
**Status:** APPROVED — IMPLEMENTATION AUTHORIZED  
**Current Gate:** Gate 2 — Normalized Metrics & Data Audit  
**Current Gate Status:** AUTHORIZED  
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
**Status: AUTHORIZED**

Implement/map quality, valuation, fundamental, technical, and existing options metrics. Classify each AVAILABLE / DERIVABLE / CONDITIONAL / UNAVAILABLE. Investigate analyst revisions and historical IV. No silent substitutes.

**Exit review: Dane + Quinn.** Escalate investment-significant data limitations to Ian.

## GATE 3 — QV-v1.0 Underlying Strategy
**Status: BLOCKED**

Implement Quality Gate, Valuation Dislocation, Growth-Adjusted Valuation, Fundamental Integrity/Momentum, Technical State, Risk, Data Completeness, reason codes, underlying ranking, and candidate classification.

Prove representative WATCH, SETUP, ACTIONABLE-candidate, INVALIDATED, and INSUFFICIENT_DATA cases without contract ranking.

**Exit review: Ian** using strong/weak/borderline/value-trap/deteriorating/stabilizing/recovering/missing-data cases.

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
- **Current Authorization: GATE 2 ONLY**

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
Status: IMPLEMENTED — AWAITING EXIT REVIEW (Dane + Quinn; investment-significant data limitations to Ian)  
Implementation: Complete (see docs/analysis/LEAPS-QV-0001-gate2-data-audit.md)  
Commit: see Gate 2 Completion Report

### Gates 3–8
Status: BLOCKED

# 44. Current Claude Instruction

Read this entire document before making changes and inspect the existing TradeEdge implementation and repository conventions.

You are authorized to execute **GATE 2 — NORMALIZED METRICS & DATA AUDIT ONLY**.

Gate 2 scope (Quinn Gate 1 final review, restating Section 41):

* inventory existing TradeEdge data capabilities before adding providers
* map each required QV metric to actual data sources
* classify each metric as AVAILABLE, DERIVABLE, CONDITIONAL, or UNAVAILABLE
* implement normalized metric calculations only where supported by reliable data
* explicitly investigate analyst-estimate/revision availability
* explicitly investigate historical-IV availability
* establish canonical/versioned definitions for derived metrics such as ROIC
* preserve VALID / UNAVAILABLE / STALE / INVALID semantics
* do not silently substitute proxy metrics
* do not implement QV investment thresholds or scoring
* do not implement Gate 3 classification logic
* do not modify existing Find LEAPS investment behavior

Do not begin Gate 3. Any investment-significant data limitation must be returned to Ian for investment-methodology review before Gate 3.

When Gate 2 is complete:
1. Run applicable unit tests.
2. Run relevant existing regression tests.
3. Review the complete diff.
4. Produce the Gate Completion Report in Section 40.
5. Commit and push per repository workflow (one consolidated push).
6. Provide branch and commit SHA.
7. **STOP.**

The Gate 2 report must be reviewed (Dane + Quinn exit review) before Gate 3 is authorized.
