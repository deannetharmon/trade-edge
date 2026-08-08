# SQ-0001 — Quinn Quantitative Specification

**Role:** Quantitative / validation specification  
**Architecture baseline:** Sponsor-approved SQ-0001 Alan Architecture Synthesis  
**Scope:** BPS, BCS, IC market-state evidence, strategy thesis, eligibility, horizon mapping, validation and score semantics.  
**Out of scope this round:** implementation formulas/weights chosen without evidence; CSP/CC/Wheel/PMCC behavior; UI implementation.

## 1. Quantitative Ruling

TradeEdge must not optimize one generic `trend confidence` or one cross-strategy success label. BPS, BCS and IC have different payoff geometries and therefore require different thesis targets and validation labels while consuming one common point-in-time market-state evidence model.

The model must answer two quantitatively distinct questions:

1. **Thesis/eligibility:** Is the underlying state compatible with this strategy over this horizon?
2. **Contract ranking:** Among contracts for an eligible strategy, which candidate has the strongest risk/reward implementation?

Contract economics may not repair a failed thesis.

## 2. Canonical Point-in-Time Evidence

At decision time T0, evidence may use only data known at or before T0. The canonical bar representation preserves OHLC and timestamps. Candidate features may include, subject to validation:

- multi-horizon returns and regression slopes;
- true OHLC swing highs/lows and support/resistance structure;
- MA alignment, slope and distance;
- ATR/true-range and realized-volatility measures;
- directional persistence/consistency;
- drawdown/rebound and acceleration/deceleration;
- gap and candle rejection/break behavior;
- RSI or other indicators only where incremental value is demonstrated;
- market/sector relative strength or regime only if point-in-time historical inputs are available.

Feature names must encode their true semantics. Range width and range position are separate features. A moving average must identify its actual lookback; fallback values may not masquerade as MA200.

## 3. Horizon Contract

Candidate DTE maps to a versioned decision horizon rather than reusing one symbol-level trend result indiscriminately.

Initial horizon buckets for research and validation:

- **Short:** 7–20 DTE
- **Core:** 21–45 DTE
- **Extended:** 46–60 DTE

These are research buckets, not permanent trading thresholds. Historical validation may justify changing boundaries.

Each bucket receives an explicit evidence-window configuration. The model may share features across buckets, but the thesis result must identify the horizon version used.

## 4. Common Market-State Outputs

The common evidence model returns independent concepts rather than one confidence scalar:

- direction: bullish / bearish / neutral / uncertain;
- directional strength;
- persistence/stability;
- regime: trend / range / transition / chaotic;
- maturity: emerging / established / extended / deteriorating;
- uncertainty/conflict;
- structured supporting and contradicting evidence.

These values are model evidence, not probabilities unless separately calibrated.

## 5. BPS Thesis Specification

BPS target question:

> Over the candidate horizon, is downside behavior sufficiently controlled for a defined-risk bullish/bullish-neutral short-put spread?

Eligibility evidence should evaluate downside structure and persistence, not merely whether final price is higher than T0.

Validation labels must include:

- short-strike touch/challenge before exit/expiration;
- underlying maximum adverse excursion from T0;
- terminal underlying relation to short strike;
- realized spread outcome under a fixed, versioned management policy;
- thesis-break event where defined downside structural conditions fail.

A bullish continuation, bullish reversal and bullish-neutral state may have different eligibility/calibration. A materially bearish, chaotic or insufficient-evidence state must not be rescued by premium, IVR, liquidity or buffer.

## 6. BCS Thesis Specification

BCS target question:

> Over the candidate horizon, is upside behavior sufficiently controlled for a defined-risk bearish/bearish-neutral short-call spread?

BCS is validated independently; it is not assumed to be a sign inversion of BPS.

Validation labels must include:

- short-strike touch/challenge;
- maximum adverse excursion upward from T0;
- terminal relation to short strike;
- realized spread outcome under fixed management;
- upside thesis-break event, including breakout/acceleration behavior.

The feature set may overlap BPS, but coefficients/thresholds/eligibility rules must earn equivalence empirically rather than by symmetry assumption.

## 7. IC Thesis Specification

IC target question:

> Over the candidate horizon, is price containment between two relevant boundaries sufficiently stable for a defined-risk short-volatility range trade?

Neutral direction alone is not positive evidence.

IC evidence must assess:

- range stability and persistence;
- upper and lower boundary behavior;
- breakout frequency/risk on each side;
- realized volatility and volatility expansion;
- expected-move relationship to both short strikes;
- directional acceleration and transition risk;
- asymmetric risk when one boundary is materially weaker.

Validation labels include:

- touch/challenge of either short strike;
- first-side breakout;
- maximum excursion toward each boundary;
- terminal containment;
- realized IC outcome under fixed management.

## 8. Eligibility Semantics

Each strategy/horizon returns exactly one:

- `ELIGIBLE`
- `INELIGIBLE`
- `INSUFFICIENT_EVIDENCE`

Eligibility is based on strategy thesis only. Contract economics are downstream.

