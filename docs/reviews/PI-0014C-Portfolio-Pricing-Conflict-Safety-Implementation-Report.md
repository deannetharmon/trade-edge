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

If marketable evidence changes an action-material threshold but is not eligible, the canonical result is `VERIFY_PRICING`. The recommendation kind is `verify-pricing`; its canonical objective is `OBJ-VERIFY-PRICING` / `MANAGE_POSITION`, labeled **Verify Pricing**, with high urgency. It cannot independently produce `CUT_LOSSES`, `CLOSE`, or veto a midpoint profit target.

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

The contract is attached to each enriched Portfolio position and passed to Portfolio AI prompts. A deterministic post-model projector forces `MANAGE`/`LOW`, replaces summary and reasoning, clears risks and catalysts, and resets rule-deviation fields when status is `VERIFY_PRICING`. No model-authored visible analysis field survives that boundary.

## Confidence presentation

The internal numeric recommendation field remains available for existing ranking and compatibility consumers. The Portfolio recommendation badge and Position Intelligence action card no longer display fixed rule constants as percentage confidence. They show urgency and rule strength instead. AI confidence remains explicitly categorical and separate.

## Safety boundaries preserved

- TE-0002 stop provenance and confirmation behavior was not weakened.
- ES-0001 close-order identity and execution safety gates were not changed.
- `PortfolioObjective.metadata.executionAllowed` and `paperExecutionAllowed` remain false, including for `VERIFY_PRICING`.
- A trader's manually available Cut Losses button remains based on real midpoint loss as previously approved; this ticket changes recommendation authority, not manual control.
- RSI, Bollinger Bands, trend enrichment, and broader technical-context work remain a separate backlog item.

## Complete PI-0014C file inventory

- `lib/portfolio-intelligence/objectives/positionObjective.ts`
- `lib/portfolio-intelligence/index.ts`
- `lib/portfolio-data/types.ts`
- `lib/portfolio-data/acquisition.ts`
- `app/portfolio/page.tsx`
- `components/portfolio-data/PortfolioDataProvider.tsx`
- `components/portfolio-data/__tests__/PortfolioDataProvider.test.tsx`
- `features/portfolio/components/PositionRecommendationBadge.tsx`
- `features/portfolio/components/VerifyPricingRefreshButton.tsx`
- `features/portfolio/components/__tests__/VerifyPricingRefreshButton.test.tsx`
- `features/portfolio/components/TodaysPrioritiesWorkflow.tsx`
- `features/portfolio/components/__tests__/TodaysPrioritiesWorkflow.test.tsx`
- `features/portfolio/todaysPriorities/TodaysPrioritiesQueueView.tsx`
- `features/portfolio/todaysPriorities/__tests__/TodaysPrioritiesQueueView.test.tsx`
- `features/portfolio/intelligence/PositionIntelligencePanel.tsx`
- `lib/portfolio-intelligence/__tests__/pi0014MarketablePricingFixtures.test.ts`
- `lib/portfolio-intelligence/__tests__/positionObjective.test.ts`
- `lib/portfolio-data/__tests__/pricingDecisionWiring.test.ts`
- `features/portfolio/components/__tests__/PositionRecommendationBadge.test.tsx`
- `features/portfolio/intelligence/__tests__/PositionIntelligencePanel.test.tsx`
- `features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx`
- `features/portfolio/dashboard/__tests__/TodaysPrioritiesDashboard.test.tsx`
- `features/portfolio/intelligence/managementChoices.ts`
- `features/portfolio/intelligence/nextLifecycleEvent.ts`
- `lib/portfolio-intelligence/pricingVerification.ts`
- `lib/portfolio-intelligence/__tests__/pricingVerification.test.ts`
- `lib/portfolio-intelligence/policies/defaults.ts`
- `lib/portfolio-intelligence/policies/types.ts`
- `lib/portfolio-intelligence/ruleIds.ts`
- `lib/portfolio-intelligence/types.ts`
- `lib/todaysPriorities/explanation.ts`
- `lib/todaysPriorities/__tests__/explanation.test.ts`
- `lib/morning-briefing/types.ts`

## Validation

Focused validation during implementation: 7 files / 121 tests passing. TypeScript was clean.

