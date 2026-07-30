# SQ-0001 — Alan Architecture Synthesis

**Role:** Chief Architect synthesis  
**Inputs:** Current-state forensic audit; quantitative/testability concerns; product/decision-system review; Ian trader review.  
**Status:** Proposed architecture for Sponsor review. No implementation authorized by this document.

## 1. Architecture Ruling

SQ-0001 is not a request to retune the existing additive ranker. The current architecture conflates market-state inference, directional thesis, strategy suitability, and contract attractiveness. The replacement architecture must make those decisions explicit and ordered.

Canonical decision pipeline:

```text
Point-in-Time Market Data
        ↓
Market-State Evidence Model
        ↓
Setup Classification
        ↓
Strategy Eligibility Gate
        ↓
Contract Candidate Evaluation
        ↓
Within-Strategy Ranking
        ↓
Recommendation + Evidence + Uncertainty
        ↓
Outcome Capture / Calibration
```

A later stage may not compensate for failure of an earlier eligibility stage.

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

The architecture should preserve the underlying evidence so the recommendation can explain itself.

## 4. Layer 3 — Setup Classification

Setup classification converts market state into a tradable thesis, for example:

- bullish continuation;
- bearish continuation;
- bullish reversal;
- bearish reversal;
- range;
- transition/uncertain;
- no-trade/chaotic.

Continuation and reversal remain distinct setup classes. They may ultimately have different eligibility thresholds and calibrated outcome expectations.

## 5. Layer 4 — Strategy Eligibility Gate

This is the central architectural correction.

Before contracts are ranked, each strategy receives an eligibility decision based on the underlying setup and intended trade horizon.

Examples:

- BPS requires an eligible bullish/bullish-neutral thesis for its DTE horizon.
- BCS requires an eligible bearish/bearish-neutral thesis.
- IC requires an eligible range/neutral thesis and must be rejected when directional/chaotic evidence exceeds validated limits.

Eligibility should return:

```text
ELIGIBLE
INELIGIBLE
INSUFFICIENT_EVIDENCE
```

with explicit reason codes.

A strategy marked INELIGIBLE or INSUFFICIENT_EVIDENCE does not enter normal contract ranking. Liquidity, credit, ROC, delta, buffer or IVR cannot override this gate.

## 6. Layer 5 — Contract Candidate Evaluation

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
- strategy-specific risk rules.

These dimensions answer: **Given an eligible thesis, which implementation of the trade is best?**

They do not answer whether the thesis itself is valid.

## 7. Layer 6 — Ranking Semantics

The current 0–100 additive score should not be interpreted as probability.

The replacement must choose and document one semantic contract. Preferred initial contract:

**Setup Quality** — a normalized model score used to rank eligible candidates within the same strategy/model version.

It must not be labeled or presented as win probability unless calibrated against historical outcomes.

If TradeEdge later exposes a probability, it must be a separate calibrated output with a named target, e.g. probability of short-strike survival through a defined horizon or probability of profitable close under a defined management policy.

Avoid saturation: component normalization should preserve meaningful differentiation near the top of the ranking.

## 8. Horizon Contract

Market-state evidence and strategy eligibility must be evaluated for a horizon compatible with candidate DTE.

This does not require a unique model for every expiration. It does require an explicit mapping between trade horizon and evidence windows, validated empirically.

A 21-DTE and 45-DTE spread must not silently inherit an identical thesis merely because they share a symbol.

## 9. Required Defect Corrections Within the New Contract

The following forensic defects/contract problems must be resolved as part of implementation design, not patched independently beforehand:

- replace the `range60` width/range-position semantic collision;
- ensure MA names correspond to actual lookback or explicitly identify fallback behavior;
- distinguish close-derived values from true OHLC swing structure;
- align type/comments/runtime scoring contracts;
- capture scoring/model/config version for historical comparability.

## 10. Validation Architecture

No new model is complete without a point-in-time evaluation harness.

Required evaluation dimensions:

1. **Classification quality:** Did direction/regime/setup classifications match subsequent behavior under defined labels?
2. **Eligibility quality:** Did eligible strategies outperform ineligible/uncertain cases on the chosen target metrics?
3. **Ranking quality:** Within eligible candidates, do higher score bins show monotonic improvement?
4. **Risk quality:** Compare maximum adverse excursion, short-strike touch/challenge, drawdown and realized spread outcomes.
5. **Regime robustness:** Evaluate trending, range, volatile and transition periods separately.
6. **Out-of-sample performance:** Thresholds/weights must be assessed on data not used to choose them.
7. **Human benchmark:** Blind trader classification can be used as a comparison baseline, not ground truth.

Historical replay must use only information available at T0 and must capture model/config version.

## 11. Testability / Safety Invariants

Implementation must make the following invariants testable:

- A clearly contradictory directional setup cannot produce an eligible directional spread solely through contract economics.
- INELIGIBLE and INSUFFICIENT_EVIDENCE strategies cannot enter normal recommendation ranking.
- Every recommendation can explain the setup class and eligibility evidence.
- Score semantics do not change silently when weights/configuration change.
- Point-in-time replay cannot read future earnings, prices, option state or revised future knowledge.
- Strategy/DTE horizon mapping is deterministic and versioned.
- Missing or inadequate market-state evidence fails safely rather than manufacturing conviction.

## 12. Product Presentation Contract

A recommendation should make the decision hierarchy visible without overwhelming the trader.

Example conceptual output:

```text
Underlying: XYZ
Setup: Bullish continuation
Direction: Bullish
Strength: Strong
Persistence: Moderate
Regime: Trending
Maturity: Established
BPS Eligibility: Eligible
Key supporting evidence: ...
Key conflicting evidence: ...
Best contract: ...
Setup Quality: 84/100
```

`84/100` means ranking quality under the documented model contract, not 84% win probability.

Sam should review the eventual presentation to ensure an individual trader can understand the distinction among setup evidence, eligibility, contract quality, and probability without needing model knowledge.

## 13. Implementation Sequencing Recommendation

If Sponsor approves this architecture, implementation should be split into controlled work packages rather than one large scoring rewrite:

1. Define canonical data/evidence and semantic contracts.
2. Correct OHLC/range/lookback semantics and create pure market-state calculations.
3. Implement setup classification and explicit strategy eligibility.
4. Separate contract ranking from underlying thesis.
5. Establish deterministic versioned score semantics.
6. Build point-in-time replay/validation capability.
7. Calibrate/validate model behavior and thresholds.
8. Integrate trader-facing presentation and Sam usability review.
9. Only then promote new ranking behavior as authoritative.

Exact thresholds, feature weights, calibration method and outcome targets remain unresolved quantitative design decisions and should not be invented during implementation.

## 14. Sponsor Decisions Required

Architecture recommends approval of these principles:

1. **Directional thesis is a gate, not merely points.**
2. **Underlying setup and contract quality are separate decisions.**
3. **Direction, strength, persistence, regime, maturity and uncertainty are distinct concepts.**
4. **Strategy eligibility is horizon-aware.**
5. **Continuation and reversal remain distinct setup classes.**
6. **No score is represented as probability without empirical calibration.**
7. **Historical point-in-time validation is part of the product, not optional research.**
8. **Sam reviews the eventual user-facing decision language before release.**

## 15. Architecture Status

**RECOMMENDED FOR SPONSOR APPROVAL.**

No implementation is authorized until Sponsor rules on the eight principles above. After approval, Dane can receive a frozen implementation specification, with Quinn validating quantitative/testability contracts, Ian validating trading behavior, Paul validating product semantics, and Sam validating trader-facing comprehension.
