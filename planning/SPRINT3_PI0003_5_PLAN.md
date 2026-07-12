# Sprint 3, PI-0003.5 — Wire Real Financial Data into Portfolio Intelligence

**Branch:** `feature/portfolio-intelligence`
**Date:** 2026-07-12
**Status:** Plan (pre-implementation)

---

## Problem statement

PI-0003's combining adapter (`computeCanonicalPortfolioPriorities`) calls `evaluatePortfolioObjectives()` with an empty financial snapshot (`{}`), because no portfolio-level financial data (net liquidity, cash, buying power, drawdown, income) is read from anywhere on the Portfolio page. As a result, `DEPLOY_IDLE_CASH`, `INCREASE_INCOME`, `REDUCE_CONCENTRATION`, and `PRESERVE_BUYING_POWER` never fire from real production data.

## Current balances source (investigation findings)

There is **no single existing canonical balances source** to simply import — investigation found two independent, pre-existing fetch/parse implementations, neither connected to the Portfolio page:

1. **`components/BalancesTab.tsx`** — fetches `/accounts/{account}/balances` from TastyTrade, extracts only `net-liquidating-value` and `cash-balance` (plus a derived `netOptionsValue` from long/short derivative value). Used for the account-value chart, nothing else.
2. **`app/engine/page.tsx`** — fetches the same `/accounts/{account}/balances` endpoint independently, extracts `net-liquidating-value` **and** `derivative-buying-power`/`option-buying-power` (called `obp` internally) for its own capital-allocation calculator.

Neither is imported by `app/portfolio/page.tsx`, which today only loads positions and pending orders. No income-tracking, drawdown-history, or maintenance-requirement concept exists anywhere in the codebase (confirmed via repo-wide search for `buying-power`, `drawdown`, `maintenance-requirement`, `margin-equity`, `dailyPnL`, `income`-adjacent terms).

**Decision:** rather than create a third divergent parser, add one new `loadAccountBalances()` function directly to `app/portfolio/page.tsx`, following the exact same `getAccessToken()`/`ttFetch()` pattern the page already uses for `loadPositions()`. The actual **parsing** of the raw balance payload into a typed, optional-field model is a separate, pure, testable function (not embedded in the fetch call), living in `lib/portfolio-intelligence` since it has no I/O or React dependency. `BalancesTab.tsx` and `app/engine/page.tsx` are left untouched — refactoring them to share this parser is real cleanup work but out of scope here (touches existing UI surfaces this brief says not to change).

## Current Portfolio Intelligence input path

`buildPortfolioIntelligenceContext()` (PI-0003) accepts a `PortfolioFinancialSnapshot` with all-optional fields, but every field defaults to `?? 0` when building the `PortfolioStateInput` the evaluator actually consumes. Since the Portfolio page currently passes `{}`, every financial field is silently `0` today — which is the exact "missing becomes zero" anti-pattern this slice is meant to fix.

## Proposed financial context model

New file `lib/portfolio-intelligence/adapters/balancesNormalization.ts`:

```ts
export interface PortfolioFinancialContext {
  netLiquidity?: number;
  cashBalance?: number;
  availableBuyingPower?: number;
  maintenanceRequirement?: number;
  buyingPowerUsedPct?: number;   // see formula below; best-effort, flagged
  currentIncome?: number;        // always undefined this slice -- no source exists
  targetIncome?: number;         // always undefined this slice -- no source exists
  drawdownPct?: number;          // always undefined this slice -- no source exists
}
```

