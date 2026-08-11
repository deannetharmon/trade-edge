# PM-0002 — Current Portfolio Row Metrics and Suggested-Action Reconciliation

## Delivery

- Base: `origin/main @ 2e515ba`
- Branch: `fix/pm-0002-portfolio-row-correctness`
- Audit import: `afa6006`
- Product/tests: `69a2d8f`
- Final authority correction: `ca3aa58`
- Push/merge: not performed

## Final architecture

### Entry economics

Broker `average-open-price` is parsed by `parseBrokerEntryPremium()`:

- missing, null, empty, whitespace-only, malformed, negative, NaN, or infinite -> `null`;
- genuine broker zero -> `0`;
- finite nonnegative premium -> the broker value.

`PositionLeg.avgOpenPrice` is nullable. Production positions additionally carry:

- `entryCredit: number | null` — canonical whole-position credit;
- `entryEconomicsComplete` — whether every required leg has a finite premium;
- `entryPriceEffect: Unknown` when incomplete;
- `maxRiskReliable` — whether max risk can be stated net of entry credit.

The legacy numeric `creditReceived` field remains for compatibility, but every changed calculation and presentation gate uses the completeness contract. Incomplete entry economics now force P/L, P/L percentage, close P/L, POP, target, net-of-credit max risk, stop calibration, and CSP Effective Buy unavailable/inert. They are not displayed as a genuine zero.

### Canonical recommendation

`lib/portfolio/canonicalRecommendationPresentation.ts` is the sole adapter from `PortfolioRecommendationKind` to existing action-button buckets and sort priority.

The compact Suggested field now uses `Position.recommendation`. Its public label comes directly from the canonical recommendation, so `verify-pricing` remains **Verify Pricing** even though its compatible manual-action bucket is `MANAGE`. AI analysis no longer replaces the row action; its header states the canonical action and labels the model output as explanation only. Recommendation sorting occurs after canonical recomputation in `attachSnapshotHistory()`.

Manual action availability remains independent. A negative midpoint P/L may continue to expose Cut Losses without marking it suggested.

### Greek units

- Theta: raw broker aggregate ×100, displayed as whole-position dollars/day.
- Gamma: raw broker aggregate ×100, displayed as share-equivalent delta change per $1 underlying move, sign preserved.
- Vega: raw broker aggregate ×100, displayed as whole-position dollars per one IV-point move, sign preserved.

The old row-level Strong/Low/Moderate labels and raw aggregate thresholds are no longer rendered. Small nonzero Gamma uses enough precision (or `<0.01`) and cannot display as `0.000` merely from rounding.

### Pricing refresh and timestamps

The approved centralized 120-second recommendation policy is unchanged.

The row now displays, beside an unresolved pricing action:

- oldest broker leg-quote time;
- quote age;
- quote quality;
- quote freshness.

Refresh completion remains provider/browser time and is not substituted for broker time. `VerifyPricingRefreshButton` compares the pre-refresh and post-refresh broker timestamps. An unchanged after-hours response now reports: the quotes were fetched, the broker timestamp did not advance, and pricing is still unverified. Missing timestamps, degraded quality, stale evidence, failure, resolution, supersession, and position closure retain distinct outcomes. No polling, automatic retry, execution, or cross-session persistence was added.

## MU reconciliation

The existing PI-0014 fixture continues to prove:

- five MU 800P/790P spreads;
- $1,260 credit;
- $5,000 gross width;
- $3,740 theoretical max risk;
- $1,600 midpoint buyback;
- -$340 / -26.98% midpoint P/L;
- $3,650 derived marketable estimate;
- -$2,390 / -189.68% marketable P/L;
- $2,050 gap, 54.81% of max risk;
- stale/degraded marketable evidence remains Verify Pricing.

The new presentation tests prove that Verify Pricing remains the public label and canonical sort basis. Refresh tests prove unchanged broker timestamps do not become fresh merely because a browser refresh completed.

## Changed files

Product and tests through `ca3aa58`:

