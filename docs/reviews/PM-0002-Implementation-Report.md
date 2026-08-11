# PM-0002 — Current Portfolio Row Metrics and Suggested-Action Reconciliation

## Delivery

- Base: `origin/main @ 2e515ba`
- Branch: `fix/pm-0002-portfolio-row-correctness`
- Audit import: `afa6006`
- Earlier implementation commits: `69a2d8f`, `ca3aa58`, `eeba8fb`, `5ef6e70`
- Final corrective commit: the commit containing this report (see branch log)
- Push/merge: not performed

## Final architecture

### Entry economics are fail-closed

`parseBrokerEntryPremium()` preserves the difference between a real broker zero and missing/invalid data. Production positions carry `entryCredit`, `entryEconomicsComplete`, `entryPriceEffect`, and `maxRiskReliable`. The old numeric `creditReceived` remains as a compatibility field, but the Portfolio feature no longer treats it as canonical evidence. Canonical provenance requires `entryEconomicsComplete === true` and a finite, non-null `entryCredit`; credit-derived targets, stops and actions additionally require `entryPriceEffect === 'Credit'` and a positive credit.

When any required leg premium is unavailable:

- P/L, P/L percentage, close P/L, POP, profit targets, stop calibration, Remaining Opportunity, entry-based valuation, and net-of-credit risk are unavailable;
- no canonical Place GTC, Take Profit, or Cut Losses action can be created from the compatibility zero;
- lifecycle snapshots store nullable credit plus explicit completeness provenance;
- trade memory stores an unknown outcome rather than a fabricated 0% result;
- portfolio totals and prompts exclude the position and disclose the exclusion;
- target editing, target extension, stop/GTC suggestions, and entry-derived order prices are disabled;
- close-order calculations use the canonical close identity only and never fall back to `Position.creditReceived`.

The live acquisition regression uses a two-leg, five-contract broker-shaped fixture with one missing `average-open-price` and proves these outputs fail closed through `loadPositions()`.

### Canonical recommendation is the sole suggested-action authority

The compact row and expanded position intelligence consume `Position.recommendation`. Canonical sort priority is applied only after canonical recomputation. If a canonical recommendation is absent, the card says Recommendation Unavailable; it does not invoke the legacy recommendation engine.

Manual structural actions remain visually distinct from the suggestion. Close/Roll is gated by canonical close identity rather than the credit-entry completeness gate. Credit-derived manual actions require explicit supported-credit provenance. The suggested marker appears only when the displayed action exactly matches the canonical action; Verify Pricing cannot mark an unrelated manual button.

The former position-level “AI Analysis” control is now **Explain Recommendation**. It makes no AI request and renders a deterministic projection of current canonical evidence. The projector accepts hostile model-shaped input in its regression test and proves that action, confidence, summary, reasoning, risk, catalyst, and rule-deviation prose cannot enter the visible explanation. Follow-up chat remains a separate user-initiated AI feature and receives explicit unavailable values rather than fabricated entry economics.

### Broker Greek wiring and units

The acquisition path aggregates each broker leg Greek using validated symbol, positive integer quantity, and an exact `Short`/`Long` direction. Missing or malformed structure or a missing Greek makes that aggregate unavailable; it never defaults quantity to one, direction to long, or silently forms a partial-position aggregate.

A realistic `loadPositions()` test proves the complete path:

1. Tastytrade-shaped option positions and market-data payloads;
2. signed five-contract aggregation across both MU spread legs;
3. raw `Position` aggregates;
4. one and only one contract-multiplier conversion for display.

Final labels:

- Delta: share-equivalent exposure (`sh-eq`), not percent;
- Theta: whole-position dollars per day;
- Gamma: share-equivalent delta change per $1 underlying move;
- Vega: whole-position dollars per one IV-point move.

