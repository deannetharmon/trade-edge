# PI-0014C — Portfolio Pricing-Conflict Safety and Recommendation Grounding

## Status

Implemented locally on `reconcile/wa-0006-canonical-recommendation`. Not pushed or merged.

## Incident reproduced

The MU 800/790 five-lot BPS fixture reconciles to:

- Credit received: $1,260
- Midpoint buyback: $1,600
- Midpoint P/L: -$340 (-26.98% of credit)
- Marketable buyback: $3,650
- Marketable P/L: -$2,390 (-189.68% of credit)
- Max risk: $3,740
- Mid/marketable gap: $2,050 (54.81% of max risk)
- Observational liquidity tier: `LIQUIDITY_TRAP`

Before PI-0014C, marketable P/L independently satisfied the -100% material-loss rule and produced a hard `Cut Losses` recommendation while the explanation displayed the non-breaching midpoint percentage. The fixed numeric confidence value `91` was also presented as though it were measured confidence.

## Final policy

Marketable evidence may promote or veto an action only when all of these are true:

1. Every leg has a real two-sided, non-crossed market.
2. Existing quote-width classification is `RELIABLE`.
3. A real broker-supplied quote timestamp exists.
4. The oldest leg quote is no more than 120 seconds old.

Missing timestamps are `UNKNOWN`; page-load time is never substituted. A materially future timestamp is also `UNKNOWN`.

If marketable evidence changes an action-material threshold but is not eligible, the canonical result is `VERIFY_PRICING`. The compatibility recommendation is `watch`/`MANAGE`, labeled **Verify Pricing**, with high urgency. It cannot independently produce `CUT_LOSSES`, `CLOSE`, or veto a midpoint profit target.

Midpoint evidence that independently breaches policy remains effective. A fresh, reliable marketable breach may still promote the recommendation, and the explanation then names the marketable basis plus both P/L percentages.

## Canonical evidence contract

`PortfolioPricingDecisionEvidence` carries:

- midpoint and marketable P/L percentages
- quote quality
- quote freshness
- actual broker quote timestamp
- marketable decision eligibility
- controlling basis (`MID`, `MARKETABLE`, or `NONE`)
- decision status (`MID_ONLY`, `PRICING_AGREEMENT`, `MARKETABLE_OBSERVATIONAL`, `MARKETABLE_CONFIRMED`, or `VERIFY_PRICING`)

The contract is attached to each enriched Portfolio position and passed to Portfolio AI prompts. A deterministic post-model guard forces `MANAGE` when the status is `VERIFY_PRICING`, so prompt noncompliance cannot turn an untrusted pricing conflict into a directional hard action.

## Confidence presentation

The internal numeric recommendation field remains available for existing ranking and compatibility consumers. The Portfolio recommendation badge and Position Intelligence action card no longer display fixed rule constants as percentage confidence. They show urgency and rule strength instead. AI confidence remains explicitly categorical and separate.

## Safety boundaries preserved

- TE-0002 stop provenance and confirmation behavior was not weakened.
- ES-0001 close-order identity and execution safety gates were not changed.
- `PortfolioObjective.metadata.executionAllowed` and `paperExecutionAllowed` remain false, including for `VERIFY_PRICING`.
- A trader's manually available Cut Losses button remains based on real midpoint loss as previously approved; this ticket changes recommendation authority, not manual control.
- RSI, Bollinger Bands, trend enrichment, and broader technical-context work remain a separate backlog item.

## Files changed by PI-0014C

- `lib/portfolio-intelligence/objectives/positionObjective.ts`
- `lib/portfolio-intelligence/index.ts`
- `lib/portfolio-data/types.ts`
- `lib/portfolio-data/acquisition.ts`
- `app/portfolio/page.tsx`
- `features/portfolio/components/PositionRecommendationBadge.tsx`
- `features/portfolio/intelligence/PositionIntelligencePanel.tsx`
- `lib/portfolio-intelligence/__tests__/pi0014MarketablePricingFixtures.test.ts`
- `lib/portfolio-data/__tests__/pricingDecisionWiring.test.ts`
- `features/portfolio/components/__tests__/PositionRecommendationBadge.test.tsx`
- `features/portfolio/intelligence/__tests__/PositionIntelligencePanel.test.tsx`

## Validation

Focused validation during implementation: 7 files / 121 tests passing. TypeScript was clean.

Final integrated validation results:

- Full suite: all PI-0014C/Portfolio files passed. Two existing Screener launcher files failed under the full parallel run; neither is touched by PI-0014C. A focused diagnostic rerun of those exact files passed 22/22, identifying the full-run failures as concurrency/resource-test flakiness rather than a PI-0014C regression. The full suite was not rerun a second time.
- `tsc --noEmit --incremental false`: clean.
- `git diff --check`: clean.
- Production build: not completed in this environment. The first attempt was blocked by sandbox write permission on `.next/trace`. The permitted retry began the optimized build but the process ended without a success marker or `.next/BUILD_ID`, consistent with the branch's previously documented build-resource limitation. No code/type error was emitted, but this is not reported as a successful build.

## Existing worktree isolation

The branch already contained uncommitted WA-0006 reconciliation changes in Screener, Autopilot, decision-engine, scans, paper-trading, fixtures, and two untracked canonical-recommendation files. PI-0014C did not edit those unrelated files. `tsconfig.tsbuildinfo` remains excluded from the intended commit.
