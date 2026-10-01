> Repository copy of GitHub Issue #52.
>
> Canonical issue: https://github.com/deannetharmon/trade-edge/issues/52
>
> This document captures the frozen LEV-0001 v2 specification so the implementation contract is available with project source. If this file and Issue #52 diverge before implementation, reconcile them explicitly rather than silently choosing one.
>
> **Frozen 2026-10-01.** Routine execution is owned by Paul (Product Owner), facilitated by Frank (Scrum Master), with Ian (investment/derivatives), Quinn (architecture/controls/QA), Diane (UX), and Dane (engineering). Dean is sponsor-only and is not in the routine approval chain.

# LEV-0001 v2 — Leveraged & Inverse Instrument Risk, Normalization & Ranking

**Status:** FROZEN — EXECUTION AUTHORIZED

## Governance
- **Sponsor — Dean:** strategic direction only; no routine consultation. Escalate only genuinely material/controversial issues Paul and the team cannot resolve.
- **Product Owner — Paul:** product/scope decisions, priority, final acceptance.
- **Scrum Master / Facilitator — Frank:** drives sequencing, reviews, blockers, findings, remediation, and gate closure through Done.
- **Investment & Derivatives Authority — Ian:** portfolio methodology, options/derivatives mechanics, leverage treatment, risk normalization, sizing, stress methodology, investment validation.
- **Architecture / Controls / QA — Quinn:** architecture integrity, calculation consistency, model controls, fail-closed behavior, QA challenge.
- **UX — Diane:** focused UX specification/mocks and UX acceptance.
- **Engineering — Dane:** implementation, automated tests, technical delivery.

## Governing Principle
> **Leverage may improve capital efficiency, but TradeEdge must never allow leverage to obscure, bypass, or silently increase the intended portfolio risk budget.**

## Objective
Support common stocks, standard ETFs, leveraged/inverse ETFs/ETPs, leveraged single-stock ETFs/ETPs, and supported option strategies in one competitive scanner universe. Leveraged products receive neither an automatic advantage nor an arbitrary penalty. Cross-instrument ranking becomes authoritative only after sufficient risk normalization.

## Frozen Product / Architecture Decisions
1. One scanner universe; no separate leveraged-products workspace.
2. Canonical relationship: **Instrument → Economic Underlying → Strategy**.
3. Maintain distinct capital deployed, capital at risk, initial/effective exposure, gross/net exposure, stress loss, concentration, path risk, and layered option leverage.
4. First-order UEE for simple leveraged holdings: market value × signed leverage multiplier. UEE is an exposure-budget approximation, not a multi-day return model.
5. Embedded leverage cannot create an exposure-budget loophole.
6. Hard risk gates occur before ranking; unacceptable risk cannot be mathematically compensated by a high score.
7. No generic leverage score penalty and no automatic leverage reward.
8. Two scoring layers: **Underlying Opportunity Score** and **Trade Expression Score**.
9. Multiple expressions of one thesis must be groupable under the underlying opportunity.
10. Daily-reset/path/compounding risk must be represented; never assume multi-day return = underlying return × leverage.
11. Distinguish single-stock leveraged products from diversified/index leveraged products.
12. Options on leveraged products are **Layered Leverage**. Preserve actual product-level Greeks. Derived underlying-equivalent sensitivities are supplemental. Scenario analysis is preferred for material risk decisions.
13. Aggregate direct same-underlying exposure now; preserve an architecture path for future sector/index/factor look-through.
14. Missing critical leverage/underlying/reset metadata fails closed: candidate may display, but cannot receive authoritative normalized ranking.
15. Risk calculations/model behavior are versioned.
16. Numeric policy thresholds are centralized/configurable and calibrated by Ian, not scattered as hard-coded constants.
17. Existing TradeEdge workflows remain primary; UI additions are contextual.

## Instrument Classification / Metadata
Support at minimum:
- Common Stock
- Standard ETF
- Leveraged ETF/ETP
- Inverse ETF/ETP
- Leveraged Inverse ETF/ETP
- Leveraged Single-Stock ETF/ETP
- Other Leveraged Product