For the regression payload, raw Theta `0.23`, Gamma `0`, Delta `0.50`, and Vega `-0.15` display as `+$23/day`, `0 sh-eq/$1`, `+50 sh-eq`, and `-$15/IV point`. The prior screenshot’s raw `-0.15` Vega was therefore a mislabeled aggregate, not a verified `-$0.15` whole-position exposure.

### Pricing refresh and broker timestamps

The approved centralized 120-second recommendation boundary is unchanged. It remains recommendation-only and creates no execution authority.

Every Verify Pricing entry point—the position row, Today’s Priorities, and Priority List—passes the oldest pre-refresh broker leg timestamp into the shared refresh action. Tests at both priority workflow surfaces prove that a successful after-hours fetch with the same broker timestamp reports that the timestamp did not advance and pricing remains unverified. Browser/provider completion time is never substituted for broker quote time.

The row continues to show oldest broker quote time, age, quality, and freshness. Missing timestamps, stale/degraded evidence, refresh failure, supersession, resolution, and position closure remain distinct outcomes. There is no polling or automatic retry.

## MU financial reconciliation

The existing PI-0014 fixture remains the canonical MU pricing example:

- 5 × MU 800P/790P spreads;
- $1,260 entry credit;
- $5,000 gross width and $3,740 theoretical expiration max loss;
- $1,600 derived midpoint buyback;
- -$340 / -26.98% midpoint P/L;
- $3,650 derived marketable estimate;
- -$2,390 / -189.68% marketable P/L;
- $2,050 midpoint-to-marketable gap, 54.81% of max risk.

Stale, degraded, or incomplete marketable evidence remains observational and cannot independently create a hard directional recommendation. After hours, an unchanged broker timestamp truthfully leaves Verify Pricing unresolved.

## Final changed-file inventory

Product and tests across PM-0002:

1. `app/portfolio/page.tsx`
2. `features/portfolio/components/VerifyPricingRefreshButton.tsx`
3. `features/portfolio/components/TodaysPrioritiesWorkflow.tsx`
4. `features/portfolio/todaysPriorities/TodaysPrioritiesQueueView.tsx`
5. `features/portfolio/components/__tests__/VerifyPricingRefreshButton.test.tsx`
6. `features/portfolio/components/__tests__/TodaysPrioritiesWorkflow.test.tsx`
7. `features/portfolio/todaysPriorities/__tests__/TodaysPrioritiesQueueView.test.tsx`
8. `lib/portfolio-data/acquisition.ts`
9. `lib/portfolio-data/types.ts`
10. `lib/portfolio-data/__tests__/greekAcquisitionWiring.test.ts`
11. `lib/portfolio-data/__tests__/pricingDecisionWiring.test.ts`
12. `lib/portfolio/closeOrderSafety.ts`
13. `lib/portfolio/positionLifecycle.ts`
14. `lib/portfolio/positionMetrics.ts`
15. `lib/portfolio/__tests__/positionMetrics.test.ts`
16. `lib/portfolio/canonicalRecommendationPresentation.ts`
17. `lib/portfolio/__tests__/canonicalRecommendationPresentation.test.ts`
18. `lib/position-snapshot/types.ts`
19. `lib/position-snapshot/index.ts`
20. `lib/position-snapshot/snapshotEngine.ts`
21. `lib/position-snapshot/__tests__/snapshotEngine.test.ts`
22. `app/api/position-lifecycle-snapshots/route.ts`
23. `app/portfolio/__tests__/RecommendationExplanationPage.test.tsx`
24. `lib/decision-review/__tests__/outcomeAnalysis.test.ts`
25. `lib/portfolio-data/__tests__/stopLossWiring.test.ts`

Documentation:

26. `docs/reviews/PM-0002-Current-Portfolio-Row-Reconciliation-Audit.md`
27. `docs/reviews/PM-0002-Implementation-Report.md`

## Validation

Final clean-worktree validation after all corrections:

- Focused financial, acquisition, recommendation, snapshot, and refresh wiring cycle: 7 files / 142 tests passed.
- Adjacent Portfolio/stop/pricing cycle: 6 files / 98 tests passed.
- Complete suite in one invocation: **154 files / 2,151 tests passed; zero failures**.
- TypeScript: `npx tsc --noEmit --incremental false` passed.
- Diff validation: `git diff --check` passed.
- Production build: `npm run build` passed; all 53 pages generated. Redis connection warnings occurred during static generation because the isolated environment blocks external Redis access, but they did not fail or alter the build.

The earlier two CSP tie-break failures did not recur in this final run; the final report therefore does not carry them as a current exception.

## Explicit boundaries

- The compatibility `creditReceived` field was not made nullable repository-wide; the current Portfolio feature uses the nullable completeness contract at every economic boundary.
- The 120-second recommendation threshold was not changed.
- No new Greek risk thresholds were invented.
- POP, Theta-minus-Gamma, and the 50%-target timing projection remain modeled estimates and are labeled as such.
- Unresolved-pricing continuity remains in-session only.
- Cross-session persistence and unrelated CSP tie-break behavior remain separate product decisions.

## Final supported-credit boundary correction

The final approval pass removed the remaining compatibility-field reads. Canonical objective scoring, Remaining Opportunity, stop classification, the exported legacy evaluator, compact-row credit/P&L, and Extend eligibility now require `hasSupportedCreditEntryEconomics()` and consume canonical `entryCredit`. A complete debit never enters credit-derived recommendation, Remaining Opportunity, target, GTC, stop, Take Profit, or Cut Losses logic; Close/Roll remains independently available through canonical close identity.

The compact row now distinguishes the three states in the required order: incomplete provenance displays `Unavailable`, a known debit displays `Debit (unsupported)`, and a supported credit displays canonical `entryCredit`. Regression coverage deliberately supplies a mismatched legacy `creditReceived: 0` beside canonical `entryCredit: 1260` and proves both the displayed credit and P/L percentage use the canonical value. Additional tests prove complete debit acquisition produces no credit-oriented objective or Remaining Opportunity, debit/missing provenance cannot calibrate stop classification, and debit rows expose Close/Roll while hiding Take Profit, Place GTC, Cut Losses, Set Stop, and target projection.

## Final debit valuation correction

The last approval correction closes unsupported debit valuation completely. `loadPositions()` now computes `closeNowPnl` only for a supported net-credit entry and marks `maxRiskReliable` true only under that same provenance. A complete debit therefore keeps its truthful `Debit (unsupported)` identity but receives neither a fabricated `-closeValue` marketable P/L nor a credit-formula Max Risk assertion. The Portfolio card independently enforces the same boundary: it suppresses Derived marketable P/L and renders Max Risk as `Unavailable` for debit or incomplete entries, even if stale compatibility fields are present.

A realistic acquisition regression supplies a complete two-leg net-debit broker fixture and proves `closeNowPnl: null` and `maxRiskReliable: false`. The page-level debit regression deliberately supplies stale contradictory `closeNowPnl` and `maxRiskReliable` values and proves neither is presented as supported financial evidence. The final file inventory is 27 files and includes `lib/portfolio-data/__tests__/stopLossWiring.test.ts`.

## Final downstream Max Risk correction

All Max Risk consumers now use one pure fail-closed boundary, `reliableSupportedMaxRisk()`. It returns a value only when entry provenance is explicitly complete, the entry is a supported positive net credit, `maxRiskReliable === true`, and the value is finite and non-negative. The compact row, Portfolio `At Risk` aggregate, position recommendation prompt, portfolio-analysis prompt, and follow-up context all use this boundary. Debit, incomplete, missing-credit, and legacy records with omitted reliability therefore cannot surface a credit-formula Max Risk anywhere in the current Portfolio experience.

The helper regression proves every rejected provenance state and the supported-credit control. The acquisition fixture now represents an economically coherent debit put spread: long the higher-strike 800 put for $2 and short the lower-strike 790 put for $1. It continues to prove that acquisition publishes neither marketable P/L nor reliable Max Risk for unsupported debit economics.
