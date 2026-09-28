# TREND-TRAIL-0001 — PSAR Trend Trail Advisory Signal

**Status:** BACKLOG (2026-09-27). Not reviewed, not scoped for build, not approved. Dean: "store it and we can come back to it. We can debate it when we get to it." No work should start on this until Dean brings it back up.
**Sponsor:** Dean.

## Purpose

Add a small, advisory "Trend Trail" signal to TradeEdge using Parabolic SAR (PSAR).

The feature gives traders a timely visual cue when an underlying's short-term trailing trend changes direction. It does not replace TradeEdge's existing trend model, option-risk rules, stop-loss policy, qualification rules, or order behavior.

The intended value is simple: surface a possible trend-thesis change early enough for the trader — and TradeEdge's AI explanation layer — to review it alongside the existing evidence.

## Problem

TradeEdge already evaluates trend through moving averages, momentum, price structure, volatility/chop, support/resistance, RSI, and extension checks. That model selects or avoids directional strategies such as bull put spreads, bear call spreads, and iron condors.

However, a trader may also want a simple trailing reference that answers:

> Has price recently crossed through an adaptive trend trail?

PSAR is appropriate for that narrow purpose. It is not proposed as a predictive model or primary trade-entry system.

## Proposal

Calculate PSAR from the existing daily OHLC chart data and expose it as a parallel advisory signal called "Trend Trail."

The signal appears in the expanded Screener result card beside the existing trend explanation. The same factual signal is available to the AI recommendation/explanation paths.

No automatic orders are created, modified, or cancelled.

## Trader-facing states

| State | Meaning | Display priority |
|---|---|---|
| **PSAR trail bullish · intact** | Price remains above the PSAR trail; bullish price behavior persists. | Quiet context |
| **PSAR trail bearish · intact** | Price remains below the PSAR trail; bearish price behavior persists. | Quiet context |
| **PSAR crossed bearish · review** | The latest completed daily bar crossed below the PSAR trail. A prior bullish thesis may be weakening. | Warning / review |
| **PSAR crossed bullish · review** | The latest completed daily bar crossed above the PSAR trail. A prior bearish thesis may be weakening. | Warning / review |

"Crossed" is an event, not a persistent label. It is shown only when the PSAR direction changed on the latest completed daily bar. "Intact" is the continuing state after that event.

If there is insufficient chart data or PSAR cannot be calculated reliably, the signal is unavailable rather than inferred.

## How a trader should use it

For a bullish thesis — such as a bull put spread, cash-secured put, long stock, or LEAPS position — "PSAR crossed bearish · review" is adverse evidence. The trader should review the current trend, support, distance to the short strike, position buffer, DTE, and active stop.

For a bearish thesis — such as a bear call spread — "PSAR crossed bullish · review" is adverse evidence and should prompt the equivalent review.

The signal does not mean "close now." It means:

> A trailing price-based trend reference has changed direction. Reassess the thesis with the rest of the position evidence.

## What does not change

The following remain authoritative and unchanged:

- Existing multi-factor trend/regime classification.
- Strategy qualification and scoring.
- Defined-risk spread defaults, including the 2x original-credit stop policy.
- Trader-selected stop settings.
- 50% profit-target conventions.
- 21-DTE management rules for applicable defined-risk spreads.
- Option-strike buffer, assignment, liquidity, earnings, and pricing evidence.
- Human confirmation before any live order action.

PSAR must not independently:

- Disqualify or qualify a screener result.
- Change a score.
- Change a recommended strategy.
- Trigger a position close, roll, or stop update.
- Submit, replace, or cancel an order.

## AI recommendation use

The AI may receive the factual Trend Trail result as context, alongside the current market trend, support, option buffer, DTE, pricing evidence, and stop status.

Example AI interpretation:

> The primary trend model remains constructive, but PSAR crossed bearish on the latest daily close. This is conflicting evidence rather than a close instruction. Avoid adding risk and review the spread's buffer, support level, and existing management rules.

The AI must present PSAR as one piece of advisory evidence. It must not claim that PSAR predicts price, guarantees a reversal, or overrides deterministic risk rules.

## Technical approach

TradeEdge's existing chart endpoint already returns daily open, high, low, and close data. No new market-data provider is needed.

Implementation scope:

1. Add a pure PSAR calculation to the existing market-trend calculation path.
2. Record the current PSAR direction and whether the latest daily bar caused a direction change.
3. Extend the trend-result contract with the Trend Trail data.
4. Render the compact callout in the expanded Screener result card.
5. Pass the same data through the existing screener-to-recommendation adapter and portfolio AI trend context.
6. Add focused tests.

Suggested data shape:

```ts
trendTrail: {
  direction: 'bullish' | 'bearish';
  event: 'intact' | 'crossed_bullish' | 'crossed_bearish';
  timeframe: 'daily';
}
```

The PSAR calculation parameters must be explicit, versioned, and tested. The first release should use one documented daily-bar configuration, not user-adjustable parameters.

## Acceptance criteria

- PSAR uses existing daily OHLC data and never fabricates missing values.
- A cross is detected only from completed daily bars.
- Bullish, bearish, crossed-bullish, crossed-bearish, and unavailable states are deterministic and covered by tests.
- The callout is visually subordinate to active stop-loss status and hard risk warnings.
- Only fresh crosses receive warning-level styling.
- Existing trend classification, rankings, qualification, and orders behave exactly as before.
- The AI receives the structured state and describes it as advisory context only.
- The feature does not introduce a new score or a predictive-performance claim.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| PSAR whipsaws in sideways markets | Keep it advisory; retain the existing chop/range model as the regime authority. |
| Traders interpret it as an automatic stop | Use explicit "review" language and state that it does not alter active stops or orders. |
| A single daily cross causes excessive alarm | Give only fresh crosses warning emphasis; require corroborating evidence for any broader recommendation. |
| Indicator creep complicates the product | Scope version one to PSAR only; defer ATR and ADX unless a validated use case emerges. |
| Hidden logic changes | Keep calculation pure, typed, documented, and unit-tested; do not alter existing score or qualification inputs. |

## Deferred work

ATR and ADX are not part of this proposal.

They may be considered later if evidence shows that they improve the usefulness of Trend Trail interpretation:

- ATR could describe whether price movement is unusually large relative to normal volatility.
- ADX could describe whether the market is sufficiently directional for a trend-following signal to carry more weight.

Any later use of ATR or ADX in scoring, qualification, risk policy, or automated action requires a separate proposal and validation.

## Review requested (when this comes off the backlog)

- **Trading review (Ian):** Confirm that the four states and "review, not action" boundary match trader workflow.
- **Product review (Paul):** Confirm the callout is useful without adding product complexity or a new strategy concept.
- **Quantitative review (Alan):** Confirm the daily PSAR configuration, deterministic feature contract, and test fixtures.
- **Quality review (Quinn):** Confirm no existing recommendation, qualification, stop, or order path changes as a side effect.
- **Design review (Diane):** Confirm that intact states are quiet context and fresh crosses are noticeable without competing with hard risk alerts. Needs a rendered mock before any UI goes to code.

## Decision requested (when this comes off the backlog)

Approve a contained first release:

> Add daily PSAR as a parallel, advisory Trend Trail callout and structured AI-context field. Do not change strategy qualification, ranking, stops, recommendations, or order behavior.
