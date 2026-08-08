# SQ-0001 — Alan Architecture Synthesis

**Role:** Chief Architect synthesis  
**Inputs:** Current-state forensic audit; quantitative/testability concerns; product/decision-system review; Ian trader review; Sponsor rulings on multi-strategy scoring and Wheel lifecycle intelligence.  
**Status:** Revised architecture for team agreement and Sponsor approval. No implementation authorized by this document.

## 1. Architecture Ruling

SQ-0001 is not a request to retune the existing additive ranker. The current architecture conflates market-state inference, directional thesis, strategy suitability, position context, and contract attractiveness. The replacement architecture must make those decisions explicit and ordered.

Canonical decision pipeline:

```text
Point-in-Time Market Data
        ↓
Market-State Evidence Model
        ↓
Position / Portfolio State
        ↓
Setup Classification
        ↓
Strategy-Specific Thesis Evaluation
        ↓
Action / Strategy Eligibility Gate
        ↓
Contract Candidate Evaluation
        ↓
Within-Strategy Ranking
        ↓
Recommendation + Evidence + Uncertainty
        ↓
Outcome / Lifecycle Transition
        ↓
Outcome Capture / Calibration
```

A later stage may not compensate for failure of an earlier eligibility stage.

The market-state model is shared intelligence. Strategy thesis, eligibility, contract ranking, and lifecycle interpretation are strategy-specific.

## 2. Layer 1 — Point-in-Time Market Data

The canonical market-state input should preserve the information required to evaluate structure, rather than reducing daily bars to closes before analysis.

Minimum evidence contract should support:

- OHLC bars;
- derived true price ranges;
- gaps;
- actual swing highs/lows;
- moving averages and slopes;
- momentum at multiple horizons;
- volatility/chop measures;
- support/resistance structure;
- RSI and other indicators only when their decision role is explicit and validated.

Volume, relative strength, sector/market regime, ADX/ATR or other features are candidates for quantitative validation, not automatically mandated features.

## 3. Layer 2 — Market-State Evidence Model

Do not produce one overloaded `confidence` number.

The evidence model should distinguish at least:

- **Direction:** bullish / bearish / neutral / uncertain;
- **Strength:** magnitude of directional evidence;
- **Persistence/Stability:** consistency of the direction across the relevant history;
- **Regime:** trending / range / chaotic / transition;
- **Maturity:** emerging / established / extended / deteriorating;
- **Conflict/Uncertainty:** amount and nature of contradictory evidence.

The architecture should preserve the underlying evidence so every strategy can consume the same authoritative market interpretation without duplicating trend logic.

## 4. Layer 3 — Position / Portfolio State

Position state is a first-class decision input, but it is not required to alter the market-state truth.

For a new standalone spread, position state may be empty or limited to portfolio constraints. For lifecycle strategies it can include:

- owned shares and quantity;
- effective share basis;
- realized premium already collected;
- open option legs;
- assignment/call-away state;
- available cash/collateral;
- current lifecycle phase;
- existing position risk and concentration;
- prior actions relevant to the next decision.

This layer allows the same market intelligence to produce different rational actions depending on what the trader already owns.

## 5. Layer 4 — Setup Classification

Setup classification converts market state into reusable market setups, for example:

- bullish continuation;
- bearish continuation;
- bullish reversal;
- bearish reversal;
- range;
- transition/uncertain;
- no-trade/chaotic.

Continuation and reversal remain distinct setup classes. They may have different eligibility thresholds and calibrated outcome expectations.

A setup is not itself a strategy recommendation.

## 6. Layer 5 — Strategy-Specific Thesis Evaluation

Each strategy interprets the common market state and setup according to its own payoff, failure modes, horizon, and—where relevant—position state.

This is not one generic eligibility formula with the sign reversed.

### Bull Put Spread (BPS)

Core thesis: downside risk is sufficiently controlled over the intended horizon to sell defined-risk bullish/bullish-neutral premium.

A rising underlying may help, but BPS does not require price appreciation to succeed. Evaluation must focus on downside structure, support, deterioration risk, volatility, strike clearance, and horizon compatibility.

### Bear Call Spread (BCS)

