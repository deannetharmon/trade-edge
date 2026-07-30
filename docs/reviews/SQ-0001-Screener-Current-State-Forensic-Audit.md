# SQ-0001 — Screener Current-State Forensic Audit

**Status:** Investigation complete — remediation not authorized  
**Audit baseline:** `main` at `b8fe19b1f6cbb2e2797dd362d9a8ac994464caca`  
**Audit branch:** `audit/sq-0001-screener-decision-quality`  
**Scope:** Current Screener trend/regime intelligence, directional spread ranking, score semantics, and validation posture.

## 1. Executive Summary

The current Screener does not provide an empirically calibrated probability that a directional spread will succeed. It combines two heuristic systems: a close-price trend/regime classifier and a candidate ranker. The trend engine converts 6 months of daily Yahoo OHLC data to closing prices only, then combines 10/20/40/60/90-bar momentum, MA alignment and slopes, high/low structure derived from closes, chop/range, volatility and exhaustion rules. The ranker then adds trend-derived points to IVR, expected-move clearance, a range dimension, liquidity, OTM buffer, strategy alignment and delta quality, and caps the result at 100.

The audit identifies four Critical/High concerns requiring independent quant, trader, and architecture review before remediation:

1. **SQ-F001 — DEFECT / Critical:** `metrics.range60` is produced as 60-bar range *width* `(high60-low60)/low60`, but ranking consumes it under a `52W Range Position` model as though it were normalized current-price position. This can systematically distort the range component and directional ranking.
2. **SQ-F002 — DESIGN RISK / Critical:** Rank mode is explicitly exhaustive and has **no trend gate**. BPS, BCS and IC candidates are generated for every symbol/expiration and trend is only an additive scoring influence. A directionally contradictory BPS/BCS can remain highly ranked if contract-quality dimensions compensate.
3. **SQ-F003 — TERMINOLOGY/CALIBRATION RISK / High:** Trend `confidence` is a bounded heuristic magnitude, not a probability or historically calibrated success rate. Rank score is likewise an additive quality score, not expected win probability. Yet scores are surfaced as `Strong`, `Acceptable`, grades, and `/100`, creating a reasonable risk of probabilistic/decision-strength interpretation.
4. **SQ-F004 — DATA/DESIGN RISK / High:** Yahoo supplies daily OHLC, but `getTrend()` discards O/H/L and uses closes only. Therefore the engine cannot see candle bodies, wicks, true intraday highs/lows, gaps, or volume. Its `higherHighs`, `higherLows`, support/resistance and range structure are all close-derived rather than candle-structure-derived.

Additional findings include stale type contracts, no explicit DTE-to-trend-horizon alignment, score saturation above 100 before capping, mutable locally persisted rank weights, and no repository evidence of historical/out-of-sample calibration showing that 80+ candidates outperform 70s or 60s.

The current system is sophisticated in rule count, but sophistication is not validation. The central issue is not proven to be one bad threshold. The architecture currently allows **underlying thesis quality and contract quality to compensate for one another inside one additive score**, while the trader-facing number is not calibrated to realized outcomes.

No application code was changed as part of this audit.

## 2. Repository State

- Repository: `deannetharmon/trade-edge`
- Default/authoritative branch audited: `main`
- HEAD at audit start: `b8fe19b1f6cbb2e2797dd362d9a8ac994464caca`
- HEAD message: `Add Wheel Simulator link and NavCard to page`
- The relevant scan helpers were mechanically extracted from `app/screener/page.tsx` under TE-0005A. The implementation report states that `getTrend`, `scoreCandidate`, `scoreBuffer`, candidate exploration and related helpers were moved without behavioral rewrite.
- Rank orchestration now lives in `lib/scans/ranked-scan-runner.ts`; Filter/Targeted remain page-local.
- This report was created on a dedicated audit branch. No production implementation or test files were modified.

## 3. End-to-End Decision Pipeline

Current Rank-mode path:

```text
Watchlist symbols
  -> TastyTrade market metrics (IV rank, earnings metadata)
  -> classifyUnderlying(symbol)
  -> Yahoo /api/chart 6mo daily OHLC
  -> getTrend(symbol)
       -> CLOSES ONLY
       -> momentum / MA / slope / close-range structure
       -> directionalScore
       -> regime rules
       -> trend + strategy + subtype + confidence
  -> TastyTrade option chain + quote
  -> exploreAllCandidatesForRank()
       -> BPS + BCS + IC across qualifying expirations
       -> runChecklist / unfiltered candidate search
  -> scoreCandidate()
       -> trend-derived + contract-derived additive dimensions
       -> strategy alignment + delta quality
       -> clamp 0..100
  -> sort descending
  -> UI traffic-light / score / grade presentation
```

