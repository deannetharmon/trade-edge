# PI-0014 — Marketable Pricing for Risk-Gating (Phase 1)

Status: Condensed design doc, implemented in the same pass per external architecture review; corrected after a Product Owner-required refactor and a subsequent corrective closeout (see docs/reviews/PI-0014-Marketable-Pricing-Implementation-Report.md for what actually shipped, including both addenda).
Branch: `feature/marketable-pricing` (recovered/corrective-closeout state — see the implementation report's Process Note and Corrective Closeout Addendum for the full account of how this ticket moved off `main`, was reviewed, and was corrected)

## Problem

Every risk-gating decision in TradeEdge — stop-loss detection, take-profit detection, emergency exit, and the Cut Losses recommendation — reads mid-market P&L (`pos.pnl` / `pos.pnlPct`, derived from `currentValue`). The marketable "if I closed right now" price (`pos.closeValue` / `pos.closeNowPnl`) already exists, is correctly computed from real bid/ask, and is shown in two places in the UI — but it feeds zero decisions. A position can look mildly red on mid pricing while the real, executable loss is several times worse because the spread is wide. The engine has no way to know or say so.

Confirmed against a real position: mid P/L −$129 vs. marketable P/L −$624 against a $644 max risk. The Cut Losses / stop-loss machinery never saw the second number.

## External review

Two rounds of independent architecture review (ChatGPT, Gemini) converged on: preserve mid pricing for analytics, introduce marketable pricing for anything that can trigger a trade, and make the divergence between the two an explicit, visible piece of evidence rather than a silent substitution. Final rulings on the three open questions (liquidity trap trigger, object shape, sequencing) are recorded in the uploaded `TradeEdge_Final_Architecture_Rulings.md` and treated as the implementation contract below.

## Scope — Phase 1 only

In scope:
- New `PositionValuation` object (mid/marketable value and P&L, slippage cost, liquidity tier) — purely observational, no recommendation policy. See "Object shape" below for where the trigger flag actually lives.
- Stop-loss detection (`app/portfolio/page.tsx`'s local recommendation/gating functions).
- Cut Losses and Take Profit triggers inside the canonical Decision Engine (`evaluatePositionObjective()` in `lib/portfolio-intelligence`) — this is what actually drives the recommendation badge shown on the Portfolio page, and is the real fix target.
- A 5-fixture regression suite covering the real production case plus four constructed scenarios.

Explicitly out of scope for Phase 1 (per the ruling's "Final Implementation Contract"): health scoring, priority ranking, Portfolio Review, Daily Briefing, and any other analytical/reporting surface. All of those continue reading mid pricing until later phases.

## Object shape

**Corrected below to reflect the final, shipped shape.** The original Phase 1 pass put `liquidityTrapTriggered` on `PositionValuation` itself; a required Product Owner review moved it off that module entirely, because deciding whether marketable evidence *changed a recommendation* is a Decision Engine responsibility, not a valuation fact. `PositionValuation` stays purely observational — it has no opinion on recommendations, thresholds, or promotion policy. `computePositionValuation()` (the only function `lib/positionValuation` exports alongside these types) returns the complete, policy-free object directly; there is no separate `attachLiquidityTrapTrigger()` step or export.

```ts
// lib/positionValuation -- purely observational, no promotion policy
type LiquidityTier = 'LIQUID' | 'WIDE_SPREAD' | 'LIQUIDITY_TRAP';

interface PositionValuation {
  midValue: number;
  midPnL: number;
  marketableValue: number;
  marketablePnL: number;
  slippageCost: number;                // max(0, midPnL - marketablePnL)
  slippagePercentOfMaxRisk: number;     // slippageCost / maxRisk, or 0 if maxRisk unavailable
  liquidityTier: LiquidityTier | null;  // <5% / 5-15% / >15% of max risk; null when maxRisk is
                                         // missing, zero, or negative (corrective closeout —
                                         // never defaults to 'LIQUID' on missing risk data)
}

// lib/portfolio-intelligence -- the Decision Engine, which owns this decision
interface PositionObjectiveResult {
  objective: PortfolioObjective | null;
  legacyRecommendation: PortfolioRecommendation;
  executionRealityPromoted: boolean;    // true when marketable evidence alone changed
                                         // materialLoss, weakHealthLoss, or profitTargetReached
  liquidityTrapTriggered: boolean;      // executionRealityPromoted && liquidityTier === 'LIQUIDITY_TRAP'
}
```

`liquidityTier` is a display-only classification, always computed when `maxRisk` is valid, independent of whether it changes anything — and explicitly `null` (unknown), never `'LIQUID'`, when `maxRisk` can't be used as a denominator. `liquidityTrapTriggered` is the actionable flag, computed by `evaluatePositionObjective()`, not `computePositionValuation()` — it answers "did execution reality invalidate the analytical recommendation," not just "is the spread wide." A position can be `LIQUIDITY_TRAP` tier and still have `liquidityTrapTriggered: false` if the recommendation would have been the same either way; conversely, `materialLoss`/`weakHealthLoss`/the profit-target veto all continue to fire from `marketablePnlPct` alone even when `liquidityTier` is unknown (`null`) — tier and the underlying P&L evidence are independent inputs.

No `isMarketable` boolean, no generic `spreadWidth`/`spreadPercent` — per the ruling, `slippagePercentOfMaxRisk` is the one normalized number the engine actually consumes.

## Promotion logic

The Decision Engine's existing loss/profit triggers are widened to consider both valuations, using the same conservativeness principle throughout: a marketable-driven promotion toward a stricter posture is allowed; a marketable-driven demotion away from an already-conservative posture is not.

- `materialLoss` / `weakHealthLoss` (feed Cut Losses): fire if **either** mid or marketable pnl% breaches the threshold. Marketable can only make this fire *more* often, never less.
- `profitTargetReached` (feeds Take Profit): fires on mid evidence as before, but is vetoed when marketable data is available and contradicts it (marketable pnl% below the profit-target threshold). A vetoed profit target simply falls through to whichever branch fires next in the existing cascade (roll-soon / watch / hold) — no new demotion logic was needed, the existing if/else-if priority order already produces the correct "Take Profit → Hold/Manage/Cut Losses" behavior once the input evidence is corrected.
- Stop-loss breach (mechanical price-vs-threshold check in `app/portfolio/page.tsx`): fires if **either** the mid buyback value or the marketable buyback value crosses the stop price.

`liquidityTrapTriggered` is set when, and only when, one of the above marketable-driven promotions/vetoes actually changed the outcome relative to mid alone, and the position's `liquidityTier` is `LIQUIDITY_TRAP` (not `null`/unknown, and not `WIDE_SPREAD`).

## Deliberately not touched in this pass

`getRecommendation()`'s short-dated/standard take-profit thresholds (30%/40%/target-based branches used only for this file's own sort order and button-relevance gating) are left on mid pricing. That function already carries a documented, accepted gap ("this function has its own thresholds... reconciling the two threshold sets is explicitly deferred") separate from the canonical engine — widening its scope further is a bigger change than Phase 1's contract calls for, and isn't what drives the visible recommendation badge. Only its stop-loss check (a literal, named Phase 1 deliverable) is updated.

## Testing

A permanent 5-fixture regression suite, not a property-testing framework (per both external reviews): the real SMH-shaped failure, a tight-spread CSP, a comfortable OTM spread, an ITM/breached spread, and a highly liquid baseline. Each fixture asserts mid valuation, marketable valuation, stop-loss/recommendation outcome, and supporting evidence — directly exercising `computePositionValuation()` and `evaluatePositionObjective()` together, the way they run in production.

**Corrective closeout additions:** the original suite didn't cover what happens when marketable data is simply unavailable, or when `liquidityTier` is unknown. Added: mid-only fallback coverage for all three gates (Cut Losses, hold, Take Profit) when `marketablePnlPct`/`liquidityTier` are `null` or omitted entirely; a check that `null` and "field omitted" behave identically; and a case proving `marketablePnlPct` still drives `materialLoss`/promotion correctly even when `liquidityTier` is `null` (unknown `maxRisk`), while `liquidityTrapTriggered` correctly stays `false` in that case. `lib/positionValuation`'s own unit tests were extended with explicit missing/zero/negative-`maxRisk` → `null`-tier assertions, plus a regression guard confirming the existing 5%/15% thresholds are unchanged when `maxRisk` is valid. See the implementation report's Corrective Closeout Addendum for full test-file details.