Core thesis: upside risk is sufficiently controlled over the intended horizon to sell defined-risk bearish/bearish-neutral premium.

BCS is not simply `BPS × -1`. Resistance behavior, rallies, upside acceleration, reversal/squeeze risk, volatility, strike clearance, and horizon compatibility require their own validated treatment.

### Iron Condor (IC)

Core thesis: price is sufficiently likely to remain contained between two boundaries over the intended horizon.

Low directional conviction alone is not enough. IC evaluation must address range stability, both boundaries, breakout risk on either side, volatility behavior, expected movement, and clearance for both short strikes.

### Cash-Secured Put (CSP)

Core thesis: selling downside premium is acceptable both as an option trade and as a potential acquisition path into the underlying.

CSP thesis must distinguish at least:

- attractive because assignment risk is acceptably low; and
- attractive because assignment at the effective basis is an acceptable ownership outcome.

Premium economics cannot rescue an underlying that is unsuitable for ownership or experiencing unacceptable downside deterioration.

### Covered Call (CC)

Core thesis depends on owned-share state. The decision is not simply whether the underlying is bearish enough to sell a call.

CC evaluation must consider market state together with share basis, current price, premium, strike, recovery/upside potential, and the economics/consequence of call-away. A strongly bullish underlying may make BCS unattractive while a sufficiently high-strike CC can still be rational if call-away is acceptable.

### PMCC and future strategies

The same architecture extends to PMCC and future strategies: consume canonical market-state evidence, then apply strategy-specific position state, thesis, eligibility, capital/risk contract, and ranking semantics.

## 7. Layer 6 — Action / Strategy Eligibility Gate

Before contracts are ranked, each strategy receives an eligibility decision based on its strategy-specific thesis, intended horizon, and required position state.

Eligibility should return:

```text
ELIGIBLE
INELIGIBLE
INSUFFICIENT_EVIDENCE
```

with explicit reason codes.

A strategy marked INELIGIBLE or INSUFFICIENT_EVIDENCE does not enter normal contract ranking. Liquidity, credit, ROC, delta, buffer or IVR cannot override this gate.

For lifecycle strategies, the eligible action set can include actions beyond opening a new option trade, including WAIT/HOLD or EXIT when appropriate.

## 8. Layer 7 — Contract Candidate Evaluation

Only after eligibility is established should the system evaluate the option structure.

Contract-quality dimensions can include:

- delta quality;
- expected-move clearance;
- strike buffer;
- liquidity/open interest/spread quality;
- credit;
- ROC;
- IV context;
- earnings/event compatibility;
- DTE suitability;
- strategy-specific risk rules;
- basis/call-away/acquisition economics when relevant.

These dimensions answer: **Given an eligible strategy thesis and current position state, which implementation of the action is best?**

They do not answer whether the thesis itself is valid.

## 9. Layer 8 — Ranking Semantics

The current 0–100 additive score should not be interpreted as probability.

The replacement must choose and document one semantic contract. Preferred initial contract:

**Setup Quality** — a normalized model score used to rank eligible candidates within the same strategy/model version.

Scores across different strategies must not be assumed comparable unless deliberately calibrated to a common semantic target. An 84 BPS and an 84 IC may represent different strategy-specific quality models.

No score may be labeled or presented as win probability unless calibrated against historical outcomes for a named target.

If TradeEdge later exposes probability, it must be separate and strategy/target specific—for example, probability of short-strike survival, range containment, profitable close under a defined management policy, assignment, or call-away.

Avoid saturation: component normalization should preserve meaningful differentiation near the top of ranking.

## 10. Horizon Contract

Market-state evidence and strategy-specific thesis/eligibility must be evaluated for a horizon compatible with candidate DTE.

This does not require a unique model for every expiration. It does require an explicit mapping between trade horizon and evidence windows, validated empirically.

A 21-DTE and 45-DTE spread must not silently inherit an identical thesis merely because they share a symbol.

Lifecycle strategies may also require a horizon that reflects ownership/recovery objectives rather than only the short option's expiration.

## 11. Wheel as a Lifecycle State Machine

Wheel is not a standalone market-intelligence model and not merely CSP + CC scoring. It is a capital/ownership lifecycle that consumes the shared intelligence and strategy-specific thesis models.

