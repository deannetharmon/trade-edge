# PI-0014 — Marketable Pricing for Risk-Gating (Phase 1) — Implementation Report

Branch: `feature/marketable-pricing` (moved off `main` after the Process Note below; `main` was reset to match `origin/main`)
Commits: `2d0aeb8` (amended once for the branch fix), `88fa012` (Product Owner's required refactor — see Addendum below), plus one further corrective-closeout commit pending Dean's push (see Corrective Closeout Addendum at the end of this report)
Status: **Pending Product Owner acceptance.** Not merged into `main`.

## Process Note — read before anything else

This ticket was implemented and committed **directly to `main`**, without checking `planning/PROJECT_GOVERNANCE.md` / `planning/SPRINT_STATUS.md` first. Both were added between sessions (2026-07-17, same day) and were not part of this session's carried-over context. On discovering them after committing:

- `feature/portfolio-intelligence` no longer exists (locally or on `origin`) — it was already merged into `main` via commit `a90f8f1` and cleaned up, exactly per the governance doc's Short-Lived Branch lifecycle. `main` is now the correct active branch; the design doc and this report have been corrected to say so.
- `planning/SPRINT_STATUS.md` states, as of this same day: **"There is no active implementation sprint. The next sprint has not been approved."** — meaning this ticket was implemented without the Product Owner (ChatGPT, per `PROJECT_GOVERNANCE.md`'s role definitions) recommending it and the repository owner (Dean) approving it through that specific process. In substance, the `TradeEdge_Final_Architecture_Rulings.md` document functioned as a sprint specification and Dean's engagement with it functioned as approval — but this did not go through the documented channel, and the governance doc explicitly calls "untracked scope changes" a process failure.
- Per `PROJECT_GOVERNANCE.md`'s Branch Rules ("do not assume the user's locally checked-out branch... explicitly verify the intended active branch... before branch-sensitive work"), this session should have run `git branch --show-current` and read the two planning docs before writing any code. That didn't happen.

The work itself is complete, tested, and does not touch execution/safety-gated capability — but whether to push this to `origin/main` as-is, route it through the Product Owner for retroactive review first, or handle it some other way is a repository-owner decision this report does not make. Flagged to Dean directly in-conversation rather than resolved unilaterally here.

**Resolved**: Dean moved the commit to a new short-lived branch (`feature/marketable-pricing`, created off `origin/main`) and reset local `main` back to match `origin/main` exactly, per the documented branch lifecycle. `feature/marketable-pricing` was then reviewed by the Product Owner (see Addendum below).

## Addendum — Product Owner review and required refactor

The Product Owner reviewed this ticket on `feature/marketable-pricing` and accepted it with one required architectural change before merge: `PositionValuation.liquidityTrapTriggered` introduced an unnecessary coupling between valuation (purely observational) and recommendation evaluation (a decision-engine property). The field was moved off `PositionValuation` entirely and onto `PositionObjectiveResult` (the return type of `evaluatePositionObjective()`, the canonical Decision Engine), which now also accepts an optional `liquidityTier` input — one more piece of evidence, the same way `marketablePnlPct` already is. This is a genuinely new one-way dependency (`lib/portfolio-intelligence` now imports the dependency-free `LiquidityTier` type from `lib/positionValuation`), matching the dependency flow the Product Owner specified: `PositionValuation → Execution Evidence → Decision Engine → Recommendation`.

No stop-loss, take-profit, emergency-exit, liquidity-tier-threshold, or recommendation behavior changed — this was strictly an ownership move, verified by the same 5-fixture regression suite (updated only to read `liquidityTrapTriggered` from the evaluation result instead of the valuation object) passing unchanged, plus the same 202+201 tests across the rest of `lib/`/`features/` passing with zero new failures.

Files touched by the refactor: `lib/positionValuation/types.ts` (field removed), `lib/positionValuation/computePositionValuation.ts` (`attachLiquidityTrapTrigger()` removed — no longer needed, `computePositionValuation()` now returns the complete, purely-observational `PositionValuation` directly), `lib/positionValuation/index.ts` (export updated), `lib/positionValuation/__tests__/computePositionValuation.test.ts` (obsolete `attachLiquidityTrapTrigger` tests replaced with one assertion confirming the field is gone), `lib/portfolio-intelligence/objectives/positionObjective.ts` (`liquidityTier` added to `PositionObjectiveInput`, `liquidityTrapTriggered` added to `PositionObjectiveResult`, computed from `executionRealityPromoted && liquidityTier === 'LIQUIDITY_TRAP'`), `app/portfolio/page.tsx` (`Position` gains a sibling `liquidityTrapTriggered` field instead of it living inside `valuation`; wiring updated to pass `liquidityTier` into `evaluatePositionObjective()` and read `liquidityTrapTriggered` back out), `lib/portfolio-intelligence/__tests__/pi0014MarketablePricingFixtures.test.ts` (updated to match).

## Executive Summary

Every risk-gating decision in TradeEdge — stop-loss detection, take-profit detection, emergency exit, and the Cut Losses recommendation — read only mid-market P&L (`currentValue`/`pnl`/`pnlPct`), never the marketable "if I closed right now" price (`closeValue`/`closeNowPnl`) that already existed and was already correctly computed from real bid/ask. A real position confirmed the gap: mid P/L −$129 vs. marketable P/L −$624 against a $644 max risk. The stop-loss/Cut-Losses machinery never saw the second number.

This ticket introduces `PositionValuation` (mid vs. marketable value/P&L, slippage cost, a liquidity tier, and a liquidity-trap promotion trigger), and wires marketable pricing into the four Phase 1 gates named in the final architecture ruling: stop-loss detection, emergency exit, Cut Losses, and Take Profit — in both the canonical Decision Engine (`evaluatePositionObjective()`) and the Portfolio page's own local gating functions. Health scoring, priority ranking, Portfolio Review, and Daily Briefing are unchanged and continue reading mid pricing, per the ruling's explicit Phase 1 boundary.

This followed two rounds of independent external architecture review (ChatGPT, Gemini), reconciled into a single final ruling (`TradeEdge_Final_Architecture_Rulings.md`) that is treated as the implementation contract for this ticket. See `docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md` for the condensed design doc written in the same pass, per that ruling's sequencing decision.

## Files Changed

New:
- `lib/positionValuation/types.ts` — `PositionValuation`, `PositionValuationInput`, `LiquidityTier`, tier thresholds.
- `lib/positionValuation/computePositionValuation.ts` — `computePositionValuation()` (pure valuation math). Originally shipped alongside a second function, `attachLiquidityTrapTrigger()`; removed by the Addendum's refactor once `liquidityTrapTriggered` moved off this module entirely.
- `lib/positionValuation/index.ts` — public barrel.
- `lib/positionValuation/__tests__/computePositionValuation.test.ts` — 10 unit tests (tier boundaries, slippage clamping, missing/zero/negative maxRisk).
- `lib/portfolio-intelligence/__tests__/pi0014MarketablePricingFixtures.test.ts` — the 5-fixture regression suite plus one supplementary test, 13 tests total.
- `docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md` — condensed design doc.
- `docs/reviews/PI-0014-Marketable-Pricing-Implementation-Report.md` — this report.

Modified:
- `lib/portfolio-intelligence/objectives/positionObjective.ts` — the canonical Decision Engine. Added optional `marketablePnlPct` input; widened `materialLoss`/`weakHealthLoss` to fire on either mid or marketable evidence; `profitTargetReached` now vetoed when marketable data contradicts a mid-based profit claim; added `executionRealityPromoted` to the return shape; appends an explicit evidence bullet to `supportingReasons` when marketable evidence changed the outcome.
- `app/portfolio/page.tsx` — `Position` interface gains `valuation: PositionValuation | null`; new `computeMarketablePnlPct()`/`computeRawPositionValuation()` helpers; `scorePortfolioPositionObjective()` now computes and returns `valuation`, passing `marketablePnlPct` into `evaluatePositionObjective()`; `getRecommendation()`'s stop-loss check and emergency-exit (`veryLargeLoss`) check now consider marketable pricing (OR with mid); `isActionRelevant()`'s duplicate CUT_LOSSES stop-loss/extreme-loss check updated the same way for consistency.
- `docs/HANDOFF.md` — session handoff updated with this ticket's completion.

## Object Shape (updated per the Product Owner's required refactor — see Addendum)

```ts
// lib/positionValuation — purely observational, no opinion on recommendations
type LiquidityTier = 'LIQUID' | 'WIDE_SPREAD' | 'LIQUIDITY_TRAP';

interface PositionValuation {
  midValue: number;
  midPnL: number;
  marketableValue: number;
  marketablePnL: number;
  slippageCost: number;               // max(0, midPnL - marketablePnL)
  slippagePercentOfMaxRisk: number;    // slippageCost / maxRisk, 0 if maxRisk unavailable
  liquidityTier: LiquidityTier;        // <5% / 5-15% / >15% of max risk
}

// lib/portfolio-intelligence — the Decision Engine, which now decides this
interface PositionObjectiveResult {
  objective: PortfolioObjective | null;
  legacyRecommendation: PortfolioRecommendation;
  executionRealityPromoted: boolean;
  liquidityTrapTriggered: boolean;      // executionRealityPromoted && liquidityTier === 'LIQUIDITY_TRAP'
}
```

Field names and semantics are otherwise exactly as the final ruling's Decision 2 specified — no `isMarketable`, no generic `spreadWidth`/`spreadPercent`. The one change from the original implementation: `liquidityTrapTriggered` no longer lives on `PositionValuation`. `computePositionValuation()` now returns the complete, purely-observational object directly (the earlier split with `attachLiquidityTrapTrigger()` is gone — it's no longer needed once the decision-dependent field has a proper home). `evaluatePositionObjective()` takes `liquidityTier` as one more optional input (alongside `marketablePnlPct`) and owns deciding whether it was actually triggered, since that determination depends on the recommendation cascade this function itself runs.

## Promotion Logic

Implements the final ruling's Decision 1 exactly:

- `materialLoss` / `weakHealthLoss` (feed the Cut Losses / `close-loser` recommendation): fire if **either** mid or marketable pnl% breaches the threshold. Marketable evidence can only make these fire more often, never less — an already-conservative mid-based verdict is never weakened.
- `profitTargetReached` (feeds Take Profit / `close-winner`): still fires on mid evidence, but is vetoed when marketable data is available and contradicts it. A vetoed profit target simply falls through to whichever branch the existing `evaluatePositionObjective()` cascade reaches next (roll-soon / watch / hold) — no separate demotion logic was needed; the existing if/else-if priority order already produces "Take Profit → Hold/Manage/Cut Losses" once the input evidence is corrected. Verified directly by the supplementary fixture test.
- Stop-loss breach (`app/portfolio/page.tsx`'s mechanical price-vs-threshold check): fires if **either** the mid buyback value or the marketable buyback value crosses the stop price.
- `liquidityTrapTriggered` (owned by `evaluatePositionObjective()`, per the Addendum) is true only when the caller-supplied `liquidityTier` is `LIQUIDITY_TRAP` **and** one of the above promotions/vetoes actually changed the outcome — a position can be `WIDE_SPREAD` or even `LIQUIDITY_TRAP` tier and still have this flag false if the recommendation would have been the same regardless (fixture 4 exercises exactly this case: assignment-risk fires from a strike breach, independent of and prior to the marketable gate).

## Explainability

When marketable evidence changes the outcome, `evaluatePositionObjective()` prepends an explicit bullet to `supportingReasons` (and therefore to the objective's `supportingEvidence`): `"Executable pricing is materially worse than mid: X% vs Y% of credit — wide bid/ask changed this recommendation."` This satisfies the Decision Engine Constitution's "a recommendation must be reconstructable from its stated evidence alone" and the final ruling's explainability requirement — the divergence is stated, not silently absorbed into a single reused percentage.

## Deliberately Not Touched in This Pass

`getRecommendation()`'s short-dated/standard take-profit threshold branches (30%/40%/target-based, used only for this file's own sort order and button-relevance gating — not the recommendation badge the trader actually sees, which comes from `evaluatePositionObjective()`) are left on mid pricing. That function already carries a documented, accepted gap ("this function has its own thresholds... reconciling the two threshold sets is explicitly deferred") separate from the canonical engine; widening its take-profit branches further is a bigger change than Phase 1's contract calls for. Only its stop-loss check (a literal, named Phase 1 deliverable) and its emergency-exit (`veryLargeLoss`) check were updated, plus the duplicate stop-loss/extreme-loss check inside `isActionRelevant()` for consistency between the two call sites.

Per the ruling's Final Implementation Contract: health scoring, portfolio rollups, priority ranking, and analytical reporting (Portfolio Review, Daily Briefing) continue using midpoint valuation. No files in those areas were touched.

## Testing

`lib/positionValuation/__tests__/computePositionValuation.test.ts` — 9 tests (post-refactor; originally 10, see Addendum): midPnL/marketablePnL arithmetic, the real SMH-shaped slippage-cost calculation, all three liquidity tier boundaries (including the exact 5% edge, confirmed `LIQUID` since the threshold is `>`), slippage-cost clamping to 0 when marketable is better than mid, missing/zero/negative `maxRisk` handling, and confirmation that `liquidityTrapTriggered` is no longer part of this shape.

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

## Corrective Closeout Addendum

Between the Product Owner's refactor (previous Addendum) and this pass, `feature/marketable-pricing` was unintentionally lost from all reachable Git refs during an unrelated `main` reset in a later session — recovered from dangling commits via `git fsck` and re-anchored to a new `feature/marketable-pricing` branch pointer at `88fa012` (the refactor commit). A pre-merge architecture review of the recovered branch then found real gaps, which this Corrective Closeout sprint fixes. `main` and `origin/main` were unaffected throughout (confirmed at `9dc98e0` before and after).

### Branch/commit topology before this corrective commit

- `main` / `origin/main`: `9dc98e0`, clean, unchanged.
- `feature/marketable-pricing`: `88fa012` (two commits ahead of `main` — `2d0aeb8`, `88fa012`), recovered but not yet pushed to `origin` at the start of this pass.
- `feature/autopilot`: untouched throughout.

### Corrections made

1. **Documentation drift.** The design doc's "Object shape" section and this report's earlier text were consistent with the refactor, but `docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md`'s scope-list bullet and `docs/HANDOFF.md`'s "Key files to know" entry still described the pre-refactor shape — `liquidityTrapTriggered` as part of `PositionValuation`, and a nonexistent `attachLiquidityTrapTrigger()` export. Both corrected to state plainly: `PositionValuation` is observational only and exports nothing but `computePositionValuation()`; `liquidityTrapTriggered`/`executionRealityPromoted` live on `PositionObjectiveResult` in the Decision Engine. `docs/HANDOFF.md`'s git-state section, ticket-history bullet, and loose-ends list were also updated to reflect the recovery/corrective-closeout history and current pending-acceptance status (items #20 and #21 are new).
2. **Missing-marketable-data fallback coverage.** Added four new tests to `pi0014MarketablePricingFixtures.test.ts` proving `evaluatePositionObjective()` falls back cleanly to mid-only behavior when `marketablePnlPct`/`liquidityTier` are `null` or omitted: a materially-losing-on-mid position still triggers Cut Losses, a comfortable mid position still holds, a real mid profit target still fires Take Profit (no fabricated veto), and explicit-`null` behaves identically to the fields being omitted entirely.
3. **Invalid-quote coverage — with a disclosed scope boundary.** The leg-level bid/ask quote-validity guard (rejecting zero/negative/one-sided quotes before `closeValue` is ever computed) lives in `app/portfolio/page.tsx`, is pre-existing, untouched by PI-0014, and is not exported for isolated unit testing; duplicating its direction logic inside a test was explicitly out of scope and was avoided. Instead, added a test proving the safety property that actually matters regardless of *why* marketable data is unavailable: `evaluatePositionObjective()` and `computePositionValuation()` never fabricate promotion, veto, or a liquidity-trap trigger when marketable evidence is absent — the same fallback coverage as item 2 above, which is agnostic to whether the absence came from a missing quote or an invalid one. This is a disclosed testing limitation, not a claim of full leg-level coverage.
4. **Unknown-liquidity classification.** `computePositionValuation()` previously classified missing/zero/negative `maxRisk` as `'LIQUID'` (the best tier) because `slippagePercentOfMaxRisk` defaulted to 0. Corrected: `PositionValuation.liquidityTier` is now `LiquidityTier | null`, and `classifyLiquidityTier()` returns `null` (unknown) whenever `maxRisk` is unusable, rather than defaulting to a falsely reassuring reading. The 5%/15% thresholds are unchanged for valid `maxRisk` (regression-tested). `marketablePnlPct`-driven gates (`materialLoss`/`weakHealthLoss`/profit-target veto) are unaffected by `liquidityTier` and continue to fire correctly even when the tier is unknown — only `liquidityTrapTriggered` (which specifically requires `liquidityTier === 'LIQUIDITY_TRAP'`) reads `false` in that case, which is correct: the tier truly is unknown, not confirmed non-trap.
5. **Generated artifact removed from branch diff.** `tsconfig.tsbuildinfo` (a build cache file, not source) was part of the original recovered diff; restored to `main`'s exact content so it carries no diff. Note: running `tsc`/`vitest`/`next build` during this session's validation regenerated the file as a side effect a second time; it was restored again immediately afterward and reconfirmed byte-identical to `main` (via `git hash-object` / `git rev-parse main:tsconfig.tsbuildinfo`) before this addendum was written. Dean should verify this is still true (`git diff main -- tsconfig.tsbuildinfo` should be empty) before committing, since any local `tsc`/build run between now and the commit could regenerate it again.
6. **Operational documentation reconciled.** `planning/SPRINT_STATUS.md` updated: PI-0013 remains the last capability merged into `main`; PI-0014 is recorded as recovered and corrected on `feature/marketable-pricing`, pending Product Owner acceptance and merge (explicitly not stated as merged, and explicitly not stated as "no active sprint"); no PI-0015 or other next sprint is selected or recommended.

### Files changed by this corrective pass

- `docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md` — object-shape correction, scope-note correction, testing-section addendum.
- `docs/HANDOFF.md` — key-files correction, git-state section rewrite, PI-0014 ticket-history bullet updated, two new loose-end items.
- `docs/reviews/PI-0014-Marketable-Pricing-Implementation-Report.md` — this addendum.
- `planning/SPRINT_STATUS.md` — current-state, repository-state, validation-baseline, and next-sprint-gate sections updated.
- `lib/positionValuation/types.ts` — `PositionValuation.liquidityTier` is now `LiquidityTier | null`; doc comments updated.
- `lib/positionValuation/computePositionValuation.ts` — `classifyLiquidityTier()` takes a `hasValidMaxRisk` flag and returns `null` instead of defaulting to `'LIQUID'`.
- `lib/positionValuation/__tests__/computePositionValuation.test.ts` — updated the existing missing/zero/negative-`maxRisk` test to drop its now-incorrect `'LIQUID'` assertion; added four new tests (null-tier on missing/zero/negative `maxRisk`, and a regression guard confirming valid-`maxRisk` thresholds are unchanged).
- `lib/portfolio-intelligence/__tests__/pi0014MarketablePricingFixtures.test.ts` — added two new `describe` blocks (four missing-data-fallback tests, one unknown-liquidity-still-gates test).
- `tsconfig.tsbuildinfo` — restored to `main`'s content (no functional diff).

No changes to `app/portfolio/page.tsx` or `lib/portfolio-intelligence/objectives/positionObjective.ts` were needed for these corrections — both already treated `liquidityTier`/`marketablePnlPct` as nullable/optional, so the type tightening in `lib/positionValuation` required no downstream code changes.

### Architecture verification (re-confirmed after this pass)

`PositionValuation` remains pure, deterministic, and free of recommendation policy — `computePositionValuation()` is still the module's only exported function, and the `liquidityTier` correction only changes what a missing denominator produces (`null` instead of a wrong best-case label), not the module's responsibilities. `evaluatePositionObjective()` remains the sole owner of `executionRealityPromoted`/`liquidityTrapTriggered`. Mid pricing remains authoritative for analytics; marketable pricing remains scoped to the four approved execution-sensitive gates. No new recommendation rules, risk gates, scoring models, or UI were added.

### Targeted-test results

`lib/positionValuation` + `lib/portfolio-intelligence/__tests__/pi0014MarketablePricingFixtures.test.ts`: **2 files, 31 tests, all passing** (13 unit tests, up from 10 pre-closeout; 18 fixture tests, up from 13 pre-closeout).

### Full-suite results

All 45 test files in the repository, run in six batches (per this sandbox's per-command time budget — background processes do not persist across separate tool invocations here, confirmed empirically this session): **643 tests, 0 failures.** Includes `lib/autopilot`'s own 65 tests (untouched, confirming `feature/autopilot`'s isolation held), and the full, unmodified `lib/portfolio-intelligence` suite (210 tests including the corrected fixture file) and every `features/portfolio/*` component-test directory (166 tests across three batches).

### TypeScript result

`npx tsc --noEmit` — clean, exit 0, run once.

### Production-build result

`npx next build`, capped at 40 seconds (the maximum single bounded observation available in this sandbox): hung at the initial Next.js banner ("▲ Next.js 14.2.35 / Environments: .env.local") with no further progress, exit via `timeout` (124). This matches the identical, previously-documented limitation from every prior PI ticket in `docs/HANDOFF.md` (PI-0006A, the CSP ticket, UX Polish, PI-0012A, and PI-0014's own original pass) and is not treated as a regression given `tsc --noEmit` is clean and all 643 tests pass. Not investigated further, per the sprint's five-minute/no-further-investigation rule. **Vercel's build remains the authoritative check.**

### Confirmations

- `tsconfig.tsbuildinfo` is confirmed absent from the meaningful branch diff — its working-tree content is byte-identical to `main`'s (verified via `git hash-object` matching `git rev-parse main:tsconfig.tsbuildinfo`) immediately before this addendum was finalized.
- `feature/autopilot` was not referenced, checked out, modified, merged, rebased, or pushed at any point in this pass.
- `main`/`origin/main` remained at `9dc98e0`, unchanged, throughout.
- No paper execution, live execution, order submission, new recommendation rule, new risk gate, or UI surface was added. This pass was strictly corrective (documentation accuracy, test coverage, one classification-safety fix, one generated-file cleanup).
- Nothing was staged, committed, or pushed by the Implementation Engineer this pass, per explicit instruction — see this report's final section for the commands recommended for Dean to run from his own Terminal.

### Known follow-ups not included in this sprint

- Everything listed under "Deferred Enhancements" above (Phases 2–5, UI surfacing, Decision Engine Constitution update) remains deferred and out of scope.
- `lib/autopilot`'s own risk-gate engines still read mid pricing only — a real, related gap, previously flagged, not part of this or the original PI-0014 scope.
- Full leg-level bid/ask quote-validity testing (zero/negative/one-sided quotes at the point `closeValue` is constructed in `app/portfolio/page.tsx`) remains untested in isolation, since that logic is pre-existing, unexported, and out of scope to refactor for testability this pass. The downstream safety property (no fabrication when marketable data is absent) is covered; the upstream leg-level guard itself is not independently unit-tested.
- The stale `.git/index.lock` / unlink-on-tracked-files behavior of this mounted folder (documented in `docs/HANDOFF.md` loose-end #21) remains an environment characteristic to work around, not something resolved this pass.
