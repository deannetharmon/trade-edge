# WA-0004 — Briefing Separation: Implementation Report

**Status:** Implemented, tested, validated. Sprint not closed in `planning/SPRINT_STATUS.md` (see note at end).
**Branch:** `feature/wa-0004-briefing-separation`, based on `main` @ `8e352c49d2eacc2433d538b242be06fe6a60bf24`.
**Author:** Dane (Lead Engineer)
**Authority:** `docs/design/WA-0004-Briefing-Separation-CES.md` (frozen, approved). This report records what was actually built against that spec; no product decision in the CES was reinterpreted, expanded, or renegotiated.

## 0. Note on starting state and this corrective round

The working tree already contained a substantially complete implementation of this CES when the prior session began (Briefing's new composition, the tracking-status contract, Mission Control's reduction, and most of the required test coverage were already present, uncommitted, on this branch). That session's report (this file, prior revision) claimed the implementation was fully acceptance-ready. An acceptance review found two binding defects in that claim, corrected in this round:

1. **Briefing rendered blank (`return null`) instead of an honest empty state** when `dailyBriefing === null && loading === false` — a silent, unlabeled blank workspace, violating CES §14's "never present unavailable data as a confident current-state conclusion, and never silently show nothing" requirement, and the report's prior wording ("renders nothing... a valid, documented empty state") incorrectly treated that blank render as acceptable.
2. **`DailyPortfolioBriefing.trackingActive.test.tsx`'s "tracking active, changes exist" test never actually exercised that branch.** It mocked `TRADER_COMMITMENT_TRACKING_ACTIVE` as `true` and built a `TraderCommitment` fixture, but never wired a matching `RevalidationResult` into `conductReview()`'s return value — the component builds its own `conductReview()` input internally with a hardcoded `revalidationResults: []`, so the test's assertions were on the zero-changes copy the whole time, despite its filename and prose describing it as the changes-present case. The prior report's §9/§12 language calling this a "disclosed, honest gap" and "not a defect" was itself incorrect — it was a coverage gap being reported as though it were an accepted limitation.

Both are fixed in this round; see §1a/§1b below for what changed, and §9 for the corrected coverage description. No canonical engine was touched to fix either defect.

## 1. Implementation Summary