Final integrated validation results:

- Full suite: all PI-0014C/Portfolio files passed. Two existing Screener launcher files failed under the full parallel run; neither is touched by PI-0014C. A focused diagnostic rerun of those exact files passed 22/22, identifying the full-run failures as concurrency/resource-test flakiness rather than a PI-0014C regression. The full suite was not rerun a second time.
- `tsc --noEmit --incremental false`: clean.
- `git diff --check`: clean.
- Production build: not completed in this environment. The first attempt was blocked by sandbox write permission on `.next/trace`. The permitted retry began the optimized build but the process ended without a success marker or `.next/BUILD_ID`, consistent with the branch's previously documented build-resource limitation. No code/type error was emitted, but this is not reported as a successful build.

## Existing worktree isolation

The branch already contained uncommitted WA-0006 reconciliation changes in Screener, Autopilot, decision-engine, scans, paper-trading, fixtures, and two untracked canonical-recommendation files. PI-0014C did not edit those unrelated files. `tsconfig.tsbuildinfo` remains excluded from the intended commit.

## Corrective approval pass

The team returned the first implementation for a focused corrective pass. The original results above are retained as historical facts and are not represented as final approval validation.

Corrections made:

- `VERIFY_PRICING` is now a first-class `PortfolioRecommendationKind` (`verify-pricing`) with stable rule ID `OBJ-VERIFY-PRICING`, `MANAGE_POSITION` objective type, a stable `fresh-executable-quote` trigger identifier whose user-facing label requests fresh broker leg quotes, pricing-specific impact text, management choices, and lifecycle text. It no longer masquerades downstream as the health-driven `OBJ-WATCH-POSITION` rule.
- The AI trust boundary now uses deterministic copy that accepts no model-authored summary or reasoning. When pricing verification is required, a hostile `CLOSE`/`ROLL`/`CUT LOSSES` model response cannot leak directional prose or high confidence into the visible result.
- Today's Priorities identifies this deterministic rule as `Rule Strength: Deterministic` and does not display the internal fixed value as a measured confidence percentage. Other recommendation types retain their existing confidence presentation.
- Quote age and future-skew tolerances now live in `DEFAULT_POSITION_MANAGEMENT_POLICY`; acquisition imports the canonical policy rather than defining a private magic number. The 120-second boundary is recommendation-only and is documented as allowing ordinary polling/network delay while still requiring a recent broker observation. It does not authorize order execution.
- Broker timestamp extraction and oldest-leg aggregation are exported acquisition helpers used by production. A realistic two-leg Tastytrade-shaped helper fixture proves `updated-at`/`received-at` parsing, symbol normalization, oldest-leg selection, and fail-closed behavior when any leg lacks provenance. This is helper-level coverage plus code inspection of `loadPositions()`, not an end-to-end mocked `ttFetch → Position → pricingDecisionEvidence` test.

New focused coverage includes canonical rule/trigger identity, hostile AI output, deterministic confidence presentation, real-shaped broker timestamp propagation, and the existing MU pricing-conflict regression.

Final clean-tree validation was performed by reproducing only the PI-0014C corrective diff in a detached worktree at base commit `6d3c328`; none of the unrelated WA-0006 working-tree changes were present:

- Focused corrective suite: 8 files / 70 tests passing.
- TypeScript: `npx tsc --noEmit --incremental false` clean.
- Full suite: 148 files / 2,085 tests passing under `TZ=UTC`.
- Production build: successful; compilation, type validation, page-data collection, and all 53 static pages completed.
- `git diff --check`: clean.

The first clean-tree full-suite run in the workstation's `America/Denver` timezone produced two unrelated CSP search failures whose fixtures expected 40 DTE but calculated 41. The exact CSP file passed 24/24 under UTC, and the entire suite was then rerun under UTC and passed 2,085/2,085. PI-0014C does not modify CSP search. This pre-existing timezone dependence is disclosed rather than attributed to PI-0014C. Build-time Redis connection-refused warnings were non-fatal in the isolated environment; the build completed successfully.

## Final completeness pass

Frank's second review found that the first corrective guard still allowed model-authored `risks`, `catalysts`, `deviatesFromRules`, and `deviationNote` to render. The final projector now accepts the parsed model object only to enforce the trust boundary and returns deterministic values for every visible analysis field. The adversarial test supplies directional content in every field and verifies that none survives.

