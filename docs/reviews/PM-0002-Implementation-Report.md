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

`parseBrokerEntryPremium()` preserves the difference between a real broker zero and missing/invalid data. Production positions carry `entryCredit`, `entryEconomicsComplete`, `entryPriceEffect`, and `maxRiskReliable`. The old numeric `creditReceived` remains as a compatibility field, but the Portfolio feature no longer treats its fallback zero as evidence.

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

Manual structural actions remain visually distinct from the suggestion. Their availability is gated by canonical position identity and complete entry economics. The suggested marker appears only when the displayed action exactly matches the canonical action; Verify Pricing cannot mark an unrelated manual button.

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
3. `features/portfolio/components/__tests__/VerifyPricingRefreshButton.test.tsx`
4. `features/portfolio/components/__tests__/TodaysPrioritiesWorkflow.test.tsx`
5. `features/portfolio/todaysPriorities/__tests__/TodaysPrioritiesQueueView.test.tsx`
6. `lib/portfolio-data/acquisition.ts`
7. `lib/portfolio-data/types.ts`
8. `lib/portfolio-data/__tests__/greekAcquisitionWiring.test.ts`
9. `lib/portfolio/closeOrderSafety.ts`
10. `lib/portfolio/positionLifecycle.ts`
11. `lib/portfolio/positionMetrics.ts`
12. `lib/portfolio/__tests__/positionMetrics.test.ts`
13. `lib/portfolio/canonicalRecommendationPresentation.ts`
14. `lib/portfolio/__tests__/canonicalRecommendationPresentation.test.ts`
15. `lib/position-snapshot/types.ts`
16. `lib/position-snapshot/snapshotEngine.ts`
17. `lib/position-snapshot/__tests__/snapshotEngine.test.ts`
18. `lib/decision-review/__tests__/outcomeAnalysis.test.ts`

Documentation:

19. `docs/reviews/PM-0002-Current-Portfolio-Row-Reconciliation-Audit.md`
20. `docs/reviews/PM-0002-Implementation-Report.md`

## Validation

Final clean-worktree validation after all corrections:

- Focused financial, acquisition, recommendation, snapshot, and refresh wiring cycle: 7 files / 142 tests passed.
- Adjacent Portfolio/stop/pricing cycle: 6 files / 98 tests passed.
- Complete suite in one invocation: **153 files / 2,140 tests passed; zero failures**.
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