Critical behavior: `runRankedScan()` documents Rank mode as exhaustive: **every strategy, every qualifying strike, every expiration, no trend gate**. Trend is fetched for badges/momentum scoring but is never used to skip a ticker or contradictory strategy.

## 4. Historical Market Data Inputs

### Yahoo chart feed

`app/api/chart/route.ts` requests Yahoo Finance chart data using:

- interval: `1d`
- range: `6mo`
- returned fields parsed: timestamp, open, high, low, close
- bars with any null OHLC value are discarded
- route caching: `cache: 'no-store'`

The route emits `{t,o,h,l,c}` daily bars.

### Trend consumption

`lib/scans/trend.ts` immediately maps the bars to `b.c` and retains only finite closes. It requires at least 90 closes.

Consequences:

- Open is unavailable to the model after ingestion.
- Intraday high/low are unavailable to the model after ingestion.
- Candle body/wick information is unavailable.
- Gap behavior cannot be explicitly modeled.
- Volume is not requested/emitted by the proxy.
- `high20`, `low20`, `high40`, etc. are extrema of **closing prices**, not candle highs/lows.
- `higherHighs`, `higherLows`, `lowerHighs`, `lowerLows`, support/resistance breaks, drawdown and rebound are therefore close-structure measures.

The engine is not visually inspecting candles in a machine-readable equivalent sense; it is analyzing a close-price time series.

## 5. Trend Metric Inventory

| Metric | Lookback / formula | Role |
|---|---|---|
| RSI14 | last 14 close-to-close changes | exposed metric; not directly included in directionalScore |
| MA20 | average last 20 closes | alignment, distance, regime |
| MA50 | average last 50 closes | alignment, distance, regime |
| MA200 | 200 closes if available, otherwise all available closes | returned/displayed; not a core directional-score term |
| MA20 slope | pct(MA20, average closes -40:-20) | directional slope |
| MA50 slope | pct(MA50, prior 50-bar average) | directional slope |
| momentum10 | current vs close 10 bars ago | exhaustion/recovery |
| momentum20 | current vs close 20 bars ago | directional score, reversals/exhaustion |
| momentum40 | current vs close 40 bars ago | regime/directional memory |
| momentum60 | current vs close 60 bars ago | directional score/regime |
| momentum90 | current vs close 90 bars ago | directional memory / reversal context |
| high/low 20/40/60/90 | max/min **closes** | structure/range/drawdown |
| higher/lower highs/lows | current close-extrema vs prior close-extrema with tolerances | structure score |
| range60 | `(high60-low60)/low60` | volatility/chop; incorrectly reused by ranker as position |
| chopRatio | range60 / abs(momentum60), 99 near zero net movement | chop penalty |
| distFromMA20/50 | current pct distance from MA | alignment/range/exhaustion |
| drawdown/rebound | current vs close-derived high/low | regime/exhaustion |
| trimmedRange60 | trims top/bottom 3 closes | classification robustness |
| rangeScore | tightness + MA convergence + weak momentum + mixed structure + chop + MA20 proximity | IC evidence |
| chaoticScore | extreme range + exhaustion, reduced by post-crash stabilization | NO_TRADE evidence |

Notably, RSI14 is calculated and exposed, but the inspected directional-score construction does not directly add RSI to `rawDirectionalScore`.

## 6. Directional Score Reconstruction

`rawDirectionalScore` is additive:

```text
momentumScore
+ maAlignmentScore
+ slopeScore
+ structureScore
+ regimeScore
```

### Momentum

- momentum20: signed scaling to ±18 at ±10%
- momentum60: signed scaling to ±22 at ±22%
- momentum90: signed scaling to ±8 at ±35%
- theoretical momentum component: approximately ±48

### MA alignment

- price >/< MA20: ±8
- price >/< MA50: ±10
- MA20 >/< MA50: ±10
- distance from MA50: signed up to ±6
- theoretical magnitude: approximately ±34

### Slope