Confidence provenance is now canonical in `buildRecommendationExplanation()`: `OBJ-VERIFY-PRICING` returns `{ provenance: 'RULE_CONSTANT', score: null, label: 'Deterministic' }`. Today's Priorities consumes that shared contract rather than locally inferring from the rule ID, and Morning Briefing receives a nullable score instead of converting the internal compatibility constant into measured “Moderate” confidence.

`derivePositionQuoteCapturedAt()` now returns `null` for an empty leg list rather than reducing an empty array. The helper-level scope of timestamp testing is stated accurately above.

Dean approved 120 seconds as the initial recommendation-only quote-freshness threshold on 2026-08-10. It remains a monitored policy default, not execution authority: a quote outside the boundary suppresses directional guidance and produces Verify Pricing.

Final validation was performed from an isolated clean worktree reproducing the complete PI-0014C diff on parent `088b73f`: focused validation passed 8 files / 71 tests, the full suite passed 148 files / 2,086 tests under `TZ=UTC`, TypeScript completed cleanly, `git diff --check` was clean, and the production build succeeded. The build emitted the previously disclosed Redis connection warnings but completed normally and generated the full route manifest.

## Product-owner continuation: one-shot quote refresh

Dean approved a direct Refresh Quotes action for Verify Pricing. The position card now renders that action only for the typed `verify-pricing` recommendation. Activating it invokes the existing canonical Portfolio Data Provider refresh once, which re-fetches broker positions and rebuilds recommendations from the returned evidence. The control disables and exposes `aria-busy` while the request is in flight, preventing duplicate clicks. There is no timer and no automatic retry loop. If the refreshed evidence remains stale, incomplete, or unreliable, the recomputed position remains Verify Pricing and the action remains available; if evidence becomes decision-eligible, the normal recommendation replaces it.

The team returned the first continuation because its busy state was local to one card, the provider resolved before recommendation recomputation, and provider errors were indistinguishable from success at the control. The corrected provider now uses a monotonic request generation: only the newest portfolio refresh may publish positions or clear shared loading, so an older broker response cannot overwrite newer evidence. It awaits snapshot-history attachment and canonical health/recommendation/objective recomputation before returning a typed `success`, `error`, or `superseded` result. If snapshot history is unavailable, it recomputes from fresh broker positions with an empty contextual store rather than publishing raw positions.

Every position-card and Today's Priorities Verify Pricing action now consumes the shared provider loading state. The clicked action announces four terminal outcomes: failure with pricing still unverified, refresh completed but pricing remains unverified, recommendation updated, or position no longer open. A fifth operational result, `superseded`, truthfully reports that a newer portfolio refresh replaced the initiating request; it is not itself a terminal pricing-verification conclusion. “Executable quote” has been removed from user-facing Verify Pricing copy: the evidence is described as fresh broker leg quotes and a derived marketable estimate, explicitly not a firm complex-order quote or guaranteed fill price. The stable historical trigger ID remains `fresh-executable-quote`; its visible label and explanation use the corrected terminology.

Corrective continuation focused validation passed 6 files / 50 tests; TypeScript and `git diff --check` were clean. The complete final diff was then reproduced on parent `99c07b1` in an isolated clean worktree. The first `TZ=UTC` full-suite run passed 2,092 tests and hit one timeout in the unrelated `ScreenerSessionWiring.test.tsx`; that exact file immediately passed 17/17 in isolation. One complete suite rerun then passed 150 files / 2,093 tests. The production build succeeded and generated the full route manifest. The unrelated Screener timing failure and non-fatal build-time Redis warnings are disclosed rather than hidden or attributed to PI-0014C.

## Final approval correction: persistent verification and primary queue action

The final team review identified that missing marketable evidence could remove an existing Verify Pricing recommendation: the conflict predicate required a non-null marketable P/L, so a refreshed one-sided or missing leg could fall back to `MID_ONLY`. Commit `7b85c41` initially addressed that gap with a provider-owned position latch, but the first version copied the entire prior recommendation/objective and could retain stale percentages, timestamps, rationale, and evidence. It could also mask a newly authoritative midpoint, assignment, earnings, or DTE action. That implementation is superseded by the final correction below and is not the approved architecture.