Canonical lifecycle examples:

```text
CASH
  -> evaluate CSP
  -> OPEN CSP
      -> close/expire -> CASH
      -> assignment -> SHARES

SHARES
  -> evaluate CC / HOLD / EXIT
  -> OPEN CC
      -> close/expire -> SHARES
      -> called away -> CASH
```

At each transition TradeEdge reevaluates current market state, position state, and eligible actions.

The engine must be capable of recommending, when evidence supports it:

- WAIT rather than force a CSP;
- HOLD SHARES rather than force a CC;
- WRITE CC when call-away economics are acceptable;
- EXIT/stop continuing the Wheel when the underlying/position thesis materially deteriorates;
- return to CSP evaluation after capital is released.

Wheel history—including premium already collected and effective basis—belongs to position/lifecycle state, not to the market-state model.

## 12. Required Defect Corrections Within the New Contract

The following forensic defects/contract problems must be resolved as part of implementation design, not patched independently beforehand:

- replace the `range60` width/range-position semantic collision;
- ensure MA names correspond to actual lookback or explicitly identify fallback behavior;
- distinguish close-derived values from true OHLC swing structure;
- align type/comments/runtime scoring contracts;
- capture scoring/model/config version for historical comparability.

## 13. Validation Architecture

No new model is complete without a point-in-time evaluation harness.

Required evaluation dimensions:

1. **Classification quality:** Did direction/regime/setup classifications match subsequent behavior under defined labels?
2. **Strategy-thesis quality:** Did each strategy-specific thesis identify the market conditions relevant to that strategy's payoff/failure modes?
3. **Eligibility quality:** Did eligible strategies/actions outperform ineligible/uncertain cases on strategy-specific target metrics?
4. **Ranking quality:** Within eligible candidates of the same strategy/model version, do higher score bins show monotonic improvement?
5. **Risk quality:** Compare maximum adverse excursion, strike touch/challenge, range breakout, assignment/call-away, drawdown and realized outcomes as applicable.
6. **Lifecycle quality:** For Wheel/position-aware decisions, evaluate the outcome of WAIT/HOLD/WRITE/EXIT transitions, not only isolated option trades.
7. **Regime robustness:** Evaluate trending, range, volatile and transition periods separately.
8. **Out-of-sample performance:** Thresholds/weights must be assessed on data not used to choose them.
9. **Human benchmark:** Blind trader classification can be used as a comparison baseline, not ground truth.

Historical replay must use only information available at T0 and must capture model/config version and required position state.

BPS, BCS, IC, CSP, CC and PMCC must not inherit confidence merely because another strategy validated well. Each strategy requires evidence appropriate to its thesis and outcome target.

## 14. Testability / Safety Invariants

Implementation must make the following invariants testable:

- A clearly contradictory directional setup cannot produce an eligible directional spread solely through contract economics.
- IC cannot become eligible solely because direction is uncertain; containment evidence must exist.
- BCS eligibility is not implemented as an unvalidated sign inversion of BPS.
- CSP premium cannot override unacceptable ownership/downside evidence.
- CC recommendations incorporate owned-share state and call-away economics.
- INELIGIBLE and INSUFFICIENT_EVIDENCE strategies cannot enter normal recommendation ranking.
- WAIT/HOLD can be authoritative actions for lifecycle strategies.
- Every recommendation can explain setup class, strategy thesis, eligibility evidence, and material position-state inputs.
- Score semantics do not change silently when weights/configuration change.
- Point-in-time replay cannot read future earnings, prices, option state or revised future knowledge.
- Strategy/DTE horizon mapping is deterministic and versioned.
- Missing or inadequate evidence fails safely rather than manufacturing conviction.

## 15. Product Presentation Contract

A recommendation should make the decision hierarchy visible without overwhelming the trader.

Example conceptual output:

```text
Underlying: XYZ
Market Setup: Bullish continuation
Direction: Bullish
Strength: Strong
Persistence: Moderate
Regime: Trending
Maturity: Established
BPS Thesis: Downside sufficiently controlled
BPS Eligibility: Eligible
Key supporting evidence: ...
Key conflicting evidence: ...
Best contract: ...
Setup Quality: 84/100
```