- MA20 slope: up to ±13 at ±3.5%
- MA50 slope: up to ±9 at ±2.5%
- theoretical magnitude: approximately ±22

### Structure

Adds/subtracts points for 20- and 40-bar higher/lower highs/lows. Because multiple booleans can coexist under tolerance rules, the component is not a simple mutually exclusive market-structure state.

### Regime

Adds/subtracts for support/resistance breaks, proximity to 90-bar extremes, failed prior strength, and recovery after prior weakness.

### Penalties

Volatility, chop and maturity/exhaustion are summed as `penalty`. The implementation then moves the directional score **away from zero in the opposite direction of its sign** by subtracting penalty from positive raw scores and adding penalty to negative raw scores. This reduces magnitude until a sufficiently large penalty can theoretically cross zero; once computed, there is no second sign-aware clamp preventing crossing.

The resulting signed score is the central direction-strength input used downstream.

## 7. Regime / Trend Classification Decision Tree

Order is material:

1. **Catastrophic-drop hard exit**: >25% recent drop unless already in sustained downtrend -> unknown / NO_TRADE / CHOP.
2. Compute rangeScore and chaoticScore.
3. Compute bullish/bearish directional-memory booleans.
4. **Strong patterns fire first:** bullish continuation, bearish continuation, bullish reversal, bearish reversal, volatile recovery.
5. Chaotic/extended classification can return NO_TRADE.
6. Directional memory can override marginal IC/range behavior.
7. Range dominance or post-crash stabilization -> IC RANGE.
8. Weak bearish/bullish leans can still assign BCS/BPS.
9. Strong positive recovering score can assign BPS without confirmed higher-low structure.
10. Final fallback -> unknown / NO_TRADE.

Strong BPS continuation requires directionalScore >=68, MA20>MA50, price>MA20, momentum60>7%, higher-low evidence, and no upside exhaustion. Strong BCS continuation uses a non-symmetric threshold <=-62 plus price/MA/momentum/structure conditions.

Reversal and weak-lean branches deliberately cap confidence below continuation-style high values.

## 8. Confidence Semantics

Base trend confidence is:

```text
round(clamp(abs(directionalScore)
            - conflictPenalty
            - penalty * 0.35,
            0, 100))
```

The conflict penalty is 12 when momentum and MA alignment are both materially strong but have opposite signs.

Subtype branches then impose floors/caps, e.g. reversal confidence 55–74, directional-memory BPS 52–70, weak lean 40–55, range 55–78, ambiguous fallback 35–54.

**Finding:** This is a normalized/bounded heuristic evidence magnitude. It is not a probability, not a confidence interval, and not derived from historical realized outcomes. No historical frequency enters the formula.

Therefore `confidence: 80` does **not** mean an 80% probability of trend continuation, spread profitability, or short-strike survival.

The type contract only documents `confidence: number // 0-100`, which does not define statistical semantics.

## 9. Candidate Ranking Reconstruction

Default RankConfig in `app/screener/page.tsx`:

- Momentum 25
- IVR 15
- EM clearance 15
- Range 15
- Technical 10
- Liquidity 10
- Buffer 10
- plus strategy alignment: +12/+8/+3 or -18 for directional spreads
- plus delta quality: +5/+3 or -8

Default traffic-light thresholds:

- >=75 Strong
- >=55 Acceptable
- >=35 Marginal
- below 35 Avoid

### Dimension behavior

**Momentum:** normalized absolute trend momentum plus total directional-score boost, then multiplied by direction alignment. Contradictory signed momentum still receives 30% alignment rather than zero.

**IVR:** bell/plateau style quality measure, with its effective weight reduced up to 35% as absolute trend score strengthens.

**Expected-move clearance:** zero inside expected move; linearly rises to full score at 15% beyond the EM boundary.

**Range:** labeled `52W Range Position`, but uses `metrics.range60` width. This is SQ-F001.

**Technical:** MA alignment and slope normalized relative to expected BPS/BCS sign.

**Liquidity:** OI 60%, credit ratio 20%, ROC 20%.

**Buffer:** OTM distance scored using underlying-type and DTE threshold tables.

**Strategy alignment:** trend total >75 gives BPS +12; >40 +8; >0 +3; <=0 -18. BCS mirrors sign. IC gets +10 when abs trend score <40 and -10 above 75.

**Delta quality:** 16–22 delta +5; 12–30 +3; otherwise -8.

