# SQ-0001 — Quinn Independent Safety & Testability Review

**Reviewer role:** Safety and testability  
**Baseline:** SQ-0001 forensic audit on `main` at `b8fe19b1f6cbb2e2797dd362d9a8ac994464caca`  
**Disposition:** **NOT APPROVABLE for remediation implementation yet.** The forensic conclusions are sufficient to proceed to architecture synthesis, but the replacement decision contract must be made testable before implementation.

## 1. Independent Ruling

I concur with the audit's central conclusion: this is not a threshold-tuning defect. The current Screener has no enforceable invariant separating **underlying thesis eligibility** from **contract attractiveness**, and its user-facing score/confidence language is stronger than the validation evidence supports.

The immediate safety problem is not that the heuristic is necessarily wrong on every trade. It is that the system can produce a high-confidence-looking recommendation without a testable proof that the directional thesis is sufficiently established or that the displayed score has the meaning a trader can reasonably infer from it.

## 2. Findings I Confirm

### Q-SQ-001 — Critical: no directional eligibility invariant

Rank mode intentionally explores BPS, BCS and IC without a trend gate. A contradictory directional candidate is penalized, not prohibited. Therefore there is no invariant equivalent to:

> A directional spread cannot be promoted to a recommendation unless the underlying directional thesis independently satisfies its eligibility contract.

That invariant should exist before contract quality is allowed to rank alternatives.

### Q-SQ-002 — Critical: score semantics are not testable against outcomes

`confidence` and final rank are deterministic heuristic numbers, but no empirical contract defines what 55, 75, 80 or 90 means in realized outcomes. Tests can verify arithmetic while still failing to verify decision quality.

A test suite that only proves `scoreCandidate()` returns the expected number is insufficient. We need tests proving the system's decision invariants and historical behavior.

### Q-SQ-003 — High: score saturation destroys ordering information

The default positive dimensions can total roughly 117 before clamping to 100. Once saturated, distinct candidates become observationally equal at the UI contract. That weakens ranking testability because a regression can materially alter raw quality while the displayed result remains 100.

### Q-SQ-004 — High: horizon mismatch is uncontrolled

One trend result is reused across candidate DTEs. There is no invariant tying signal horizon to trade exposure horizon. A model can therefore call the same thesis equally valid for materially different expirations without evidence.

### Q-SQ-005 — High: source-data semantics are weaker than labels

The trend engine receives OHLC but uses closes only. Close extrema are then named as highs/lows and structural signals. The implementation can be internally deterministic while still violating the trader's semantic expectation of candle structure.

### Q-SQ-006 — Critical: no decision-quality regression harness

I found no evidence in the audit package of a historical replay suite that freezes point-in-time inputs and measures subsequent outcomes by score band, strategy, subtype, regime and DTE. Without that harness, future changes can be unit-tested but not decision-quality-tested.

## 3. Required Safety Invariants for the Replacement Architecture

Before Dane receives implementation authority, Alan's synthesis should define contracts that can be tested as invariants:

1. **Thesis-before-contract:** directional eligibility is established independently of option economics.
2. **No contradictory promotion:** a BPS cannot become a recommended directional setup when the authoritative thesis is bearish/invalid, and vice versa, unless an explicitly modeled reversal state authorizes it.
3. **Unknown means no directional recommendation:** missing/ambiguous market evidence cannot be converted into conviction by contract quality.
4. **Score semantics are explicit:** every exposed 0–100 value has a named meaning; probability language is forbidden unless calibrated.
5. **No hidden saturation:** ranking preserves meaningful ordering or exposes the underlying unsaturated components.
6. **Point-in-time purity:** historical replay at T0 must not consume data learned after T0.
7. **Versioned decisions:** every recommendation must be attributable to model/config version and source timestamp.
8. **Horizon compatibility:** directional evidence must declare the horizon(s) for which it is valid; candidate DTE must be compatible.
9. **Data-quality degradation:** missing/insufficient OHLCV/history produces a conservative degraded/unknown state, not fabricated confidence.
10. **Strategy-specific validity:** BPS, BCS and IC eligibility rules are explicit and separately testable.

## 4. Minimum Validation Matrix

The replacement should not be judged by a few hand-picked symbols. At minimum, replay must stratify results by:

- BPS / BCS / IC;
- continuation / reversal / range;
- score/confidence bins;
- 21–30 / 31–40 / 41–50 DTE or the architecture's final horizon bands;
- bullish, bearish, sideways and high-volatility market regimes;
- stocks vs ETFs/indices where behavior differs;
- earnings-adjacent vs non-earnings periods;
- liquid vs marginal-liquidity contracts.

For directional spreads, capture at least: underlying direction at horizon, short-strike touch/challenge, max adverse excursion, max favorable excursion, spread P/L under a defined management policy, and thesis invalidation timing.

## 5. Fault / Edge Cases That Must Be Tested

- fewer than required bars;
- missing OHLC/volume fields;
- split/adjustment anomalies;
- overnight gap through support/resistance;
- one-day event spike followed by stabilization;
- rapid reversal after a 60/90-day trend;
- strong contract economics against weak/contradictory thesis;
- equal displayed scores with materially different raw scores;
- config change between recommendation and outcome review;
- stale market metrics or option chain relative to chart timestamp;
- candidate DTE outside the validated signal horizon;
- earnings date known at replay T0 vs revised later.

## 6. Release Gates I Require

I would not approve replacement scoring for production recommendation use until:

- semantic defects such as `range60` are covered by contract tests;
- point-in-time replay is deterministic and reproducible;
- there is an out-of-sample holdout not used for tuning;
- score bands demonstrate monotonic or otherwise explicitly documented behavior;
- false-confidence cases are reviewed by the trader representative;
- kill/degrade behavior is defined for missing or conflicting evidence;
- the old and new systems can be shadow-compared on identical inputs;
- sponsor-approved acceptance thresholds exist before results are inspected.

## 7. Quinn Recommendation to the Team

Proceed to Alan's architecture synthesis now. Do **not** ask Dane to repair isolated weights or thresholds first. The architecture should first define the decision stages, semantic contracts, replay harness, and acceptance gates. The concrete `range60` defect should be retained as a known defect and corrected inside the governed redesign or a separately authorized emergency correction if the sponsor chooses.

**Quinn status:** Independent review complete. Ready for synthesis.