Every decision must emit reason codes and model/version identifiers. Missing history, stale data, contradictory evidence beyond validated tolerance, or unavailable required features must be capable of producing `INSUFFICIENT_EVIDENCE`.

## 9. Contract Ranking Semantics

After eligibility, contract ranking evaluates implementation quality using strategy-appropriate contract data such as delta, buffer, expected-move clearance, DTE, liquidity, credit, ROC, IV context and event risk.

The initial numeric output is a **strategy-specific normalized ranking score**, not probability.

Requirements:

- no raw-score saturation hidden by a 100 cap;
- same-strategy higher scores should demonstrate monotonic outcome improvement in validation before qualitative labels such as Strong are authoritative;
- cross-strategy numeric equality carries no meaning unless separately calibrated;
- model/config version is stored with every score.

## 10. Point-in-Time Replay Dataset

Replay records must reconstruct T0 without future leakage and include:

- OHLC(V) history available through T0;
- option chain, quotes, greeks, OI and expirations at T0;
- IV/IVR inputs at T0;
- earnings/event knowledge as known at T0;
- underlying classification and market/sector context used by the model;
- strategy/model/config version;
- generated candidates and eligibility reasons;
- subsequent underlying path and option outcomes sufficient for labels.

Adjusted/revised historical data and event calendars require explicit leakage controls.

## 11. Validation Protocol

Minimum protocol:

1. Chronological train/tune/test separation; final evaluation is out-of-sample.
2. Walk-forward testing across multiple market regimes.
3. Report BPS, BCS and IC independently.
4. Report each horizon bucket independently and combined only when justified.
5. Compare against simple baselines: no-thesis contract ranking, direction-only heuristic, and current production heuristic where reproducible.
6. Measure eligibility coverage as well as outcome quality; a model that rejects nearly everything is not automatically superior.
7. Evaluate calibration only for outputs explicitly defined as probabilities.
8. Preserve all model/config versions for reproducibility.

Thresholds and feature weights are selected on training/tuning data only and frozen before test evaluation.

## 12. Primary Evaluation Metrics

For BPS/BCS:

- short-strike touch rate;
- thesis-break rate;
- maximum adverse excursion distribution;
- profitable-outcome rate under fixed management;
- expected P/L and loss-tail metrics where historical option data supports them;
- eligibility coverage;
- monotonicity by score bin.

For IC:

- either-side short-strike touch rate;
- containment rate;
- breakout side/frequency;
- adverse excursion toward each side;
- profitable-outcome rate under fixed management;
- expected P/L/loss-tail metrics;
- eligibility coverage;
- monotonicity by score bin.

No single metric is sufficient to authorize the model.

## 13. Acceptance Gates

Before a strategy's new score becomes authoritative:

- no known point-in-time leakage;
- deterministic replay for a fixed model/config version;
- contradictory-thesis invariant tests pass;
- eligible cohort materially improves strategy-relevant risk/outcome metrics versus the current/baseline process without collapsing coverage to an unusable level;
- higher ranking bins show directionally monotonic improvement on primary metrics, with uncertainty intervals reported;
- performance is not dependent on one market regime or one horizon bucket;
- Ian's blind chart/trader review finds no systematic thesis failure pattern unexplained by the model;
- Paul confirms score language matches demonstrated semantics;
- Sam can distinguish ranking score from probability and understand why a strategy is eligible/ineligible.

Exact numeric promotion thresholds require empirical baseline data and are intentionally not fabricated in this specification.

## 14. Required Invariant Tests

At minimum:

- BPS contract economics cannot override an ineligible bearish/chaotic thesis.
- BCS contract economics cannot override an ineligible bullish/chaotic thesis.
- IC cannot be eligible merely because directional strength is low.
- BCS behavior cannot silently inherit BPS thresholds through sign inversion.
- missing required evidence returns insufficient evidence safely.
- horizon mapping is deterministic/versioned.
- range width and price-in-range position cannot share the same semantic field.
- OHLC swing features use actual highs/lows where named as such.
- score components cannot exceed their normalized contract and then be silently capped.
- future bars/events/options cannot enter T0 features.

## 15. Research Questions Deferred to Empirical Work

The following are deliberately unresolved until replay data exists:

- exact evidence windows per DTE bucket;
- exact feature set;
- thresholds/weights;
- whether rule-based, statistical, ML, or hybrid thesis models outperform;
- whether market/sector relative strength adds stable incremental value;
- whether volume/ADX/ATR/candle features add stable incremental value;
- exact score-bin labels and promotion thresholds;
- whether a common calibrated probability target across strategies is desirable.

## 16. Quinn Recommendation

Proceed to implementation planning for the **contracts, pure feature calculations, strategy-specific thesis boundaries, eligibility plumbing, versioning, and replay harness**, but do not authorize production scoring formulas or Strong/A+ semantics until empirical validation supplies the missing thresholds and calibration evidence.

**Quantitative specification status: COMPLETE — READY FOR ALAN / IAN / PAUL CHALLENGE.**