### Maximum and saturation

With default weights, additive positive maxima are approximately:

```text
25 momentum
+15 IVR
+15 EM clearance
+15 range
+10 technical
+10 liquidity
+10 buffer
+12 strategy alignment
+5 delta quality
=117 raw points
```

The result is then `Math.min(100,total)`.

Thus multiple materially different candidates can saturate at 100. The displayed score is not a normalized weighted average whose components sum to 100.

The RankConfig interface comments are also stale relative to runtime defaults: comments describe lower maxima for several fields while defaults use Momentum 25, Range 15, Technical 10, Buffer 10; rank-scoring comments describe some dimensions as 30/20/15/25 points despite runtime defaults being configurable.

## 10. Underlying Thesis vs Contract Quality

The architecture does not enforce a strict separation between:

- **Underlying thesis:** Is bullish/bearish/range behavior sufficiently established?
- **Contract quality:** Is this spread attractive given the thesis?

Rank mode explicitly explores BPS, BCS and IC without trend gating. Direction is represented through momentum, technical and strategy-alignment contributions, but IVR, EM clearance, range, liquidity, buffer and delta can add substantial points independently.

With defaults, the clearly contract-oriented dimensions IVR + EM clearance + liquidity + buffer + delta can contribute up to 55 points before range, momentum, technical, or strategy alignment. A contradictory directional spread receives -18 strategy alignment, but there is no hard prohibition.

This means a good contract can compensate for a questionable thesis. Whether that should be permitted is an architecture decision; the current factual behavior is that it is permitted.

## 11. Time-Horizon Analysis

The model mixes:

- 10-bar recent movement
- 20-bar momentum and structure
- 40-bar momentum/regime structure
- 50-bar MA
- 60-bar momentum/range
- 90-bar momentum/range
- up to 200-bar MA when history exists

The chart API supplies only 6 months, so MA200 normally falls back to average of all available closes rather than a true 200-session MA.

The trend model is computed once per symbol, not per candidate DTE. The same trendResult is used while candidates across the rank DTE window are explored.

Therefore a 21-DTE, 35-DTE and 45-DTE spread on the same symbol share the same directional thesis. There is no explicit forecast-horizon calibration tying trend evidence to the candidate's expiration.

The 90-bar momentum term is intentionally described as memory that prevents a few right-edge candles from fully reversing regime. This can be desirable for persistence, but it creates an explicit mechanism by which older trend evidence can resist recent deterioration.

## 12. Semantic Contract Audit

### SQ-F001 — `range60`

**Producer:** `trend.ts`  
**Actual meaning:** 60-close range width relative to low.  
**Consumer:** `rank-scoring.ts` `52W Range Position`.  
**Expected meaning in consumer:** normalized position of current price in a range (0 low, 1 high).  
**Consequence:** BPS/BCS range-quality points are based on volatility width rather than location. Example: a stock with a 20% 60-day range produces ~0.20 regardless of whether current price is at the low or high; BPS then treats that value as near the low side.

### SQ-F005 — RankConfig comments vs runtime

Type comments and scoring comments do not consistently match current runtime weights. This is not necessarily a runtime calculation defect, but it weakens the semantic contract for reviewers and future changes.

### SQ-F006 — `ma200`

When fewer than 200 closes are available, `ma200` is named and returned as MA200 but is actually the average of all available closes. With a 6-month feed, this will commonly be materially shorter than 200 trading sessions.

### SQ-F007 — close-derived structural names

Names such as `high20`, `low20`, `higherHighs`, `lowerLows`, support/resistance imply price/candle extrema to a trader, but are derived from closing-price extrema only.

## 13. Test / Validation Audit

Repository search found no dedicated `trend.test` or `rank-scoring.test` artifact and no historical validation/backtest artifact tied to trend confidence or score calibration.

TE-0005A reports source extraction and orchestration validation, including TypeScript/build checks and code-level smoke reasoning, but explicitly states that live-browser/TastyTrade smoke testing was not available in that environment. Its purpose was background-task extraction, not predictive validation.

The repository contains tests for other decision-quality subsystems, but this audit found no evidence establishing:

- 80–89 rank candidates outperform 70–79;
- 70–79 outperform 60–69;
- trend confidence bins correspond to observed directional persistence;
- BPS high-score candidates have lower adverse excursion or strike-challenge rates;
- the classifier was validated out-of-sample across regimes.