Capture when available: ticker, product name/type, economic underlying, benchmark, signed leverage multiplier, reset frequency, issuer, expense ratio, inception date, AUM, shares outstanding, average share/dollar volume, bid/ask spread, options availability/liquidity, metadata source/timestamp/confidence.

**Do not infer leverage, direction, underlying, or reset period from ticker naming.**

## Capital / Exposure Model
For a simple long leveraged-product position:
`Initial UEE = Market Value × Signed Leverage Multiplier`

Display both capital deployed and initial underlying-equivalent exposure. UEE is a first-order sizing/concentration/stress input, not a claim of multi-day economic equivalence.

Maintain separate:
- capital budget
- exposure budget
- capital efficiency = initial directional exposure / capital required

Capital efficiency is descriptive, not itself a quality score.

Aggregate same-underlying positions and preserve both gross and net exposure so offsets cannot hide large gross risk.

## Hard Risk Gates Before Ranking
Risk-policy constraints are gates, not mere score deductions. If a candidate violates a mandatory portfolio constraint, high expected return/premium/ROC cannot compensate. Example result: **FAIL — Portfolio Risk Limit**.

## Common Risk Basis
Cross-instrument comparison preserves inspectable normalized dimensions, including where applicable:
- expected return
- POP
- expected/stress loss
- capital required
- effective exposure
- volatility/path risk
- liquidity/bid-ask quality
- event risk
- portfolio concentration/correlation
- strategy-specific risk
- portfolio fit

Do not prematurely collapse these into an opaque single denominator.

## Opportunity vs Expression
**Underlying Opportunity Score:** attractiveness of the economic underlying independent of implementation.

**Trade Expression Score:** attractiveness of a specific implementation (shares, leveraged product, CSP, vertical, LEAPS, PMCC, supported leveraged-product option, etc.) after normalized economics/risk and portfolio fit.

A leveraged expression may legitimately rank first when it passes risk gates and its normalized economics are superior.

## Stress / Holding-Period Risk
Support underlying-based stress scenarios and portfolio stress impact. Exact mandatory scenario levels remain configurable.

Do not implement arbitrary day-count score penalties. Architect holding/path risk around leverage magnitude, volatility, expected holding period, reset characteristics, path sensitivity, and tracking characteristics. Preserve a future path for historical replay/simulation.

## Options / Layered Leverage
Preserve actual option Greeks relative to the actual product. Do not replace them with leverage-adjusted Greeks.

TradeEdge may additionally derive **Underlying-Equivalent Sensitivity** for portfolio risk, clearly labeled as derived.

Preferred material-risk flow:
**Economic Underlying Move → Estimated Leveraged Product Response → Option Repricing → Position P/L → Portfolio Impact**

A simplistic `Greek × leverage multiplier` calculation must not be authoritative.

## Standardized Candidate Context
Where applicable, normalized candidates provide:
- Opportunity ID
- instrument/type
- economic underlying/benchmark
- strategy/direction
- leverage multiplier/reset period
- capital required/capital at risk
- initial/effective exposure
- expected return/POP
- stress loss
- volatility/path risk
- liquidity risk
- event risk
- portfolio concentration/fit
- normalization confidence
- risk model version

Normalization confidence: **Complete / Partial / Incomplete**. Critical incomplete normalization prevents authoritative cross-instrument ranking.

## UX Requirements
Diane performs a focused UX gate before user-facing implementation. Reuse existing TradeEdge patterns. Lightweight specs/annotated wireframes are sufficient unless a new interaction needs higher fidelity.

Required UX pass:
1. Scanner leverage indicators (`2× LONG`, `3× LONG`, `−1× INVERSE`, etc.), effective exposure, normalization state, and risk-gate failure presentation.
2. Leveraged trade-detail presentation: type, underlying, leverage/reset, capital, effective exposure, portfolio exposure, stress/path information, normalization confidence, layered leverage, ranking explanation.
3. Position/underlying exposure aggregation: capital, gross bullish/bearish, net/effective exposure, concentration.
4. **Opportunity → Expression comparison** — primary new component comparing normalized implementations of the same thesis.

