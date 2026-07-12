# Sprint 3, PI-0003 — Canonical Portfolio Priority Engine

**Branch:** `feature/portfolio-intelligence`
**Date:** 2026-07-12
**Status:** Complete, locally verified. Vercel preview confirmation pending push.

---

## Objective

Make `lib/portfolio-intelligence` the single source of truth for all portfolio priorities. PI-0001 built the portfolio-level batch evaluator; PI-0002 consolidated per-position health/recommendation logic. What remained: portfolio *priorities* (ranking) were still produced by a third, separate path (TE-0006C), and `evaluatePortfolioObjectives()` from PI-0001 had zero production consumers.

## What was built

### 1. Risk Policy Separation

Two previously-implicit concepts — "does this existing position need attention" vs. "should additional portfolio risk be accepted" — are now explicit, typed, documented policy objects in `lib/portfolio-intelligence/policies/`:

- **`PositionManagementPolicy`**: `profitTargetPct`, `dteReviewThreshold`, `materialLossPct`, `weakHealthLossPct`/`weakHealthScoreThreshold`, `watchHealthScoreThreshold`, `actionHealthScoreThreshold`.
- **`PortfolioRiskPolicy`**: `maxBuyingPowerUtilizationPct`, `maxSymbolConcentrationPct`, `maxSectorConcentrationPct`, `defensiveDrawdownPct`, `idleCashThresholdPct`, `maxNewCandidateRiskPct`, `candidateMaterialLossPct`.

`evaluatePositionObjective()` (PI-0002's TE-0006B consolidation) now reads its thresholds from `DEFAULT_POSITION_MANAGEMENT_POLICY` instead of bare magic numbers — **all default values are unchanged**, this is a pure formalization, not a behavior change.

**Judgment call:** `PortfolioRiskPolicy.candidateMaterialLossPct` (-200, "2x credit loss stop") and `PositionManagementPolicy.materialLossPct` (-100, TE-0006B parity) remain deliberately different numbers, as PI-0002 originally documented. This slice makes that difference an explicit, named, typed field on each policy rather than a bare magic number — it does not unify them, since unifying would change existing behavior on one side or the other with no product decision authorizing that.

### 2. Fine-Grained Rule IDs

Replaces PI-0002's one-rule-ID-per-objective-type scheme with 15 descriptive rule IDs (`OBJ-ASSIGNMENT-RISK`, `OBJ-EARNINGS-RISK`, `OBJ-CLOSE-LOSER`, `OBJ-PLACE-GTC`, `OBJ-LET-EXPIRE`, `OBJ-WATCH-POSITION`, etc.), each objective producer setting its own explicit `ruleId` per triggering branch rather than looking one up by type. `RULE_ID_OBJECTIVE_TYPE` (in `ruleIds.ts`) is the reverse mapping, plus `isRuleIdConsistentWithType()` for validation.

This directly resolves the naming tension PI-0002 flagged in its own plan doc ("`OBJ-MANAGE-21-DTE` now covers some non-DTE-driven cases like `place-gtc`") — those now get their own correct IDs.

### 3. TE-0006C Consolidated

`features/portfolio/priorities/priority-engine.ts`'s `buildDailyPriorities()`/`buildTopPriorities()` are now shims delegating to the canonical `prioritizePortfolioObjectives()` (new file, `lib/portfolio-intelligence/prioritizePortfolioObjectives.ts` — the ranking logic extracted and generalized from `evaluatePortfolioObjectives.ts`'s previously-internal `rankObjectives()`). `priority-sort.ts`'s bespoke comparator is no longer called (left in place, unused, not deleted).

**Scope note:** confirmed via grep before touching anything — `DailyPriorityList`/`buildDailyPriorities` have **zero callers anywhere in the app**. This consolidation has no user-visible effect today; it exists so that whenever that component is eventually wired into the Portfolio page (out of scope here — "no new Portfolio UI"), it's already backed by the canonical engine rather than a second ranking system.

### 4. Portfolio Intelligence Wired

`lib/portfolio-intelligence/adapters/portfolioIntelligenceAdapter.ts` is `evaluatePortfolioObjectives()`'s first real production consumer. `computeCanonicalPortfolioPriorities()` combines:
- **Position Objectives** — `evaluatePositionObjective()` per position (PI-0002's parity-preserving evaluator, already driving the Portfolio page's UI).
- **Portfolio Objectives + Pending Order Objectives** — one `evaluatePortfolioObjectives()` call with `positions: []` supplied, so it produces only its portfolio-level rules (concentration/buying-power/idle-cash/income) and its pending-order rule.

into one list via `prioritizePortfolioObjectives()`.

