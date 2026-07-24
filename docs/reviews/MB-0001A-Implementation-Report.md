# MB-0001A — Morning Briefing Attention Feed
## Implementation Report

**Branch:** `feature/mb-0001a-attention-feed`
**Base:** `origin/feature/mb-0001a-attention-feed` @ `3b7a9a7` (verified starting HEAD, matched local exactly)
**Status:** Implemented, pending Quinn's architecture and QA review.

## 1. Repository and Branch Verification

Performed before any file was touched, per the handoff's required preflight:

```
git status --short          -> two pre-existing untracked scratch docs from
                                earlier, unrelated sprints (docs/architecture/
                                TradeEdge-Technical-Snapshot.md,
                                docs/reviews/OE-0002B-Review-Package-for-Quinn.md);
                                no tracked modifications.
git branch --show-current   -> feature/mb-0001a-attention-feed
git log --oneline -5        -> 3b7a9a7 docs(morning-briefing): add complete
                                Dane implementation handoff
                                fa88d89 docs(morning-briefing): define
                                MB-0001A attention feed CES
                                26bd9e2 Merge branch
                                'feature/oe-0002b-recommendation-service'
                                d678e1b refactor(oe-0002b): ...
                                0f3b8dd feat(oe-0002b): ...
git rev-parse HEAD                                          -> 3b7a9a7...
git rev-parse origin/feature/mb-0001a-attention-feed         -> 3b7a9a7... (identical)
```

Branch and commit matched exactly; the two untracked files are leftover scratch artifacts from prior sprints (never committed, carried across branches harmlessly in this sandbox all session), not tracked modifications, so they did not trigger the handoff's "working tree contains unrelated changes" stop condition. Both `docs/design/MB-0001A-Attention-Feed.md` and `docs/handoffs/MB-0001A-Dane-Implementation-Prompt.md` were present and read in full before any code was written.

## 2. Architecture Discovery Findings

Before writing `buildAttentionFeed()`, inspected the actual exported types and canonical fields, since the CES explicitly requires this:

- `lib/todaysPriorities/dashboard.ts` — confirmed `TodaysPrioritiesDashboard`'s exact bucket shapes and that every actionable bucket is already `PrioritizedObjective[]`, pre-sorted highest-score-first by `buildTodaysPrioritiesDashboard()`'s own `rank()` helper. This means `immediate`/`watch` (this module's flattened, non-globally-sorted arrays) inherit a sensible per-bucket order for free; only the new cross-bucket `orderedActionable` needed a new comparator.
- `lib/todaysPriorities/explanation.ts` — confirmed `buildRecommendationExplanation(item: PrioritizedObjective): RecommendationExplanation` and its exact output shape (`drivers`, `whyNow`, `confidence: { score, label }`). **Not exported from `lib/todaysPriorities/index.ts`** at the start of this sprint — see §3's one permitted deviation.
- `lib/portfolio-intelligence/types.ts` — confirmed `PortfolioObjective` has no trading-strategy field (`BPS`/`CSP`/etc.); only `TodaysPrioritiesPositionInput`/`TodaysPrioritiesMonitorEntry` carry `strategy`, and only the latter reaches this module's input. This directly decided `AttentionItem.strategy: null` for all `IMMEDIATE`/`WATCH` items (honest, not fabricated) versus `entry.strategy` for `HEALTHY` items.
- `features/portfolio/components/TodaysPriorities.tsx` (PI-0004A) — this file carries its own documented field-mapping comment block ("Priority title -> objective.title", "[expanded] Recommendation -> objective.rationale"), which is the existing precedent this implementation reused verbatim for `headline` (`objective.title`) and `recommendedAction` (`objective.rationale`), per the handoff's explicit instruction to derive these two fields from canonical objective fields already used by Today's Priorities rather than inventing new ones.
- `features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx`'s `MonitorRow` — confirmed Monitor rows display only `symbol`/`strategy`/`dte`/`healthScore`, with no existing recommendation text for Monitor entries anywhere in the codebase. This is why `HEALTHY` items' `recommendedAction` uses a fixed, honest constant ("No action required today.") restating `dashboard.ts`'s own documented Monitor semantic, rather than any invented market judgment.

## 3. One Permitted Deviation: `lib/todaysPriorities/index.ts`

The CES/handoff permit modifying this file "only when genuinely required for a clean public import." `buildRecommendationExplanation` and `RecommendationExplanation` (plus `RecommendationDriver`/`RecommendationConfidenceLabel`) were not exported from the package's public surface — only reachable via the deep path `lib/todaysPriorities/explanation`. Since the CES's declared allowed import is `lib/todaysPriorities` (not a deep path), a re-export was genuinely required. Added:

```ts
export { buildRecommendationExplanation } from './explanation';
export type { RecommendationExplanation, RecommendationDriver, RecommendationConfidenceLabel } from './explanation';
```

No behavior changed — pure re-export, no logic touched in `explanation.ts` or `dashboard.ts`.

## 4. Files Changed

| File | Type | Description |
|---|---|---|
| `lib/morning-briefing/types.ts` | Added | The CES's public contract (`AttentionBand`, `AttentionSource`, `AttentionExplanation`, `AttentionItem`, `AttentionFeed`, `BuildAttentionFeedInput`), copied verbatim from the design doc's section 4. |
| `lib/morning-briefing/attentionFeed.ts` | Added | `buildAttentionFeed()` — the pure composition implementation. |
| `lib/morning-briefing/index.ts` | Added | Public package interface, re-exporting `buildAttentionFeed` and the CES types. |
| `lib/morning-briefing/__tests__/attentionFeed.test.ts` | Added | 13 tests (see §6). |
| `lib/todaysPriorities/index.ts` | Modified | Added the one permitted re-export described in §3. |
| `docs/reviews/MB-0001A-Implementation-Report.md` | Added | This report. |

No page, component, API route, broker client, evaluator, priority-score implementation, or recommendation-service file was touched.

## 5. Behavior Implemented

`buildAttentionFeed({ dashboard, generatedAt })`:

- Maps `dashboard.immediateAction` to `immediate` (band `IMMEDIATE`, source `IMMEDIATE_ACTION`).
- Maps `dashboard.reviewToday.{earningsReviews,expiringPositions,mediumPriority}` and `dashboard.opportunities.{rollOpportunities,cspOpportunities}` to `watch` (band `WATCH`), each tagged with its originating source. Consistent with `buildTodaysPrioritiesDashboard()`'s own already-tested behavior of letting one objective (e.g. a `DEPLOY_IDLE_CASH` objective) appear in more than one bucket, this module flattens honestly rather than deduplicating across sources — covered explicitly by its own test.
- Maps `dashboard.monitor` to `healthy` (band `HEALTHY`, source `MONITOR`), with `score`/`tier`/`explanation`/`objective` honestly `null` and `reasons: []` — never fabricated.
- Builds `orderedActionable` as `[...immediate, ...watch]` sorted by: higher `score` first; on a tie, source precedence (`IMMEDIATE_ACTION` > `EARNINGS_REVIEW` > `EXPIRING_POSITION` > `MEDIUM_PRIORITY` > `ROLL_OPPORTUNITY` > `CSP_OPPORTUNITY`); on a further tie, lexical `id` ascending. `HEALTHY` items never enter this list.
- Sets `topAttentionItem = orderedActionable[0] ?? null`.
- For every `IMMEDIATE`/`WATCH` item, calls the existing, unmodified `buildRecommendationExplanation()` and maps its output onto `AttentionExplanation` without recalculating confidence, rewriting triggers, or inferring new facts. `decisionDrivers: string[]` is a one-line flattening of each existing `RecommendationDriver` (`"label: value"` when a value exists, else just `label`) — the same label/value pairing `TodaysPrioritiesDashboard.tsx`'s own driver list already renders, just reduced to a single string per the CES's `string[]` contract.
- Performs no network request, reads no clock (uses only the caller-supplied `generatedAt`), mutates no input, persists nothing, and imports no React/browser/broker dependency.

## 6. Tests Added

`lib/morning-briefing/__tests__/attentionFeed.test.ts`, 13 tests, all passing:

1. Empty dashboard → empty arrays, zero counts, `topAttentionItem: null`.
2. A `CRITICAL`/`immediateAction` objective maps only to `IMMEDIATE`.
3. Earnings/expiring/medium/roll/CSP objectives map to `WATCH` with the correct `source` each.
4. The same objective surfacing under two sources (mirroring `buildTodaysPrioritiesDashboard`'s own tested `DEPLOY_IDLE_CASH` dual-bucket behavior) produces two honestly-flattened `WATCH` items, not a silently deduplicated one.
5. Monitor entries map to `HEALTHY` with `score`/`tier`/`explanation`/`objective` all `null` and `reasons: []`.
6. Higher score sorts first across different source buckets.
7. Equal-score source precedence is deterministic.
8. Equal-score/equal-source lexical-ID tie-break is deterministic (tested with reverse-lexical insertion order to prove it is not incidental array order).
9. `buildRecommendationExplanation()`'s output is attached unchanged in meaning (confidence label/score, `whyNow`, and the `decisionDrivers` flattening all checked against a direct call to the existing function).
10. `topAttentionItem` parity with the existing `selectTopPriority()` on a dashboard with distinct scores across every bucket both functions consider.
11. `needsFollowUp`, `coveredCallOpportunities`, and `screenerCandidatesAvailable` are explicitly excluded — a dashboard containing only these three non-empty produces a fully empty feed.
12. Input dashboard is not mutated (JSON-snapshot equality before/after).
13. Repeated calls with identical input produce deeply equal output.

## 7. Validation

```
npx tsc --noEmit
  -> clean, no errors

npx vitest run lib/morning-briefing lib/todaysPriorities lib/priorityScore \
  lib/portfolio-intelligence lib/dailyBriefing lib/command-center
  -> Test Files  22 passed (22)
     Tests  298 passed (298)
     (13 of these are the new attentionFeed.test.ts; the remaining 285 are
     every pre-existing test in the five directories the CES named, all
     unmodified and all still passing.)

git diff --check
  -> clean, no whitespace errors
```

**Full repository suite:** `npm test` (this repo's canonical `vitest run` script) was run to completion was attempted twice — once backgrounded, once foregrounded under a 42-second window. Both runs showed zero failing tests among every suite that had completed by the time the sandbox's per-command execution window was reached (well over 20 directories, including `lib/autopilot`, `lib/decision-review`, `lib/opportunity-engine`, `lib/paper-trading`, `lib/portfolioHealth`, `lib/portfolioReview`, `lib/tradeLog`, and the new `lib/morning-briefing` suite alongside them) — this sandbox simply cannot execute a single command long enough to capture this repository's full 1,000+-test run to completion, a known, pre-existing sandbox limitation documented identically in OE-0002A's and OE-0002B's own implementation reports, not a code failure. No test failure of any kind was observed in either attempt. Recommend Quinn or Paul run the full suite locally or in CI for a complete-to-100% regression confirmation before merge.

**Production build:** not run. This is a code/library-only change (no page, component, or build-relevant config touched); running a full Next.js production build was not attempted, and no claim is made about its outcome.

## 8. Deviations from the CES

Only one, already disclosed in the CES/handoff itself as permitted: the `lib/todaysPriorities/index.ts` re-export described in §3. No other file outside the CES's expected list was touched. No new scoring, actionability, severity, or explanation logic was introduced.

## 9. Unresolved Risks and Follow-Ups (for Quinn's awareness, non-blocking)

- **Narrow tie-break divergence from `selectTopPriority()`:** `orderedActionable`'s CES-specified source-precedence order (`IMMEDIATE_ACTION, EARNINGS_REVIEW, EXPIRING_POSITION, MEDIUM_PRIORITY, ROLL_OPPORTUNITY, CSP_OPPORTUNITY`) differs from `selectTopPriority()`'s own incidental first-wins iteration order (`immediateAction, mediumPriority, earningsReviews, expiringPositions, cspOpportunities, rollOpportunities`). The required parity test (§6, item 10) passes because it uses distinct scores across every bucket, which is the realistic case and the only scenario the CES's parity requirement describes. In the narrow theoretical case where two *different-bucket* heads tie for the exact same top score, the two functions could select a different objective as "top." `selectTopPriority()` was explicitly left untouched per the CES, so this was not treated as a defect to fix unilaterally — surfacing it here for Quinn's review rather than silently resolving it one way or the other.
- **Full-suite completion:** as noted in §7, the sandbox cannot run the complete 1,000+-test suite to completion in one command; a CI or local full run is recommended before merge as an additional confidence check, though no failure was observed in either partial run.
- **`decisionDrivers` string flattening:** the CES's `AttentionExplanation.decisionDrivers` is `string[]`, while the existing `RecommendationExplanation.drivers` is a richer `RecommendationDriver[]` (label/value/explanation/source). This implementation flattens each driver to one line (`"label: value"` or just `label`). If a future consumer needs the driver's `explanation` text as well, that would be a type-contract change requiring its own review — not implemented here since the CES's own contract specifies `string[]`.

## 10. Final Commit

See the commit this report is included in on `feature/mb-0001a-attention-feed`. Branch pushed; not merged to `main`; branch not deleted.