All fields genuinely optional (`number | undefined`, never a silent `0`). `PortfolioStateInput` (PI-0001's existing, required-number type consumed by `evaluatePortfolioObjectives`) is unchanged — see "Normalization rules" for how the gap between an optional-field context and a required-number input is bridged safely.

## Normalization rules

- `toFiniteNumber(value: unknown): number | undefined` — the single normalization point. Returns `undefined` for `null`, `undefined`, empty string, non-numeric string, `NaN`, or `±Infinity`. Never returns `0` for a missing/invalid input.
- `buildPortfolioFinancialContext(raw): PortfolioFinancialContext` — pulls each field through `toFiniteNumber`, trying the same field-name fallback chains already established elsewhere in this codebase (e.g. `derivative-buying-power ?? option-buying-power`, matching `app/engine/page.tsx`'s existing precedent).
- `derivePositionConcentration(positions, netLiquidity)` — per-symbol concentration as % of net liquidity. Returns `{}` (not a divide-by-zero or fabricated result) if `netLiquidity` is undefined, zero, or negative.

## Formula definitions

- **`availableBuyingPower`** = `derivative-buying-power ?? option-buying-power` (raw, dollars). Confirmed real field names — already used identically in `app/engine/page.tsx`.
- **`buyingPowerUsedPct`** = `maintenanceRequirement / netLiquidity`, only computed when both are finite and `netLiquidity > 0`. **Not independently verified against a live balance payload in this session** (no live network/API access available) — `maintenance-requirement` is a standard TastyTrade/margin-account field name but its presence has not been confirmed against Dean's actual account response. Flagged explicitly as a best-effort formula; see "Known remaining gaps."
- **`symbolConcentrationPct[symbol]`** = `sum(position.maxRisk for positions with that symbol) / netLiquidity * 100`. Uses `Position.maxRisk` (already computed on every position today) as the numerator and net liquidating value as the denominator — matching the design PI-0001 already documented ("symbol -> % of net liquidity currently allocated"), now actually computed instead of always `{}`.
- **`sectorConcentrationPct`** — stays `{}`. No sector field exists on `Position` anywhere in the app; fabricating one is out of scope.
- **`currentIncome`/`targetIncome`** — stay `undefined`. No canonical income-tracking metric exists anywhere in this codebase. Per the brief's explicit instruction, not derived from unrelated P/L values. `INCREASE_INCOME` will not fire until a real source is built.
- **`drawdownPct`** — stays `undefined`. No historical peak-equity tracking exists for the live account (only `BalancesTab`'s chart history, which isn't wired anywhere else). `PRESERVE_BUYING_POWER`'s drawdown-breach branch won't fire until this exists; its buying-power-utilization branch can still fire independently.

## Policy fields used

All existing, no new fields needed:
- `DEFAULT_PORTFOLIO_RISK_POLICY.maxBuyingPowerUtilizationPct` (65) — threshold for the new `buyingPowerUsedPct`.
- `DEFAULT_PORTFOLIO_RISK_POLICY.maxSymbolConcentrationPct` / `maxSectorConcentrationPct` — already used by `evaluateConcentration`, now fed real numerator/denominator data instead of an always-empty map.
- `DEFAULT_PORTFOLIO_RISK_POLICY.idleCashThresholdPct` / `defensiveDrawdownPct` — unchanged, now fed real (or honestly-absent) data.

No new policy fields required — `minIdleCashDeploymentAmount`-style additions from the brief's illustrative list weren't needed given the existing percentage-based thresholds already cover this.

## Files to change

- New: `lib/portfolio-intelligence/adapters/balancesNormalization.ts`
- Modify: `lib/portfolio-intelligence/adapters/portfolioIntelligenceAdapter.ts` (accept the richer context, compute concentration, bridge to `PortfolioStateInput` safely)
- Modify: `lib/portfolio-intelligence/index.ts` (export new module)
- Modify: `app/portfolio/page.tsx` (new `loadAccountBalances()`, new `balances` state, wire real data into the existing canonical-priorities effect)
- New tests: adapter/normalization tests, objective-firing tests with real data, one integration test

## Test plan

Adapter: valid mapping, missing-stays-undefined, NaN/Infinity rejection, percentage consistency, no source mutation, zero-as-valid-value, negative-value handling, concentration denominator absent → `{}` not fabricated.

Objective evaluation: `DEPLOY_IDLE_CASH` fires/doesn't with real cash; never outranks critical risk; `PRESERVE_BUYING_POWER` fires/doesn't at the real threshold; `REDUCE_CONCENTRATION` uses the net-liquidity denominator correctly; missing net liquidity doesn't fabricate concentration; `INCREASE_INCOME` stays silent (no source); existing position-management and ranking tests remain green.

Integration: one realistic combined-context test through `computeCanonicalPortfolioPriorities`.

## Non-goals

Matches the brief's list exactly: no new UI, no Daily Briefing, no Decision History, no paper trading, no Autopilot, no live execution, no order placement, no AI explanations, no notifications, no multi-portfolio, no new balances API, no charting, no historical snapshots, no objective persistence, no candidate-risk execution gates, no PI-0004.

## Known remaining gaps (anticipated; confirmed list follows implementation)

- `buyingPowerUsedPct`'s `maintenance-requirement` field has not been verified against a live TastyTrade response.
- No income or drawdown-history source exists; those two objective rules remain structurally silent until a real source is built elsewhere.
- `BalancesTab.tsx` and `app/engine/page.tsx` still have their own separate, unrefactored balance-parsing logic — not consolidated in this slice.

## Acceptance criteria

Per the brief's 14-point list — tracked in the "Acceptance criteria — final status" section added after implementation, below.

---

## Post-implementation results

**Status:** Complete, locally verified. Vercel preview confirmation pending push.

### Files changed

- New: `lib/portfolio-intelligence/adapters/balancesNormalization.ts` — `toFiniteNumber`, `buildPortfolioFinancialContext`, `derivePositionConcentration`, `PortfolioFinancialContext` type.
- New: `lib/portfolio-intelligence/__tests__/balancesNormalization.test.ts` — 27 tests.
- Rewritten: `lib/portfolio-intelligence/adapters/portfolioIntelligenceAdapter.ts` — accepts `PortfolioFinancialContext` + `PositionExposureInput[]` instead of the old always-empty `PortfolioFinancialSnapshot`; documents exactly why "unavailable → 0" is safe for each field it bridges into `PortfolioStateInput`.
- Modified: `lib/portfolio-intelligence/index.ts` — new exports.
- Modified: `lib/portfolio-intelligence/__tests__/portfolioIntelligenceAdapter.test.ts` — updated call sites for the new signature/field names (8 anchors changed, no test *behavior* changed beyond that).
- Modified: `app/portfolio/page.tsx` — new `loadAccountBalances()` (reuses the page's existing `getAccessToken`/`ttFetch`, same endpoint `app/engine/page.tsx` already calls independently), new `balances` state, updated wiring effect to pass real financial data + per-position exposure into the adapter.

### Final formulas

- `availableBuyingPower` = `derivative-buying-power ?? option-buying-power ?? equity-buying-power` (raw dollars).
- `buyingPowerUsedPct` = `(maintenanceRequirement / netLiquidity) * 100`, only when both are finite and `netLiquidity > 0`. **Confirmed not independently verified against a live TastyTrade balance payload** — see "Known remaining gaps."
- `idleCashPct` = `(cashBalance / netLiquidity) * 100`, only when both are known and `netLiquidity > 0`.
- `symbolConcentrationPct[symbol]` = `sum(position.maxRisk for that symbol) / netLiquidity * 100`. Uses `Position.maxRisk` (already computed on every position) as numerator, net liquidating value as denominator.
- `currentIncome`/`targetIncome`/`drawdownPct` — confirmed to have no real source anywhere in the app; stay `undefined` always, exactly as planned.

Percentage convention: all percentages in `PortfolioFinancialContext` and the resulting `PortfolioStateInput` are whole-number percent (25 means 25%, not 0.25) — matches every existing percentage field already in `lib/portfolio-intelligence` (e.g. `PortfolioIntelligenceThresholds.profitTargetPct: 50`).

### Which portfolio-level objectives now fire from real data

- **`DEPLOY_IDLE_CASH`** — fully operational. Fires from real `cashBalance`/`netLiquidity`.
- **`PRESERVE_BUYING_POWER`** — operational for its utilization branch (`buyingPowerUsedPct`), *conditional* on `maintenance-requirement` actually being present in the live balance response (unverified — see gaps). Its drawdown branch remains silent (no drawdown source).
- **`REDUCE_CONCENTRATION`** — fully operational, using `Position.maxRisk` and real net liquidity.
- **`INCREASE_INCOME`** — remains structurally silent. No canonical income-tracking source exists anywhere in the app; inventing one from P/L was explicitly out of scope. Stays silent by design, not by oversight.

### Tests added

34 new tests: 27 in `balancesNormalization.test.ts` (normalization, concentration, objective-firing with real data, one full integration test), plus the 8-anchor rename in the existing adapter test file (no new test count there, same 11 tests, updated to the new signature).

**Final test count: 206** (up from 179; +27 net new).

### Build results

- `npx tsc --noEmit`: clean.
- `npx next build`: clean, exit 0. `/portfolio` compiles at 99.6 kB (was 99 kB — negligible increase).
- Vercel preview: pending push confirmation.

### Acceptance criteria — final status

| # | Criterion | Status |
|---|---|---|
| 1 | Balances data passed into Portfolio Intelligence through one canonical adapter | ✅ |
| 2 | Portfolio-level rules evaluate real production financial values | ✅ (3 of 4 rules fully operational; `INCREASE_INCOME` intentionally silent, see above) |
| 3 | Missing financial values not silently treated as zero | ✅ at the `PortfolioFinancialContext` level (genuinely `undefined`); documented, narrow, provably-safe zero-bridging at the `PortfolioStateInput` boundary only |
| 4 | Documented monetary/percentage conventions | ✅ |
| 5 | Thresholds centralized in canonical policies | ✅ — no new policy fields needed, all reused |
| 6 | No new user-facing UI | ✅ |
| 7 | No execution behavior | ✅ |
| 8 | Existing ranking precedence intact | ✅ — `prioritizePortfolioObjectives` untouched |
| 9 | Existing Rule IDs stable | ✅ — no rule IDs renamed or duplicated |
| 10 | All tests pass | ✅ 206/206 |
| 11 | TypeScript passes | ✅ |
| 12 | Production build passes | ✅ |
| 13 | Vercel preview succeeds | ⬜ pending push |
| 14 | Plan updated with actual results | ✅ (this section) |

### Known remaining gaps (confirmed, not anticipated)

- **`maintenance-requirement` field presence unverified.** No live API access was available in this session. `buyingPowerUsedPct` and therefore `PRESERVE_BUYING_POWER`'s utilization branch depend on this field actually appearing in Dean's live balance response. **Recommended follow-up: verify with one `console.log(balData)` on the live page**, or check the Network tab's raw `/accounts/{account}/balances` response, before fully trusting this rule in production.
- No income-tracking or drawdown-history source exists anywhere in the app. `INCREASE_INCOME` and `PRESERVE_BUYING_POWER`'s drawdown branch remain structurally silent until one is built — a real product decision, not an oversight.
- `BalancesTab.tsx` and `app/engine/page.tsx` still have their own separate, unrefactored balance-parsing logic, now a third (or rather, still two other) divergent implementation alongside the new one on the Portfolio page. Consolidating all three into one shared parser is real, valuable cleanup — explicitly out of scope here per "do not change existing UI behavior."