This is a **validation gap**, not proof that the model has no predictive value.

## 14. Historical Replay Feasibility

The current code is not directly point-in-time replayable because it fetches current external state from Yahoo/TastyTrade and computes candidates from current option chains/market metrics.

A proper replay harness would need point-in-time snapshots for:

- daily OHLC(V) through T0 only;
- option chains/quotes/greeks/open interest at T0;
- IVR/IVx inputs at T0;
- earnings knowledge as known at T0;
- underlying classification;
- scoring configuration version;
- subsequent realized underlying and option outcomes.

The pure portions of `getTrend` and `scoreCandidate` are conceptually replayable after separating data acquisition from calculation, but current `getTrend` performs its own fetch and rank orchestration pulls live metrics/chains.

Look-ahead controls would be mandatory for earnings dates and any historical vendor data that is adjusted or revised after T0.

## 15. Representative Decision Traces

These are code-path traces, not claims about specific live symbols.

### A. Strong bullish continuation

If directionalScore >=68, MA20>MA50, current>MA20, momentum60>7%, higher-low evidence exists and upside is not exhausted, the trend engine returns BPS CONTINUATION with base heuristic confidence. Candidate rank then receives positive trend alignment, momentum and technical contributions.

### B. Marginal bullish classification

If strong-pattern rules fail but directionalScore >=18, current>MA50, higher-low evidence exists and momentum60>5%, the engine can return BPS REVERSAL with confidence capped 40–55. Rank mode can still generate and score the candidate; low trend confidence itself is not a hard rank gate.

### C. Bullish reversal

DirectionalScore >=48, current>MA20, positive 20/60 momentum, higher-low evidence and regime higher lows can return BPS REVERSAL with confidence 55–74.

### D. Strong bearish continuation

DirectionalScore <=-62, current<MA20, bearish MA/slope evidence, negative momentum and lower-structure/support-break evidence return BCS CONTINUATION.

### E. Sideways/range

A high rangeScore driven by tight recent action, converging MAs, weak net momentum, mixed structure, chop and MA20 proximity can dominate trendStrength and return IC RANGE.

### F. Conflicting signals

Strong momentum and strong MA alignment with opposite signs incur a 12-point confidence penalty. If no other classification branch wins, final fallback is unknown / NO_TRADE with confidence capped 35–54.

### G. Contradictory candidate survives ranking

Rank mode creates BPS and BCS candidates regardless of trend. A BPS against a negative trend score receives -18 strategy alignment, but can still receive points from IVR, EM clearance, range, technical normalization, liquidity, buffer and delta. No rule in `scoreCandidate` returns null solely because the directional thesis contradicts the spread.

## 16. Findings Register