1. `app/portfolio/page.tsx`
2. `features/portfolio/components/VerifyPricingRefreshButton.tsx`
3. `features/portfolio/components/__tests__/VerifyPricingRefreshButton.test.tsx`
4. `lib/portfolio-data/acquisition.ts`
5. `lib/portfolio-data/types.ts`
6. `lib/portfolio/closeOrderSafety.ts`
7. `lib/portfolio/positionLifecycle.ts`
8. `lib/portfolio/positionMetrics.ts`
9. `lib/portfolio/__tests__/positionMetrics.test.ts`
10. `lib/portfolio/canonicalRecommendationPresentation.ts`
11. `lib/portfolio/__tests__/canonicalRecommendationPresentation.test.ts`

Documentation:

12. `docs/reviews/PM-0002-Current-Portfolio-Row-Reconciliation-Audit.md`
13. `docs/reviews/PM-0002-Implementation-Report.md`

## Validation

- Focused: 8 files / 198 tests passed.
- TypeScript: `npx tsc --noEmit --incremental false` passed.
- Diff validation: `git diff --check` passed.
- Full suite: 152 files / 2,132 tests accounted for; 2,130 passed and two pre-existing `lib/scans/__tests__/cspSearch.test.ts` tie-break assertions failed.
- Baseline proof: the same two CSP assertions fail unchanged on base `2e515ba` in the clean audit worktree (22/24 passing). PM-0002 did not modify CSP search or tests.
- Production build: `npm run build` exited successfully after Next.js compiled and completed type/lint validation; only optional-platform SWC cache warnings appeared.
- Post-correction validation: TypeScript passed again; canonical presentation + Portfolio page 2 files / 8 tests passed; diff check passed.

## Deviations and deferred decisions

- The legacy numeric `creditReceived` compatibility field was not made nullable repository-wide. The new `entryCredit` and completeness contract are authoritative for the current Portfolio pipeline. A future cleanup may migrate all unrelated consumers and remove the compatibility field.
- The existing 120-second recommendation threshold is unchanged.
- No new Greek risk thresholds were invented. Strategy-, size-, and capital-aware qualitative thresholds remain a product decision.
- POP, theta-minus-gamma estimate, and the 50%-target projection formulas were not changed; their presentation is now explicitly modeled/heuristic.
- Cross-session persistence of unresolved pricing remains out of scope.
- The unrelated CSP tie-break failures require their own ticket; they were not repaired or weakened here.

## Final team-review corrective pass

The implementation was returned after the team identified that the first
delivery protected the visible row more completely than several downstream
consumers. The final corrective pass closes those gaps:

- Missing entry economics now suppress valuation, Remaining Opportunity,
  health-derived entry calculations, marketable P/L inputs, and all
  entry-dependent objective triggers. The numeric `creditReceived = 0`
  compatibility value is never treated as economic evidence by this path.
- Position prompts and follow-up chat state entry credit, target, effective
  basis, and max risk as unavailable when broker entry premiums are
  incomplete; they no longer print plausible `$0.00` economics.
- The Position card no longer invokes the legacy recommendation engine when
  canonical state is absent. It fails closed as `Recommendation Unavailable`.
- Every visible position-AI field is projected from the canonical
  recommendation. Model-authored action, confidence, risk/catalyst, and rule
  deviation prose cannot contradict the canonical action.
- Broker-shaped five-lot Greek evidence is aggregated in one production
  helper and tested through the same helper before the standard contract
  multiplier is applied exactly once for display.
- Delta is labeled as share-equivalent exposure, not a percentage.
- Today’s Priorities, Priority List, and the Position row all pass the
  pre-refresh oldest-leg broker timestamp into the shared refresh action, so
  unchanged after-hours timestamps receive the same explanation everywhere.

Additional regression coverage proves canonical fail-closed presentation,
canonical AI projection, broker-shaped Greek aggregation, and that incomplete
entry economics cannot produce valuation, Remaining Opportunity, Place GTC,
Take Profit, or Cut Losses from the compatibility zero.

Final corrective-pass validation: TypeScript passed; four focused files / 100
tests passed; `git diff --check` passed. The earlier full-suite baseline
exception remains exactly as documented above and was not reclassified as a
green monolithic suite.
