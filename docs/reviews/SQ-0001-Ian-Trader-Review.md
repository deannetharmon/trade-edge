# SQ-0001 — Ian Trader Review

**Role:** Investment Consultant / trading-desk representative  
**Scope:** Evaluate the current Screener from the perspective of a disciplined options trader.  
**Constraint:** No implementation changes proposed or authorized.

## Executive Ruling

The current Rank score is not sufficient evidence to initiate a directional credit spread. A trader needs two separate judgments before contract economics matter:

1. Is the underlying setup suitable for the directional thesis over the intended trade horizon?
2. If suitable, is this particular option structure attractive enough to trade?

TradeEdge currently allows the second judgment to compensate for weakness in the first. That is unacceptable for a directional premium-selling workflow because an attractive credit, delta, buffer, IV environment, or liquidity profile does not repair a bad directional thesis.

## Trader Findings

### TR-F001 — Direction must be established before contract ranking

For BPS, the underlying should first establish a bullish or bullish-neutral setup compatible with the trade horizon. For BCS, the inverse applies. A contradictory or materially uncertain setup should not remain eligible merely because the option contract scores well.

### TR-F002 — Candle structure is material evidence

A trader reviewing a 30–45 trading-day chart uses more than closes. Relevant information includes actual highs/lows, gap behavior, failed breakouts/breakdowns, rejection wicks, support/resistance tests, volatility expansion, and whether movement is orderly or erratic. The current close-only model cannot encode several of those observations.

### TR-F003 — Trend direction, strength, persistence, and maturity are different questions

A stock can be bullish but weakening, bullish but overextended, newly bullish after reversal, or bullish with unstable persistence. Those states should not be collapsed into a single confidence magnitude.

### TR-F004 — Reversal and continuation setups should not be treated as equivalent

A confirmed continuation and an early reversal can point in the same direction while carrying different failure modes. The trader needs to know which thesis is being traded and should expect different eligibility/quality standards.

### TR-F005 — Trade horizon matters

The directional judgment should be compatible with the spread's exposure period. One generic trend result reused across materially different expirations does not answer whether the thesis is suitable for that specific trade horizon.

### TR-F006 — A high score currently overstates actionable conviction

Labels such as Strong and scores such as 80/90 imply a level of decision quality that has not been demonstrated by historical outcomes. Until calibration exists, the score should be interpreted as model ranking, not probability of success.

### TR-F007 — The trader needs reasons and vetoes, not only points

Certain conditions should be capable of making a directional setup ineligible rather than merely subtracting points: clear contradictory structure, unstable/chaotic regime, thesis-breaking recent price action, and insufficient evidence for the intended horizon.

## Trader Acceptance Standard

Before Ian would rely on a high-ranked directional spread, TradeEdge should be able to answer visibly and consistently:

- What is the underlying direction?
- How strong is that direction?
- How persistent/stable is it?
- Is it continuation, reversal, range, or uncertain?
- Is the setup compatible with this strategy and DTE?
- What evidence supports the thesis?
- What evidence contradicts it?
- Did the setup pass eligibility before the contract was ranked?
- What does the final numeric score actually mean empirically?

## Historical Validation Requirement

A replacement model should be tested point-in-time against subsequent outcomes. At minimum, directional-spread evaluation should measure thesis persistence, short-strike challenge/touch, maximum adverse excursion, and realized spread outcome. Score tiers must demonstrate monotonic usefulness before trader-facing strength labels are trusted.

A blind chart benchmark should also compare model classification with disciplined trader classification using only information available at T0. Disagreements should be analyzed rather than automatically treating either human or model judgment as truth.

## Ian's Recommendation to Architecture

Separate the decision into stages:

**Underlying Market State -> Directional Setup -> Strategy Eligibility -> Contract Quality -> Recommendation**

Contract quality should rank candidates *within* an eligible strategy/setup. It should not rescue an underlying thesis that failed eligibility.

Do not optimize the new system to imitate a trader's eyeball. Encode the evidence the trader's eye is using, then validate whether those features improve outcomes consistently.

**Trader review status: COMPLETE.**