# PI-0014 — Marketable Pricing for Risk-Gating (Phase 1) — Implementation Report

Branch: `main`
Commit: `9034dea` — committed locally, **not yet pushed** (see Process Note below)

## Process Note — read before anything else

This ticket was implemented and committed **directly to `main`**, without checking `planning/PROJECT_GOVERNANCE.md` / `planning/SPRINT_STATUS.md` first. Both were added between sessions (2026-07-17, same day) and were not part of this session's carried-over context. On discovering them after committing:

- `feature/portfolio-intelligence` no longer exists (locally or on `origin`) — it was already merged into `main` via commit `a90f8f1` and cleaned up, exactly per the governance doc's Short-Lived Branch lifecycle. `main` is now the correct active branch; the design doc and this report have been corrected to say so.
- `planning/SPRINT_STATUS.md` states, as of this same day: **"There is no active implementation sprint. The next sprint has not been approved."** — meaning this ticket was implemented without the Product Owner (ChatGPT, per `PROJECT_GOVERNANCE.md`'s role definitions) recommending it and the repository owner (Dean) approving it through that specific process. In substance, the `TradeEdge_Final_Architecture_Rulings.md` document functioned as a sprint specification and Dean's engagement with it functioned as approval — but this did not go through the documented channel, and the governance doc explicitly calls "untracked scope changes" a process failure.
- Per `PROJECT_GOVERNANCE.md`'s Branch Rules ("do not assume the user's locally checked-out branch... explicitly verify the intended active branch... before branch-sensitive work"), this session should have run `git branch --show-current` and read the two planning docs before writing any code. That didn't happen.

The work itself is complete, tested, and does not touch execution/safety-gated capability — but whether to push this to `origin/main` as-is, route it through the Product Owner for retroactive review first, or handle it some other way is a repository-owner decision this report does not make. Flagged to Dean directly in-conversation rather than resolved unilaterally here.

## Executive Summary

Every risk-gating decision in TradeEdge — stop-loss detection, take-profit detection, emergency exit, and the Cut Losses recommendation — read only mid-market P&L (`currentValue`/`pnl`/`pnlPct`), never the marketable "if I closed right now" price (`closeValue`/`closeNowPnl`) that already existed and was already correctly computed from real bid/ask. A real position confirmed the gap: mid P/L −$129 vs. marketable P/L −$624 against a $644 max risk. The stop-loss/Cut-Losses machinery never saw the second number.

This ticket introduces `PositionValuation` (mid vs. marketable value/P&L, slippage cost, a liquidity tier, and a liquidity-trap promotion trigger), and wires marketable pricing into the four Phase 1 gates named in the final architecture ruling: stop-loss detection, emergency exit, Cut Losses, and Take Profit — in both the canonical Decision Engine (`evaluatePositionObjective()`) and the Portfolio page's own local gating functions. Health scoring, priority ranking, Portfolio Review, and Daily Briefing are unchanged and continue reading mid pricing, per the ruling's explicit Phase 1 boundary.

This followed two rounds of independent external architecture review (ChatGPT, Gemini), reconciled into a single final ruling (`TradeEdge_Final_Architecture_Rulings.md`) that is treated as the implementation contract for this ticket. See `docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md` for the condensed design doc written in the same pass, per that ruling's sequencing decision.

## Files Changed

New:
- `lib/positionValuation/types.ts` — `PositionValuation`, `PositionValuationInput`, `LiquidityTier`, tier thresholds.
- `lib/positionValuation/computePositionValuation.ts` — `computePositionValuation()` (pure valuation math) and `attachLiquidityTrapTrigger()` (attaches the one decision-dependent field once a caller knows whether marketable evidence changed the outcome).
- `lib/positionValuation/index.ts` — public barrel.
- `lib/positionValuation/__tests__/computePositionValuation.test.ts` — 10 unit tests (tier boundaries, slippage clamping, missing/zero/negative maxRisk).
- `lib/portfolio-intelligence/__tests__/pi0014MarketablePricingFixtures.test.ts` — the 5-fixture regression suite plus one supplementary test, 13 tests total.
- `docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md` — condensed design doc.
- `docs/reviews/PI-0014-Marketable-Pricing-Implementation-Report.md` — this report.

Modified:
- `lib/portfolio-intelligence/objectives/positionObjective.ts` — the canonical Decision Engine. Added optional `marketablePnlPct` input; widened `materialLoss`/`weakHealthLoss` to fire on either mid or marketable evidence; `profitTargetReached` now vetoed when marketable data contradicts a mid-based profit claim; added `executionRealityPromoted` to the return shape; appends an explicit evidence bullet to `supportingReasons` when marketable evidence changed the outcome.
- `app/portfolio/page.tsx` — `Position` interface gains `valuation: PositionValuation | null`; new `computeMarketablePnlPct()`/`computeRawPositionValuation()` helpers; `scorePortfolioPositionObjective()` now computes and returns `valuation`, passing `marketablePnlPct` into `evaluatePositionObjective()`; `getRecommendation()`'s stop-loss check and emergency-exit (`veryLargeLoss`) check now consider marketable pricing (OR with mid); `isActionRelevant()`'s duplicate CUT_LOSSES stop-loss/extreme-loss check updated the same way for consistency.
- `docs/HANDOFF.md` — session handoff updated with this ticket's completion.

## Object Shape

```ts
type LiquidityTier = 'LIQUID' | 'WIDE_SPREAD' | 'LIQUIDITY_TRAP';

interface PositionValuation {
  midValue: number;
  midPnL: number;
  marketableValue: number;
  marketablePnL: number;
  slippageCost: number;               // max(0, midPnL - marketablePnL)
  slippagePercentOfMaxRisk: number;    // slippageCost / maxRisk, 0 if maxRisk unavailable
  liquidityTier: LiquidityTier;        // <5% / 5-15% / >15% of max risk
  liquidityTrapTriggered: boolean;     // liquidityTier === 'LIQUIDITY_TRAP' AND marketable evidence changed the recommendation
}
```

Exactly the shape and field names from the final ruling's Decision 2 — no `isMarketable`, no generic `spreadWidth`/`spreadPercent`. `computePositionValuation()` is deliberately split from `attachLiquidityTrapTrigger()`: the former is pure valuation arithmetic with no knowledge of recommendations; the latter is a one-line pure function that attaches the single decision-dependent field once the caller (the Decision Engine) has determined whether a promotion actually happened. This keeps `lib/positionValuation` genuinely pure while still producing the exact object shape the ruling specified.

## Promotion Logic

Implements the final ruling's Decision 1 exactly:

- `materialLoss` / `weakHealthLoss` (feed the Cut Losses / `close-loser` recommendation): fire if **either** mid or marketable pnl% breaches the threshold. Marketable evidence can only make these fire more often, never less — an already-conservative mid-based verdict is never weakened.
- `profitTargetReached` (feeds Take Profit / `close-winner`): still fires on mid evidence, but is vetoed when marketable data is available and contradicts it. A vetoed profit target simply falls through to whichever branch the existing `evaluatePositionObjective()` cascade reaches next (roll-soon / watch / hold) — no separate demotion logic was needed; the existing if/else-if priority order already produces "Take Profit → Hold/Manage/Cut Losses" once the input evidence is corrected. Verified directly by the supplementary fixture test.
- Stop-loss breach (`app/portfolio/page.tsx`'s mechanical price-vs-threshold check): fires if **either** the mid buyback value or the marketable buyback value crosses the stop price.
- `liquidityTrapTriggered` is true only when the tier is `LIQUIDITY_TRAP` **and** one of the above promotions/vetoes actually changed the outcome — a position can be `WIDE_SPREAD` or even `LIQUIDITY_TRAP` tier and still have this flag false if the recommendation would have been the same regardless (fixture 4 exercises exactly this case: assignment-risk fires from a strike breach, independent of and prior to the marketable gate).

## Explainability

When marketable evidence changes the outcome, `evaluatePositionObjective()` prepends an explicit bullet to `supportingReasons` (and therefore to the objective's `supportingEvidence`): `"Executable pricing is materially worse than mid: X% vs Y% of credit — wide bid/ask changed this recommendation."` This satisfies the Decision Engine Constitution's "a recommendation must be reconstructable from its stated evidence alone" and the final ruling's explainability requirement — the divergence is stated, not silently absorbed into a single reused percentage.

## Deliberately Not Touched in This Pass

`getRecommendation()`'s short-dated/standard take-profit threshold branches (30%/40%/target-based, used only for this file's own sort order and button-relevance gating — not the recommendation badge the trader actually sees, which comes from `evaluatePositionObjective()`) are left on mid pricing. That function already carries a documented, accepted gap ("this function has its own thresholds... reconciling the two threshold sets is explicitly deferred") separate from the canonical engine; widening its take-profit branches further is a bigger change than Phase 1's contract calls for. Only its stop-loss check (a literal, named Phase 1 deliverable) and its emergency-exit (`veryLargeLoss`) check were updated, plus the duplicate stop-loss/extreme-loss check inside `isActionRelevant()` for consistency between the two call sites.

Per the ruling's Final Implementation Contract: health scoring, portfolio rollups, priority ranking, and analytical reporting (Portfolio Review, Daily Briefing) continue using midpoint valuation. No files in those areas were touched.

## Testing

`lib/positionValuation/__tests__/computePositionValuation.test.ts` — 10 tests: midPnL/marketablePnL arithmetic, the real SMH-shaped slippage-cost calculation, all three liquidity tier boundaries (including the exact 5% edge, confirmed `LIQUID` since the threshold is `>`), slippage-cost clamping to 0 when marketable is better than mid, missing/zero/negative `maxRisk` handling, and `attachLiquidityTrapTrigger`'s independence between tier and the promoted-verdict flag.

`lib/portfolio-intelligence/__tests__/pi0014MarketablePricingFixtures.test.ts` — the permanent risk-first regression suite (5 fixtures, not property-based testing, per both external reviews), exercising `computePositionValuation()` and `evaluatePositionObjective()` together the way `app/portfolio/page.tsx` actually composes them:
1. **Real production failure (SMH-shaped BPS)** — mid P/L −$129 looks survivable; marketable P/L −$624 is `LIQUIDITY_TRAP` tier and promotes the recommendation to `close-loser`/critical, with the evidence bullet present.
2. **Plain, tight-spread CSP** — mid and marketable agree closely, `LIQUID`, no promotion, holds.
3. **Comfortable OTM spread** — small, unremarkable slippage, `LIQUID`, holds.
4. **ITM/breached spread** — `WIDE_SPREAD` tier, but `assignment-risk` fires from the strike breach itself (a branch that runs before the marketable gate in the cascade); `executionRealityPromoted` and `liquidityTrapTriggered` both correctly false, proving tier and trigger are independent.
5. **Highly liquid baseline** — negligible slippage, `LIQUID`, take-profit fires and marketable pricing confirms it (no veto).

Plus one supplementary test beyond the five required archetypes, confirming the profit-target veto path itself: mid pricing alone says `close-winner` at 53.3%, marketable pricing at 43.3% is below the 50% target, and the recommendation correctly demotes away from `close-winner`.

Each fixture asserts mid valuation, marketable valuation, the recommendation outcome, and supporting evidence — not just the recommendation kind in isolation, per the ruling's "Verify More Than Recommendations."

All 45 test files in the repo (30 in `lib/`, 15 in `features/`) were run this session (in batches, per the sandbox's per-command time budget) — 100% pass, no regressions. The two new test files above account for 23 of the new/changed tests; the existing `lib/portfolio-intelligence/__tests__/positionObjective.test.ts` (17 tests) and every other file in `lib/portfolio-intelligence/` (179 tests total) also re-verified with no changes needed, confirming the widened `materialLoss`/`weakHealthLoss`/`profitTargetReached` logic is fully backward compatible when `marketablePnlPct` is absent (the exact behavior every pre-existing test exercises).

## Validation

- `vitest run` — all 45 test files pass (batched: `lib/positionValuation`, `lib/portfolio-intelligence`, `lib/decision-review`+`lib/decision-engine`+`lib/todaysPriorities`+`lib/portfolioHealth`+`lib/portfolioReview`+`lib/dailyBriefing`, `lib/priorityScore`+`lib/tradeLog`+`lib/position-snapshot`+`lib/__tests__`, `lib/autopilot`, `features/portfolio/briefing`+`features/portfolio/components`+`features/portfolio/dailyBriefing`, `features/portfolio/decisionReview`+`features/portfolio/intelligence`+`features/portfolio/priorities`+`features/portfolio/review`).
- `tsc --noEmit` — clean, no errors, run twice (once immediately after wiring the gates, once after the full test suite).
- `next build` — reproduces this repo's known sandbox limitation (hangs at the initial Next.js banner). Consistent with every prior PI ticket's experience in this sandbox; not treated as a regression given `tsc --noEmit` is clean and all tests pass. **Vercel's build remains the authoritative check and is still required before this is considered fully verified in production.**

## Trade-offs

- **`lib/autopilot` was not touched.** The final ruling's Phase 1 contract names `app/portfolio/page.tsx`'s gates and the canonical Decision Engine specifically; it does not mention the separate, one-way-isolated `lib/autopilot` package (which has its own recommendation/risk-gate engines, per the Decision Engine Constitution's package-dependency conventions). If autopilot's own gates read mid pricing the same way, that is a real, related gap — but extending this fix there was not part of the agreed Phase 1 scope and would need its own explicit decision.
- **`getRecommendation()`'s take-profit threshold branches remain mid-only** (see "Deliberately Not Touched" above) — an intentional, documented scope boundary, not an oversight.
- **No visual/screenshot QA** — same sandbox rendering limitation noted in prior reports. `pos.valuation` is not yet rendered anywhere in the UI; it is available on every position for a future slice to surface (e.g. a liquidity badge or an "executable P/L" secondary figure), matching this ticket's Phase 1 scope of wiring the data into decisions, not yet displaying it.

## Deferred Enhancements (later phases, per the final ruling)

- **Phase 2** — full recommendation selector: let Hold/Roll/Take Profit/Cut Losses choices reason from executable economics more broadly, not just the four hard gates.
- **Phase 3** — priority ranking incorporates executable losses into urgency calculations.
- **Phase 4** — Portfolio Review exposes portfolio-level execution risk.
- **Phase 5** — health scoring gains liquidity as an independent, additional dimension (e.g. `Health: 82, Execution: Dangerous, Liquidity: Poor`) rather than replacing the existing score.
- Surfacing `PositionValuation` in the UI itself (a liquidity badge, an "if I closed now" secondary P/L figure) — the data now exists on every position; only the display is deferred.
- Adding the Execution Reality Principle to `planning/DECISION_ENGINE_CONSTITUTION.md` — discussed during the external review rounds but not yet written into that file; a natural, low-risk follow-on.