Briefing (`features/portfolio/briefing/DailyPortfolioBriefing.tsx`) is the single canonical composition described in CES §12: Portfolio Health (canonical score via `buildDailyBriefing()`'s snapshot), Executive Summary, Portfolio Snapshot, Since Your Last Review (gated on the shared tracking-status flag), Upcoming Events, Contextual Risks, and Suggested Focus — in that exact order. It computes nothing itself; every section is a direct render of an already-computed typed output (`buildDailyBriefing()`, `ReviewNarrative.sinceLastReview`, `deriveSuggestedFocus()`).

The legacy Priority List embed (`TodaysPrioritiesWorkflow`) and both bespoke derivations (`derivePortfolioHealth()`, `computeWhatChanged()`) are gone from Briefing and from every other production rendering path. The transitional `DailyBriefingCard`/`variant="transitional"` call site is removed from Positions, closing WA-0002's binding obligation. `'briefing'` is a recognized `?tab=` deep-link value. Mission Control's "Since Your Last Review" is reduced to a lead/count/summary/deep-link summary, sourced from the same `ReviewNarrative.sinceLastReview` and the same `TRADER_COMMITMENT_TRACKING_ACTIVE` flag Briefing uses, with a deep link that is always the absolute path `/portfolio?tab=briefing`.

### 1a. Corrective fix — honest empty-briefing state (defect 1)

`dailyBriefing` composes to `null` in exactly one real case, traced to `lib/portfolio-intelligence/dashboardComposition.ts:265-280`: `portfolioReview` (and therefore `dailyBriefing`) is `null` exactly when `positions.length === 0 && pendingOrders.length === 0 && !canonicalPriorities` — i.e. there is no portfolio data or open positions to summarize yet, never a signal about portfolio health, changes, or risk.

`DailyPortfolioBriefing.tsx`'s `dailyBriefing === null && !loading` branch (previously `return null`) now renders, inside the same `aria-label="Daily Portfolio Briefing"` landmark used by every other state:

```
No briefing available right now.
There is no portfolio data or open positions to summarize.
```

This wording states only that there is no briefing and why (no portfolio data / no positions) — it fabricates no Snapshot/health/event/change data, and does not imply health is good, that nothing changed, or that no risks exist. The loading state (`role="status"`, `"Loading Today's Briefing…"`) is unchanged and remains a distinct branch reached only when `loading === true`.

Asserted in:
- `features/portfolio/briefing/__tests__/DailyPortfolioBriefing.test.tsx` — one test confirms the landmark plus both empty-state sentences render; a second confirms the empty state never renders `"Nothing changed since your last review."`, `"Healthy"`, an active-risks empty-state string, or a `role="status"` element.
- `app/portfolio/__tests__/PortfolioPage.test.tsx` — the `?tab=briefing` deep-link test (zero-position fixture, so `dailyBriefing` is `null`) now asserts the Briefing landmark renders with both empty-state sentences, in addition to its existing assertions that Positions' and Today's Priorities' content do not render on that tab. The comment previously describing "DailyPortfolioBriefing renders nothing of its own" as sufficient proof of tab-switching was rewritten — it no longer frames a blank render as acceptable.

### 1b. Corrective fix — genuine tracking-active-with-changes coverage (defect 2)

`features/portfolio/briefing/__tests__/DailyPortfolioBriefing.trackingActive.test.tsx` is now scoped to exactly one state: tracking active, genuine zero changes (unchanged behavior from before, still mocks only `TRADER_COMMITMENT_TRACKING_ACTIVE: true` via `vi.importActual` + override, real `conductReview()`, real hardcoded `revalidationResults: []`). Its previous "changes exist" test — which built an unused `TraderCommitment` fixture and then asserted the zero-changes copy — is removed, along with the "disclosed, honest gap" comment describing that as acceptable.

A new file, `features/portfolio/briefing/__tests__/DailyPortfolioBriefing.trackingActiveChanges.test.tsx`, covers the changes-present branch for real: it mocks `@/lib/review-conductor` to set `TRADER_COMMITMENT_TRACKING_ACTIVE: true` **and** replaces `conductReview` with `vi.fn(() => narrativeWithChanges())`, where `narrativeWithChanges()` returns a fully-typed `ReviewNarrative` (`lib/review-conductor/types.ts`) whose `sinceLastReview.changes` contains one `RevalidationResult` (`lib/revalidation/types.ts`) with `changed: true` and a populated `change: { whatChanged, whyItMatters, whyNow }`, built around a real `TraderCommitment` from `createTraderCommitment()` (`lib/trader-commitments`, test-fixture-only — no persistence added anywhere).

Split into its own file (rather than added to the existing one) because `vi.mock` factories are hoisted per-file and apply to every test in that file; giving `conductReview()` two different return values across tests in one file would require `vi.resetModules()` + dynamic `import()` per test, which was judged more fragile than a second small file for one clearly-scoped case.

The test asserts, within the `"Since Your Last Review"` `aria-label` section, that all four fields genuinely render:
- the commitment subject's label (`"MSFT BPS"`)
- `whatChanged` (`"MSFT BPS reached 21 DTE, its committed management window."`)
- `whyItMatters` (`"This position was held specifically until this DTE threshold; the condition that ends the commitment has now occurred."`)
- `whyNow` (`"Waiting past today risks losing the remaining extrinsic value the commitment was written to capture."`)

and that neither `"Nothing changed since your last review."` nor `"Change tracking is not yet active."` renders in this state.

`whyNow` was checked against the component's actual JSX (`DailyPortfolioBriefing.tsx`, the `changes.map(...)` block) and was **already rendered** — `<p>{result.change.whyNow}</p>` was present in the prior implementation, so no production content gap existed here; the only gap was the missing test proving it. No production presentation seam was added — the existing per-change markup (subject label / `whatChanged` / `whyItMatters` / `whyNow`) is exercised as-is.

No Trader Commitment persistence was implemented; both test files remain fixture-only per CES §19.

## 2. Files Changed

### Created
- `lib/review-conductor/trackingStatus.ts` — exports `TRADER_COMMITMENT_TRACKING_ACTIVE: boolean = false`. Does not modify `conductReview.ts`.
- `features/portfolio/briefing/__tests__/DailyPortfolioBriefing.trackingActive.test.tsx` — tracking active, genuine zero changes (one test; the prior file's incorrectly-passing "changes exist" test is removed, see §1b).
- `features/portfolio/briefing/__tests__/DailyPortfolioBriefing.trackingActiveChanges.test.tsx` — **new this corrective round.** Tracking active, changes present, genuinely exercised (see §1b).
- `docs/implementation/WA-0004-Briefing-Separation-Implementation-Report.md` — this report.

### Modified
- `features/portfolio/briefing/DailyPortfolioBriefing.tsx` — rewritten per §12/§16, plus this round's empty-state fix (§1a). New props: `dailyBriefing`, `portfolioReview`, `todaysPrioritiesDashboard` (in addition to existing `objectives`, `loading`, `th`). Calls `conductReview()` internally (the first `/portfolio` call site, mirroring `buildMissionControlViewModel.ts`'s exact pattern — same hardcoded `revalidationResults: []`).
- `features/portfolio/briefing/__tests__/DailyPortfolioBriefing.test.tsx` — updated per §1a (empty-state coverage) and to describe the two companion tracking-active files accurately.
- `app/portfolio/__tests__/PortfolioPage.test.tsx` — `?tab=briefing` test extended per §1a; stale "renders nothing" framing removed from its comments.
- `app/portfolio/page.tsx` — (a) `'briefing'` added to the `tab` allow-list; (b) `DailyPortfolioBriefing` call site now passes `dailyBriefing`/`portfolioReview`/`todaysPrioritiesDashboard` (already-composed state, no new fetch); (c) the transitional `DailyBriefingCard` import and its Positions call site removed entirely; (d) `PositionCompositionCard`/`HealthyMonitoringSection` call sites unchanged.
- `lib/mission-control/types.ts` — new `MissionControlSinceLastReviewSummary` interface (`trackingActive`, `leadText`, `count`, `summary`, `deepLink`); `MissionControlViewModel.sinceLastReview` field added (always populated, mirrors `todaysPriorities`'s convention).
- `lib/mission-control/buildMissionControlViewModel.ts` — `BRIEFING_DEEP_LINK = '/portfolio?tab=briefing'` (built once); `buildSinceLastReviewSummary()` builds the three-state summary from `TRADER_COMMITMENT_TRACKING_ACTIVE` + `narrative.sinceLastReview.changes`; every return path (`unavailable`, `error`, `loaded`) populates `sinceLastReview`.
- `lib/mission-control/index.ts` — exports `MissionControlSinceLastReviewSummary`.
- `lib/review-conductor/index.ts` — re-exports `TRADER_COMMITMENT_TRACKING_ACTIVE` from `trackingStatus.ts`.
- `components/mission-control/SinceLastReviewSection.tsx` — reduced to lead text / count (only when `> 0`) / deep link; renders `viewModel.sinceLastReview` verbatim, computes nothing.
- `components/mission-control/SummaryStrip.tsx` — its local `sinceLastReviewSummary()` helper (which read `narrative.counts.changes === 0` directly) is deleted; now renders `sinceLastReview.summary`, the shared, pre-built value.
- `components/mission-control/MissionControl.tsx` — passes `sinceLastReview` through to both `SummaryStrip` and `SinceLastReviewSection`.
- `lib/mission-control/__tests__/buildMissionControlViewModel.test.ts`, `components/mission-control/__tests__/MissionControl.test.tsx` — unchanged this round (no Mission Control production file touched by either defect fix).

### Deleted
- `features/portfolio/briefing/portfolioHealth.ts` (bespoke `derivePortfolioHealth()`) + `__tests__/portfolioHealth.test.tsx`
- `features/portfolio/briefing/whatChanged.ts` (bespoke `computeWhatChanged()`) + `__tests__/whatChanged.test.tsx`
- `features/portfolio/briefing/portfolioSummary.ts` (`derivePortfolioSummary()`) + `__tests__/portfolioSummary.test.tsx`
- `features/portfolio/dailyBriefing/DailyBriefingCard.tsx` + `__tests__/DailyBriefingCard.test.tsx`

### Deletion evidence
Unchanged from the prior round — for each deleted file, confirmed via repo-wide grep (excluding `node_modules`) that no import or reference to the deleted symbol remains in any `.ts`/`.tsx` file, production or test. Only comment-text and documentation matches remain. This satisfies CES §20's deletion criteria.

## 3. Source-of-Truth Decisions (mirrors CES §7)

Unchanged from the prior round. No canonical engine (`lib/portfolioHealth`, `lib/dailyBriefing`, `lib/revalidation`, `lib/trader-commitments`, `lib/review-conductor/conductReview.ts`, `lib/portfolio-intelligence`, `lib/priorityScore`, `lib/todaysPriorities/dashboard.ts`, `lib/decision-review`, `lib/morning-briefing/attentionFeed.ts`, `lib/todays-priorities-queue`) has an executable-line change in this corrective round either — confirmed via `git diff --stat` (§10); none of those paths appear in the diff.

## 4. Content Movement (mirrors CES §6)

Unchanged from the prior round; see that table (not reproduced here — no content-movement decision changed in this corrective round).

## 5. `DailyBriefingCard.tsx` Disposition

Unchanged from the prior round — retired entirely, not repurposed. Not touched by either defect fix.

## 6. Tracking-Status Contract Implementation

Unchanged from the prior round. `lib/review-conductor/trackingStatus.ts` exports the single constant `TRADER_COMMITMENT_TRACKING_ACTIVE: boolean = false`, re-exported from `lib/review-conductor/index.ts`. Both consumers import it from `@/lib/review-conductor`. This corrective round adds no new production consumer of this constant — it adds test coverage that genuinely exercises the changes-present branch behind it (§1b).

## 7. Mission Control's Final Contract

Unchanged from the prior round — not touched by either defect fix. See §2's "Modified" list: no Mission Control production file appears in this round's diff.

## 8. Deep-Link Behavior

Unchanged from the prior round.

## 9. Test Coverage Summary (corrected)

- `features/portfolio/briefing/__tests__/DailyPortfolioBriefing.test.tsx` (15 tests, +2 this round) — section order, canonical health, Executive Summary/Snapshot/Upcoming Events fields, contextual risks (including a risk that's also queue-eligible, still rendered as context with no button), tracking-unavailable state, legacy Priority List removal, shared `TRADER_COMMITMENT_TRACKING_ACTIVE` import parity, loading state, **and the honest empty-briefing state (2 new tests, §1a).**
- `features/portfolio/briefing/__tests__/DailyPortfolioBriefing.trackingActive.test.tsx` (1 test) — tracking active, genuine zero changes. **The prior "changes exist" test is removed from this file** — it never exercised that branch (§1b); replaced by the new file below.
- `features/portfolio/briefing/__tests__/DailyPortfolioBriefing.trackingActiveChanges.test.tsx` (1 test, **new this round**) — tracking active, changes present, **genuinely exercised**: `conductReview()` itself is mocked to return a populated `sinceLastReview.changes` array; the test asserts the commitment subject's label, `whatChanged`, `whyItMatters`, and `whyNow` all render inside the `"Since Your Last Review"` section, and that neither the zero-changes nor the tracking-unavailable copy renders. **This is now required, covered test behavior — not a disclosed or deferred gap; the prior report's "disclosed, honest gap (not a defect)" framing for this case was incorrect and has been removed.**
- `app/portfolio/__tests__/PortfolioPage.test.tsx` (5 tests) — `?tab=briefing` opens Briefing directly (Positions'/Today's Priorities' content absent) and **now also asserts the Briefing landmark's honest empty-state copy renders (§1a)**, rather than merely absence of other tabs' content.
- `lib/mission-control/__tests__/buildMissionControlViewModel.test.ts` (18 tests), `components/mission-control/__tests__/MissionControl.test.tsx` (18 tests) — unchanged this round, re-run and green (neither defect touched Mission Control production code).
- Regression: WA-0003's queue/workflow suites, Positions suites, `lib/portfolio-intelligence`, `lib/dailyBriefing`, `lib/review-conductor` (`conductReview.test.ts`) all re-run green, unmodified.

## 10. Validation Results (this corrective round)

**Targeted tests (files touched or newly added):**
- `features/portfolio/briefing/__tests__/DailyPortfolioBriefing.test.tsx`, `.trackingActive.test.tsx`, `.trackingActiveChanges.test.tsx`, `suggestedFocus.test.tsx` — 4 files, 20 tests, all passed.
- `app/portfolio/__tests__/PortfolioPage.test.tsx` — 1 file, 5 tests, all passed.

**Full re-run, batched by directory (sandbox's ~45s-per-call limit required batching; a full re-run was warranted since only Briefing-area files/tests changed but the prior round's full-suite result needed reconfirming after these edits):**
- `features/portfolio/briefing` — 4 files, 20 tests, passed.
- `features/portfolio/positions`, `features/portfolio/dailyBriefing` — 3 files, 20 tests, passed (`dailyBriefing` directory now contains no test files, `DailyBriefingCard` having been deleted in the prior round).
- `features/portfolio/todaysPriorities`, `features/portfolio/priorities`, `features/portfolio/components` — 4 files, 73 tests, passed.
- `lib/review-conductor`, `lib/portfolio-intelligence`, `lib/dailyBriefing` — 16 files, 228 tests, passed.
- `lib/mission-control`, `components/mission-control` — 2 files, 36 tests, passed (unchanged production, re-run for safety since this report corrects claims about the whole sprint).

**TypeScript:** `npx tsc --noEmit -p tsconfig.json` — clean, zero errors, exit code 0.

**Production build:** `npx next build` — **did not complete within the sandbox's ~45-second single-call cap.** The command was terminated by the sandbox's own timeout after printing only `Creating an optimized production build ...`; no compilation result (success or failure) was observed. This is the same accepted, pre-existing sandbox limitation the prior round hit, restated plainly here rather than characterized as "passed" — it was not run to completion in either round. `tsc --noEmit` (a full type-check across the same source tree) is clean.

**`git diff --check`:** clean, no whitespace errors, exit code 0.

**`git status --short`** (re-derived this round, not estimated):
```
 M app/portfolio/__tests__/PortfolioPage.test.tsx
 M app/portfolio/page.tsx
 M components/mission-control/MissionControl.tsx
 M components/mission-control/SinceLastReviewSection.tsx
 M components/mission-control/SummaryStrip.tsx
 M components/mission-control/__tests__/MissionControl.test.tsx
 M features/portfolio/briefing/DailyPortfolioBriefing.tsx
 M features/portfolio/briefing/__tests__/DailyPortfolioBriefing.test.tsx
 D features/portfolio/briefing/__tests__/portfolioHealth.test.tsx
 D features/portfolio/briefing/__tests__/portfolioSummary.test.tsx
 D features/portfolio/briefing/__tests__/whatChanged.test.tsx
 D features/portfolio/briefing/portfolioHealth.ts
 D features/portfolio/briefing/portfolioSummary.ts
 D features/portfolio/briefing/whatChanged.ts
 D features/portfolio/dailyBriefing/DailyBriefingCard.tsx
 D features/portfolio/dailyBriefing/__tests__/DailyBriefingCard.test.tsx
 M lib/mission-control/__tests__/buildMissionControlViewModel.test.ts
 M lib/mission-control/buildMissionControlViewModel.ts
 M lib/mission-control/index.ts
 M lib/mission-control/types.ts
 M lib/review-conductor/index.ts
 M tsconfig.tsbuildinfo
?? docs/implementation/WA-0004-Briefing-Separation-Implementation-Report.md
?? features/portfolio/briefing/__tests__/DailyPortfolioBriefing.trackingActive.test.tsx
?? features/portfolio/briefing/__tests__/DailyPortfolioBriefing.trackingActiveChanges.test.tsx
?? lib/review-conductor/trackingStatus.ts
```

**`git diff --stat`** (re-derived this round; covers tracked-file changes only, `git diff --stat` does not include untracked files):
```
 22 files changed, 865 insertions(+), 1119 deletions(-)
```

### 10a. File-count reconciliation (per this correction's explicit requirement)

Before any additional corrective test file, this branch's diff comprised **24 intended WA-0004 file paths** (21 tracked `M`/`D` entries + 3 untracked new files: this report, `DailyPortfolioBriefing.trackingActive.test.tsx`, `lib/review-conductor/trackingStatus.ts`), plus `tsconfig.tsbuildinfo` — an unstaged, generated TypeScript incremental-build cache artifact correctly excluded from that count and from any staging recommendation (it carries no source change; it is a side effect of running `tsc --noEmit`).

After this correction round, the diff comprises **25 intended WA-0004 file paths** (22 tracked `M`/`D` entries + 4 untracked new files — the same three as before, plus the new `DailyPortfolioBriefing.trackingActiveChanges.test.tsx`), again plus `tsconfig.tsbuildinfo` (unchanged disposition, still excluded). `git diff --stat`'s tracked-file total is **22 files changed, 865 insertions(+), 1,119 deletions(-)** (net removal, still a duplication-reconciliation sprint on net, even after this round's additions).

## 11. Environment Limitations

- `npx next build` did not complete inside the sandbox's ~45-second single-call cap, in either this round or the prior one. This is a known, accepted, pre-existing sandbox limitation, not evidence of a build defect — but it is also not a "passed" result, and this report does not characterize it as one. `tsc --noEmit` is clean.
- No other environment limitations encountered.

## 12. Deferred / Future-Consideration Items (noticed, not acted on)

- **`derivePortfolioSummary()`'s income-concern narrative line has no direct successor field in `buildDailyBriefing()`'s output** (§5, unchanged from prior round). Not a regression.
- **`tsconfig.tsbuildinfo`** changed as a build-cache side effect of `tsc` runs in both rounds. Recommend the human operator either exclude it from the commit or confirm it's already gitignored-but-tracked intentionally; not touched further here.
- **`components/command-center/PriorityListCard.tsx`'s dependency on `TodaysPrioritiesDashboard.tsx`'s `PriorityRankedList`** (WA-0003's own disclosed, unscoped gap) — untouched, unrelated to Briefing.
- **Trader Commitment persistence** — explicitly out of scope (CES §19); `TRADER_COMMITMENT_TRACKING_ACTIVE` remains `false` and `revalidationResults: []` remains hardcoded at both call sites. This corrective round's new test (`DailyPortfolioBriefing.trackingActiveChanges.test.tsx`) proves the changes-present rendering branch is correct using fixtures only, consistent with this non-goal — it does not wire any real persistence.

## 13. Confirmations

- **WA-0005 (Opportunities/Screener):** not begun, reconfirmed this round. No file under `lib/opportunity-engine`, `/screener`, or `NewOpportunitiesSection.tsx` appears in this diff. `buildDailyBriefing().opportunities` is not rendered anywhere in Briefing's composition.
- **WA-0006 (Priority List retirement):** not begun, reconfirmed this round. `features/portfolio/components/TodaysPriorities.tsx`, `TodaysPrioritiesWorkflow.tsx`, `features/portfolio/priorities/priorityWorkflowState.ts`, and the `priorities` tab are all unmodified (confirmed via `git status --short` — none appear in the diff) and their test suites pass unmodified (§10).
- **`planning/SPRINT_STATUS.md`:** not touched, this round or the prior one.

## 14. Files to Stage and Commit (for the human operator — not run in this session; no commit authorization is implied by this list)

```
git add \
  app/portfolio/__tests__/PortfolioPage.test.tsx \
  app/portfolio/page.tsx \
  components/mission-control/MissionControl.tsx \
  components/mission-control/SinceLastReviewSection.tsx \
  components/mission-control/SummaryStrip.tsx \
  components/mission-control/__tests__/MissionControl.test.tsx \
  features/portfolio/briefing/DailyPortfolioBriefing.tsx \
  features/portfolio/briefing/__tests__/DailyPortfolioBriefing.test.tsx \
  features/portfolio/briefing/__tests__/DailyPortfolioBriefing.trackingActive.test.tsx \
  features/portfolio/briefing/__tests__/DailyPortfolioBriefing.trackingActiveChanges.test.tsx \
  features/portfolio/briefing/__tests__/portfolioHealth.test.tsx \
  features/portfolio/briefing/__tests__/portfolioSummary.test.tsx \
  features/portfolio/briefing/__tests__/whatChanged.test.tsx \
  features/portfolio/briefing/portfolioHealth.ts \
  features/portfolio/briefing/portfolioSummary.ts \
  features/portfolio/briefing/whatChanged.ts \
  features/portfolio/dailyBriefing/DailyBriefingCard.tsx \
  features/portfolio/dailyBriefing/__tests__/DailyBriefingCard.test.tsx \
  lib/mission-control/__tests__/buildMissionControlViewModel.test.ts \
  lib/mission-control/buildMissionControlViewModel.ts \
  lib/mission-control/index.ts \
  lib/mission-control/types.ts \
  lib/review-conductor/index.ts \
  lib/review-conductor/trackingStatus.ts \
  docs/implementation/WA-0004-Briefing-Separation-Implementation-Report.md
```

(`tsconfig.tsbuildinfo` deliberately excluded — build-cache artifact, no source change; stage it separately only if the repo's convention is to track it. This list is informational only; staging and committing remain the human operator's decision.)