| ID | Classification | Severity | Component | Finding | Evidence | Potential Impact |
|---|---|---:|---|---|---|---|
| SQ-F001 | DEFECT | Critical | Rank range dimension | `range60` width is consumed as normalized range position under `52W Range Position` logic. | `trend.ts` producer vs `rank-scoring.ts` consumer | Systematic mis-scoring of BPS/BCS range quality. |
| SQ-F002 | DESIGN RISK | Critical | Rank orchestration | Rank mode has no trend gate and exhaustively scores BPS/BCS/IC. | `ranked-scan-runner.ts` explicit comment/flow | Contract quality can elevate a strategy whose underlying thesis is weak or contradictory. |
| SQ-F003 | TERMINOLOGY RISK / CALIBRATION RISK | High | Confidence/rank UI | Confidence and rank are heuristic scores, not calibrated probabilities; UI uses Strong/Acceptable, grades and `/100`. | confidence formula; trafficLight; Best Opportunity grading | Trader can reasonably over-interpret 75/80/90 as predictive conviction. |
| SQ-F004 | DATA RISK / DESIGN RISK | High | Trend input | Full OHLC is fetched, but trend engine uses closes only. | chart route vs `bars.map(b=>b.c)` | Misses candle/gap/wick/intraday structure visible to trader. |
| SQ-F005 | TERMINOLOGY RISK | Medium | RankConfig | Type/scoring comments do not consistently match runtime default weights. | `types.ts`, `rank-scoring.ts`, page defaults | Review/tuning errors; unclear scoring contract. |
| SQ-F006 | DEFECT / TERMINOLOGY RISK | Medium | MA200 | `ma200` falls back to average of all closes when <200 bars; feed is only 6mo. | `trend.ts` + chart range | UI/logic may imply a 200-session MA that is not present. |
| SQ-F007 | TERMINOLOGY RISK / DATA RISK | Medium | Market structure | Higher highs/lows and support/resistance are close-extrema, not OHLC extrema. | `trend.ts` close-only extrema | Model's structural vocabulary differs from trader chart semantics. |
| SQ-F008 | DESIGN RISK | High | Horizon | One trendResult is reused across candidate DTEs; no explicit DTE-aligned forecast horizon. | runner/candidate flow | Signal horizon can mismatch trade exposure horizon. |
| SQ-F009 | CALIBRATION RISK | High | Rank total | Default positive raw maximum is ~117 before cap at 100. | default weights + additive extras | Score saturation; different setups can become indistinguishable at 100. |
| SQ-F010 | VALIDATION GAP | Critical | Model governance | No evidence found that score/confidence bins are calibrated to subsequent outcomes. | repository search/audit | Cannot establish that 80 is more predictive than 70 by observed performance. |
| SQ-F011 | DESIGN RISK | High | Thesis vs contract | Underlying thesis and contract quality are combined additively rather than staged/gated. | `scoreCandidate()` | Attractive option economics can compensate for weak directional thesis. |
| SQ-F012 | OBSERVATION | Medium | RSI | RSI14 is computed/exposed but not directly included in raw directionalScore. | `trend.ts` | Product may display/use RSI context without it materially changing core direction score. |
| SQ-F013 | DESIGN RISK | Medium | Configuration | Rank weights/thresholds are locally mutable and persisted in browser storage. | RulesModal + `hunter-rank-config` | Two users/sessions can attach different meaning to the same numeric score unless config is captured. |

## 17. Questions Requiring Quant Review

1. What target variable should direction/confidence predict: price sign, strike survival, max adverse excursion, spread P/L, or a multi-horizon set?
2. Which horizon should correspond to 21, 30, 35, 45 DTE trades?
3. Should trend direction, strength, persistence and regime be separate calibrated outputs?
4. How should 20/40/60/90-day evidence be weighted and validated without overfitting?
5. Should OHLC/ATR/ADX/regression slope/volume/relative strength/sector/market regime be included, and what incremental predictive value do they add?
6. How should reversals be distinguished from continuations in expected outcome and confidence?
7. What calibration method and out-of-sample protocol should map model evidence to probabilities, if probabilities are desired?

## 18. Questions Requiring Trader Review

1. Blindly viewing 30/45-day charts for high-ranked historical recommendations, would a disciplined spread trader agree with direction and setup quality?
2. Which visible structures cause immediate rejection despite favorable option economics?
3. Which information is the human eye using that close-only features fail to encode: gaps, wick rejection, support tests, volatility expansion, slope consistency, failed breakouts, etc.?
4. Does a reversal deserve the same directional-spread treatment as a continuation?
5. What does the trader believe `75 Strong`, `80`, `90`, and `A+` promise today?
6. Which adverse outcomes matter most: loss, short-strike touch, assignment risk, drawdown, management burden, or thesis failure?

## 19. Questions Requiring System / Architecture Review

1. Should underlying thesis quality be a hard eligibility stage before contract ranking?
2. Should BPS/BCS/IC share one score scale or have strategy-specific calibrated models?
3. What semantic contract should a 0–100 score carry?
4. If confidence is retained, must it be empirically calibrated before being called confidence?
5. Should score dimensions sum to 100 without saturation, or should the product expose separate thesis/setup/contract scores?
6. How should model/config versioning be captured so historical outcomes remain comparable?
7. What minimum validation evidence is required before a score tier is labeled Strong/A+/recommended?

---

## Audit Conclusion

The investigation does not support a threshold-only correction. There is at least one concrete semantic defect (`range60`), but the larger issue is architectural and evidentiary: Rank mode deliberately allows all directional strategies into an additive scoring competition, while trend confidence and final rank are not calibrated to realized outcomes. The trend engine also discards candle information that a human trader uses visually and applies one mixed-horizon thesis across candidate DTEs.

The next step should be independent Quant, Trader, and Decision-System reviews against this factual baseline, followed by architecture synthesis. Remediation should remain frozen until those reviews define the intended semantic and empirical contract.