**Judgment call, and the most consequential one in this slice:** `evaluatePortfolioObjectives()` also has its *own* position-level threatened/profit/DTE rules (from PI-0001), with different thresholds than `evaluatePositionObjective()` (PI-0002's parity-preserving numbers). Combining both position-rule sets for the same position would produce duplicate, conflicting objectives. The combiner deliberately passes `positions: []` to suppress the batch evaluator's own position rules, sourcing all position-level objectives from the already-UI-connected evaluator instead. This satisfies "do not maintain two ranking engines" (there's exactly one *ranking* engine) without silently merging two *rule-generation* threshold sets that were deliberately kept separate for parity reasons across PI-0002 and this slice.

`app/portfolio/page.tsx` now calls `computeCanonicalPortfolioPriorities()` in a new effect whenever positions/pending orders change, storing the result in a new `canonicalPriorities` state variable — **not rendered anywhere**, per the brief's explicit "no new UI" constraints. This makes the page a genuine production caller (resolving PI-0001's "zero consumers" gap) without adding any visible feature.

**Known gap, documented in code and here:** portfolio-level financial aggregates (net liquidity, cash, buying power, drawdown, concentration, idle cash, income) aren't computed anywhere on the Portfolio page today — they live only in the Balances tab, which this adapter doesn't read. The page currently calls the adapter with an empty financial snapshot (`{}`), so `DEPLOY_IDLE_CASH`/`INCREASE_INCOME`/`REDUCE_CONCENTRATION`/`PRESERVE_BUYING_POWER` will not fire from production data yet — only position-level and pending-order objectives are live today. Wiring the Balances tab's data into this adapter is separate integration work, not this slice's architecture-consolidation goal.

### 5. Canonical Ranking

`prioritizePortfolioObjectives()`'s category order was refined to match the brief's explicit sequence: critical risk/threatened positions → time-sensitive management → harvest profits → pending-order issues → **portfolio construction → buying-power preservation → idle-cash deployment → increase income** (previously PI-0002 had construction/buying-power as one tier and idle-cash/income as another; now all four are distinct tiers) → wait. Enforced structurally, not just by ranking order: `DEPLOY_IDLE_CASH`/`INCREASE_INCOME` are never assigned `critical` priority by any producer, so a critical threatened position cannot be outranked regardless of category.

## Tests

**24 new tests** (7 policy, 5 canonical-ranking, 11 adapter/integration, 1 net addition to `positionObjective.test.ts`'s fine-grained-rule-ID coverage), on top of the 155 already passing = **179 total, all passing.** Test count improved (brief: "maintain or improve total test count").

Coverage: policy separation, watch/action thresholds, critical-risk-outranks-income (both at the prioritizer level and the combined-adapter level), profit harvesting, 21-DTE management, assignment-aware CSP (pre-existing PI-0001 coverage, unaffected by this slice), fine-grained rule IDs (both producers), portfolio evaluator integration, Daily Priority integration, pending-order objectives, WAIT, safety (execution flags across the full combined list).

## Safety

`executionAllowed: false` / `paperExecutionAllowed: false` verified on every objective across all three sources in the combined list. No paper execution, live execution, order submission, position mutation, simulated fills, or Autopilot execution anywhere in this patch — purely reasoning/ranking/wiring.

## Exit criteria — status

| Criterion | Status |
|---|---|
| Risk policy separation, documented | ✅ |
| Fine-grained rule IDs | ✅ 15 IDs, multiple per type where appropriate |
| TE-0006C consolidated, one ranking engine | ✅ |
| Portfolio Intelligence wired to a real consumer | ✅ (Portfolio page, not yet rendered) |
| Canonical ranking order matches spec | ✅ |
| Critical risk never outranked by income | ✅ structurally + tested |
| Tests added, total count improved | ✅ 155 → 179 |
| TypeScript passes | ✅ `tsc --noEmit` clean |
| Local build passes | ✅ `next build` clean, `/portfolio` compiles (99 kB) |
| Vercel preview passes | ⬜ Manual — confirm after push |
| No Autopilot integration, paper trading, Daily Briefing, or Decision History | ✅ none added |

## Later items (explicitly not done in this patch)

- Wire the Balances tab's real financial data into `buildPortfolioIntelligenceContext()` so `DEPLOY_IDLE_CASH`/`INCREASE_INCOME`/`REDUCE_CONCENTRATION`/`PRESERVE_BUYING_POWER` can actually fire in production.
- Surface `canonicalPriorities` (or `DailyPriorityList`) in the Portfolio UI — explicitly out of scope per this brief.
- Reconsider whether `evaluatePortfolioObjectives()`'s own position-level rules (now unused whenever called via the adapter, since `positions: []` is always passed there) should be removed or kept for its standalone/test use — currently kept, since PI-0001's own tests call it directly with real positions.
- Physically delete now-fully-unused files (`priority-sort.ts`'s comparator, the PI-0002-era shim files) once confident nothing references them.
- Candidate-risk policy enforcement (`maxNewCandidateRiskPct`) — field exists, documented, not yet wired as an actual gate anywhere in `lib/portfolio-intelligence`.