`84/100` means ranking quality under the documented BPS model contract, not 84% win probability and not automatically equivalent to an IC/BCS/CSP/CC score of 84.

For Wheel, presentation must additionally make lifecycle state and consequences understandable—for example effective basis and whether assignment/call-away is an acceptable intended outcome.

Sam should review eventual presentation to ensure an individual trader can distinguish market state, strategy thesis, eligibility, contract quality, lifecycle consequence, and calibrated probability without needing model knowledge.

## 16. Implementation Sequencing Recommendation

If Sponsor approves this architecture, implementation should be split into controlled work packages rather than one large scoring rewrite:

1. Define canonical point-in-time market-data, market-state, position-state, and semantic contracts.
2. Correct OHLC/range/lookback semantics and create pure market-state calculations.
3. Define strategy-specific thesis contracts for BPS, BCS and IC first, while preserving extensibility for CSP/CC/PMCC.
4. Implement explicit strategy/action eligibility and separate it from contract ranking.
5. Establish deterministic, versioned strategy-specific score semantics.
6. Build point-in-time replay/validation capability with strategy-specific outcome targets.
7. Calibrate/validate BPS, BCS and IC independently before promoting them as authoritative.
8. Extend the same contracts into CSP/CC and Wheel lifecycle decisioning, including WAIT/HOLD/EXIT.
9. Extend to PMCC and additional strategies only after their capital/risk/position contracts are authoritative.
10. Integrate trader-facing presentation and Sam usability review.
11. Only then promote new ranking behavior as authoritative for each validated strategy.

Exact thresholds, feature weights, calibration methods and outcome targets remain unresolved quantitative design decisions and should not be invented during implementation.

## 17. Sponsor Decisions Required

Architecture recommends approval of these principles:

1. **Directional thesis is a gate, not merely points, for strategies whose payoff depends on directional containment.**
2. **Underlying setup and contract quality are separate decisions.**
3. **Direction, strength, persistence, regime, maturity and uncertainty are distinct concepts.**
4. **Strategy eligibility is horizon-aware.**
5. **Continuation and reversal remain distinct setup classes.**
6. **No score is represented as probability without empirical calibration against a named target.**
7. **Historical point-in-time validation is part of the product, not optional research.**
8. **Sam reviews eventual user-facing decision language and lifecycle presentation before release.**
9. **Common intelligence, strategy-specific thesis:** BPS, BCS, IC, CSP, CC, PMCC and future strategies consume one authoritative market-state model but have distinct thesis, eligibility, ranking and validation semantics.
10. **Position state is first-class:** strategies involving existing positions or lifecycle transitions must evaluate basis, ownership, open legs, capital state and lifecycle consequences rather than only the underlying and prospective contract.
11. **Wheel is a lifecycle decision system:** CSP, assignment, share ownership, CC, call-away, WAIT/HOLD/EXIT and return to cash are state transitions governed by shared intelligence plus strategy/position-specific decision contracts.
12. **Cross-strategy score equality is not assumed:** numeric scores are comparable across strategies only if a future calibration contract explicitly makes them comparable.

## 18. Team Agreement Gate

Before implementation begins, the revised architecture should receive explicit agreement from:

- **Alan:** architecture coherence and extensibility;
- **Quinn:** quantitative targets, validation design, horizon mapping, and testability;
- **Ian:** professional trader logic for BPS/BCS/IC and Wheel decisions;
- **Paul:** product semantics, scope boundaries, and decision hierarchy;
- **Sam:** individual-trader comprehension of scores, eligibility, and lifecycle outcomes;
- **Sponsor:** final authorization.

Disagreement on thresholds, formulas or weights is not a blocker at this architecture gate because those are intentionally deferred to quantitative specification. Disagreement on the twelve principles is a blocker and must return to architecture review.

## 19. Architecture Status

**REVISED — RECOMMENDED FOR TEAM AGREEMENT AND SPONSOR APPROVAL.**

No implementation is authorized until the team agreement gate and Sponsor approval are complete. After approval, Dane receives a frozen implementation specification; Quinn validates quantitative/testability contracts; Ian validates trading behavior; Paul validates product semantics; Sam validates trader-facing comprehension.