Critical leverage state cannot be hidden solely in drill-down. Do not create a separate leveraged-products dashboard.

## Explainability / AI
Rankings must explain why an expression ranked above/below alternatives in terms of normalized economics/risk.

AI receives canonical structured leverage/risk context and must not infer leverage from ticker symbols or independently redefine canonical risk calculations.

## Execution Gates
### Gate 0 — Frozen specification baseline
**Facilitator:** Frank  
**Required:** Ian + Quinn; Paul resolves product/scope ambiguity.  
Confirm terminology, risk concepts, layered leverage, fail-closed behavior, versioning, configurable policy.

### Gate 1 — Instrument classification & metadata
**Build:** Dane | **Review:** Quinn  
Implement canonical metadata/relationship model, freshness/confidence, and fail-closed state.

### Gate 2 — Exposure & risk foundation
**Build:** Dane | **Review:** Ian + Quinn  
Implement capital/exposure separation, UEE, gross/net same-underlying aggregation, capital efficiency, basic stress framework, portfolio stress impact, hard-risk-gate framework.

### Gate 3 — UX design gate
**Owner:** Diane | **Review:** Ian + Quinn | **Engineering consult:** Dane  
Deliver the four UX specifications. Dane must not invent unresolved product behavior while coding.

### Gate 4 — Scanner normalization & ranking
**Build:** Dane | **Review:** Ian + Quinn  
Common candidate model, normalization confidence, hard gates, Opportunity Score, Expression Score, portfolio fit, global ranking. Validate cases where leverage legitimately wins and loses.

### Gate 5 — User-facing scanner & trade detail
**Build:** Dane | **Acceptance:** Diane + Ian  
Implement approved scanner/trade-detail leverage context and risk states.

### Gate 6 — Options / Layered Leverage
**Build:** Dane | **Review:** Ian + Quinn  
Actual Greeks + validated supplemental underlying-equivalent sensitivity + scenario-based stress behavior.

### Gate 7 — Opportunity / Expression UX
**Build:** Dane | **Acceptance:** Diane + Ian + Quinn  
Implement grouping/comparison while preserving opportunity-vs-expression distinction.

### Gate 8 — Positions / Mission Control / Today’s Priorities
**Build:** Dane | **Review:** Ian + Diane + Quinn  
Integrate effective exposure/direct-underlying aggregation. Surface leveraged risk in Mission Control/Priorities only when actionable.

### Gate 9 — AI integration
**Build:** Dane | **Review:** Ian + Quinn  
Supply canonical structured leverage/risk context to applicable AI workflows.

### Gate 10 — Validation & regression
**Build/QA:** Dane + Quinn | **Investment/derivatives:** Ian | **UX:** Diane  
Cover ordinary instruments; +1.5×/+2×/+3×; −1×/−2×/−3×; index vs single-stock leverage; missing/stale/changed metadata; splits; related/offsetting positions; options on leveraged products; longer holds; hard-gate failures; incomplete normalization; leveraged product legitimately outranking and underperforming ordinary alternatives; ordinary-trade regression.

### Gate 11 — Integrated closure
**Facilitator:** Frank  
Frank verifies all findings closed and required domain approvals present. **Paul performs Product Owner acceptance.** Only then may LEV-0001 be marked Done.

## Execution Governance
- Frank drives the ticket through the gates; he does not substitute his judgment for domain owners.
- Ian owns investment and derivatives decisions.
- Quinn owns architecture/control correctness.
- Diane owns UX decisions.
- Dane owns implementation.
- Paul owns product/scope decisions and final acceptance.
- No reviewer silently waives another domain's required review.
- Dean is not in the routine decision/approval chain.

## Definition of Done
All gates closed; automated/regression tests pass; normalized ranking validated; UX accepted; investment/derivatives behavior accepted; architecture/control findings closed; Paul accepts completed product behavior; no blocker is deferred merely to declare Done.

## Deferred Research
Bull/bear leveraged-product activity/pressure signals (relative dollar volume, turnover, flows, shares outstanding, etc.) remain research-only until separately validated and must not silently affect production ranking.