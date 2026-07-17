# PI-0014 — Marketable Pricing for Risk-Gating (Phase 1)

Status: Condensed design doc, implemented in the same pass per external architecture review (see docs/reviews/PI-0014-Marketable-Pricing-Implementation-Report.md for what actually shipped).
Branch: `main` (corrected — see this ticket's implementation report, "Process Note": `feature/portfolio-intelligence` no longer exists, it was already merged to `main` and cleaned up before this session)

## Problem

Every risk-gating decision in TradeEdge — stop-loss detection, take-profit detection, emergency exit, and the Cut Losses recommendation — reads mid-market P&L (`pos.pnl` / `pos.pnlPct`, derived from `currentValue`). The marketable "if I closed right now" price (`pos.closeValue` / `pos.closeNowPnl`) already exists, is correctly computed from real bid/ask, and is shown in two places in the UI — but it feeds zero decisions. A position can look mildly red on mid pricing while the real, executable loss is several times worse because the spread is wide. The engine has no way to know or say so.

Confirmed against a real position: mid P/L −$129 vs. marketable P/L −$624 against a $644 max risk. The Cut Losses / stop-loss machinery never saw the second number.

## External review

Two rounds of independent architecture review (ChatGPT, Gemini) converged on: preserve mid pricing for analytics, introduce marketable pricing for anything that can trigger a trade, and make the divergence between the two an explicit, visible piece of evidence rather than a silent substitution. Final rulings on the three open questions (liquidity trap trigger, object shape, sequencing) are recorded in the uploaded `TradeEdge_Final_Architecture_Rulings.md` and treated as the implementation contract below.

## Scope — Phase 1 only

In scope:
- New `PositionValuation` object (mid/marketable value and P&L, slippage cost, liquidity tier, liquidity trap trigger).
- Stop-loss detection (`app/portfolio/page.tsx`'s local recommendation/gating functions).
- Cut Losses and Take Profit triggers inside the canonical Decision Engine (`evaluatePositionObjective()` in `lib/portfolio-intelligence`) — this is what actually drives the recommendation badge shown on the Portfolio page, and is the real fix target.
- A 5-fixture regression suite covering the real production case plus four constructed scenarios.

Explicitly out of scope for Phase 1 (per the ruling's "Final Implementation Contract"): health scoring, priority ranking, Portfolio Review, Daily Briefing, and any other analytical/reporting surface. All of those continue reading mid pricing until later phases.

## Object shape

```ts
type LiquidityTier = 'LIQUID' | 'WIDE_SPREAD' | 'LIQUIDITY_TRAP';

interface PositionValuation {
  midValue: number;
  midPnL: number;
  marketableValue: number;
  marketablePnL: number;
  slippageCost: number;               // max(0, midPnL - marketablePnL)
  slippagePercentOfMaxRisk: number;    // slippageCost / maxRisk, or 0 if maxRisk unavailable
  liquidityTier: LiquidityTier;        // <5% / 5-15% / >15% of max risk
  liquidityTrapTriggered: boolean;     // true only when liquidityTier === 'LIQUIDITY_TRAP' AND marketable evidence actually changed the recommendation
}
```

`liquidityTier` is a display-only classification, always computed, independent of whether it changes anything. `liquidityTrapTriggered` is the actionable flag — it answers "did execution reality invalidate the analytical recommendation," not just "is the spread wide." A position can be `LIQUIDITY_TRAP` tier and still have `liquidityTrapTriggered: false` if the recommendation would have been the same either way.

No `isMarketable` boolean, no generic `spreadWidth`/`spreadPercent` — per the ruling, `slippagePercentOfMaxRisk` is the one normalized number the engine actually consumes.

## Promotion logic

The Decision Engine's existing loss/profit triggers are widened to consider both valuations, using the same conservativeness principle throughout: a marketable-driven promotion toward a stricter posture is allowed; a marketable-driven demotion away from an already-conservative posture is not.

- `materialLoss` / `weakHealthLoss` (feed Cut Losses): fire if **either** mid or marketable pnl% breaches the threshold. Marketable can only make this fire *more* often, never less.
- `profitTargetReached` (feeds Take Profit): fires on mid evidence as before, but is vetoed when marketable data is available and contradicts it (marketable pnl% below the profit-target threshold). A vetoed profit target simply falls through to whichever branch fires next in the existing cascade (roll-soon / watch / hold) — no new demotion logic was needed, the existing if/else-if priority order already produces the correct "Take Profit → Hold/Manage/Cut Losses" behavior once the input evidence is corrected.
- Stop-loss breach (mechanical price-vs-threshold check in `app/portfolio/page.tsx`): fires if **either** the mid buyback value or the marketable buyback value crosses the stop price.

`liquidityTrapTriggered` is set when, and only when, one of the above marketable-driven promotions/vetoes actually changed the outcome relative to mid alone, and the position's `liquidityTier` is `LIQUIDITY_TRAP`.

## Deliberately not touched in this pass

`getRecommendation()`'s short-dated/standard take-profit thresholds (30%/40%/target-based branches used only for this file's own sort order and button-relevance gating) are left on mid pricing. That function already carries a documented, accepted gap ("this function has its own thresholds... reconciling the two threshold sets is explicitly deferred") separate from the canonical engine — widening its scope further is a bigger change than Phase 1's contract calls for, and isn't what drives the visible recommendation badge. Only its stop-loss check (a literal, named Phase 1 deliverable) is updated.

## Testing

A permanent 5-fixture regression suite, not a property-testing framework (per both external reviews): tonight's real SMH-shaped failure, a tight-spread CSP, a comfortable OTM spread, an ITM/breached spread, and a highly liquid baseline. Each fixture asserts mid valuation, marketable valuation, stop-loss/recommendation outcome, and supporting evidence — directly exercising `computePositionValuation()` and `evaluatePositionObjective()` together, the way they run in production.