Refresh completion classification now inspects `pricingDecisionEvidence.marketableDecisionEligible` as well as recommendation kind. Incomplete evidence can never produce “Pricing verified.” A synchronous request ref blocks immediate same-control double clicks before React propagates shared loading.

The action is now present on all three intended Portfolio surfaces: Position cards, the legacy Priority List, and the primary Today's Priorities queue. Outcome announcements have moved to page-owned state above the tab content, so “still unverified,” failure, recommendation-updated, and position-closed messages survive removal of the initiating card or objective and remain dismissible/accessibly announced.

Provider regressions now cover supersession during broker loading, supersession while the older request is held in snapshot loading, snapshot-store failure with `{}` recomputation, typed failure, and the exact Verify Pricing → incomplete evidence → Verify Pricing latch followed by eligible-evidence release. The raw-position callback documentation now states its actual post-recomputation timing and conservative next-refresh snapshot semantics.

Final-approval focused validation: 7 files / 69 tests passing; TypeScript clean. The exact final diff was then reproduced on parent `bb3dad7` in an isolated clean worktree: `git diff --check` was clean, the first `TZ=UTC` full-suite run passed 150 files / 2,098 tests with no retry, and the production build succeeded with the full route manifest. Non-fatal Redis connection warnings remained the only build-time environmental noise.

## Final completion correction: canonical fresh-evidence verification continuity

Verification continuity now belongs to the canonical portfolio-intelligence evaluation, not to `PortfolioDataProvider`. The provider passes only position-keyed in-session provenance into `attachSnapshotHistory()`; `scorePortfolioPositionObjective()` supplies that provenance to `evaluatePositionObjective()`, which constructs a new recommendation and objective from the refreshed position and current pricing evidence. The provider no longer copies or overwrites a recommendation after canonical recomputation.

When a prior Verify Pricing disposition exists and current marketable evidence is still decision-ineligible, the evaluator creates a fresh Verify Pricing result only if no independent current action supersedes it. Midpoint-supported `close-loser`, assignment risk, earnings risk, and DTE/expiration-management actions remain authoritative. Fresh, reliable, decision-eligible marketable evidence releases the continuity state normally. A missing position is not evaluated and therefore naturally clears the state.

The refreshed Verify Pricing result contains current timestamps, current supporting evidence, and explicit unresolved-verification language. No prior percentage, timestamp, reason, trigger, objective, or liquidity flag is transplanted. Prior conflict figures are not displayed as current or historical because this implementation does not persist them.

This continuity is intentionally limited to the active `PortfolioDataProvider` session. A hard browser reload or provider remount discards the in-memory provenance. Cross-session durability remains a product decision and is not claimed by this ticket.

Final correction regression coverage proves: incomplete evidence produces a newly constructed Verify Pricing result; stale conflict figures do not survive; a midpoint material-loss action wins; assignment, earnings, and DTE actions are not masked; eligible marketable evidence releases the state; the provider delegates the transition into canonical recomputation; and a successful refresh omitting the position announces that it is no longer open.

Final completion validation was performed against the isolated detached worktree for code commit `823a66f`, with none of the unrelated WA-0006 working-tree changes present:

- Focused Portfolio/provider/portfolio-intelligence validation: 7 files / 134 tests passing.
- TypeScript: `npx tsc --noEmit --incremental false` clean.
- Full suite: 150 files / 2,105 tests passing under `TZ=UTC`. To avoid the sandbox's shared `node_modules/.vite` cache-write restriction and whole-suite memory pressure, the complete inventory ran in three non-overlapping accounting groups: `lib` reported 96 files / 1,638 tests (including four cross-root files), `app` reported 14 / 144, and `features components` reported 44 / 346; subtracting the four duplicated cross-root files / 23 tests reconciles exactly to 150 / 2,105.
- `git diff --check`: clean before commit.
- Production build: successful; compilation, type validation, page-data collection, all 53 static pages, and the full route manifest completed. The previously disclosed non-fatal Redis connection-refused warnings were the only build-time environmental noise.

The final report-only amendment does not alter the validated product or test code.
