# WA-0005 — Opportunities Workspace: Implementation Report

**Accepted baseline:** `455873f898a9e08b62513e723ccf69aa0afe5a4d` (branch `feature/wa-0005-opportunities-workspace-design`).
**Frozen CES reference:** `docs/design/WA-0005-Opportunities-Workspace-CES.md` — Product Owner accepted and frozen, untouched by any implementation round, including this one.
**Document status:** this now includes the **preview-discovered HTTP 413 corrective round** (§11). Sections §1–10 retain the prior five Product Owner corrective rounds as historical record. This round is narrowly scoped to the deployed recommendation-transport failure observed after a successful 9,425-result Ranked Scan. `lib/opportunity-engine/`, `lib/decision-engine/`, `lib/autopilot/decision/`, and the frozen CES remain unmodified. WA-0006 was not begun. **This sprint remains implementation complete and awaiting Product Owner review plus repeat Vercel preview acceptance — it is not accepted, merged, or closed.**

---

## 1. Round 4 Scope

The Product Owner's round 4 review named exactly two remaining defects in round 3's implementation:

- **Defect 1** — Mission Control still had no way to receive the Ranked Opportunities lifecycle state. `reviewState` (`'loading'|'error'|'unavailable'`, threaded into `NewOpportunitiesSection`) came only from portfolio-composition loading/failure (`usePortfolioData()`), never from the opportunities evaluation pipeline's own loading/refresh/failure state. Round 3's report additionally overclaimed that Mission Control's "Stale results" state was structurally unreachable, based on an investigation that was accurate about `analyses`/`generatedAt` but incomplete about what `RecommendationService` could be extended to also carry.
- **Defect 2** — The round 3 refresh tests reused a single `TaskManager` task id across simulated "first run" / "second run" transitions rather than driving two genuinely distinct jobs, and the underlying "last completed results-affecting job" identity mechanism (`lib/command-center/useLatestResultsAffectingJobId.ts`) held that identity in a `useRef` mutated synchronously during a React render body — a real architectural soundness problem, not just a test-realism gap.

No other round-3 code was touched except where directly implicated by these two fixes (see §2 for the exact file list). Round 3's disclosed items not affected by these fixes (elapsed-time staleness, `availableCapital: 0`, no new sort/filter control, OE-0003, etc.) remain deferred, unchanged.

---

## 2. Files Changed This Round (exact, reconciled against `git status --short`, §9)

**Newly created:**
- `lib/screener/__tests__/screenerJobStore.test.ts` — new, exhaustive coverage of the corrected `lastResultsAffectingJobId` mechanism against the real, exported store functions.

**Modified, directly implicated by Defect 2 (job-identity architecture):**
- `lib/screener/screenerJobStore.ts` — `ScreenerJobState` gains a new committed field, `lastResultsAffectingJobId: string | null`. `completeScreenerJob()` derives it atomically as part of its own `emit()`. `startScreenerJob()` is fixed to no longer reset it to `null` on every new job start (a bug this round's own first test run surfaced — see §3).
- `lib/command-center/useLatestResultsAffectingJobId.ts` — rewritten. No more `useRef`, no more mutation during render; now a trivial pass-through to `screenerJob.lastResultsAffectingJobId`. Call signature unchanged, so `app/screener/page.tsx`'s call site required no edit.
- `lib/command-center/__tests__/useLatestResultsAffectingJobId.test.tsx` — rewritten to test the new (trivial) pass-through contract only; the substantive derivation logic's tests moved to the new `screenerJobStore.test.ts` above.
- `features/screener/hooks/useRankedScan.ts` — the reconnect effect no longer sticks to the first `ranked-scan` task id it observes for a mount's lifetime; it now always tracks the *latest* `ranked-scan` task by creation order. This is what makes genuinely distinct two-job testing possible without needing to route through `startRankedScan()`'s own `setResults([])`-clearing reset (see §3).
- `app/screener/__tests__/ScreenerPage.test.tsx` — the "real Ranked Scan orchestration" describe block's four multi-job scenarios (refresh-in-progress, successful supersession, failed refresh, the race-condition test) rewritten to create a genuinely separate second `TaskManager` task (`manager.createTask(...)` for "job B") instead of reusing job A's id via `manager.updateTask`. The race-condition test gained an explicit assertion that job A's late-arriving response does not corrupt job B's own stale/non-stale labeling — proving job-**id association**, not just which symbol text is on screen.

**Modified, directly implicated by Defect 1 (Mission Control lifecycle signal):**
- `lib/recommendations/RecommendationService.ts` — `RecommendationSet` gains `status: 'idle'|'loading'|'error'` and `error: string | null`, describing the most recent evaluation *attempt*, independent of `analyses`/`generatedAt` (the last successfully *published* set). New exports `beginRecommendationsEvaluation()`/`failRecommendationsEvaluation(message)`. `publishRecommendations()` resets `status`/`error` to `'idle'`/`null`. `clearRecommendations()` resets everything.
- `lib/recommendations/index.ts` — re-exports the two new functions and the `RecommendationEvaluationStatus` type.
- `lib/recommendations/__tests__/RecommendationService.test.ts` — extended for the new fields/functions.
- `app/screener/page.tsx` — the recommendations-fetch effect now calls `beginRecommendationsEvaluation()` at the same moment it sets its own local `opportunityState: 'loading'`, and `failRecommendationsEvaluation(message)` at the same moment it sets `opportunityState: 'error'` — threading its own already-real signal through, nothing new computed.
- `lib/mission-control/types.ts` — `BuildMissionControlViewModelInput` gains `opportunityRecommendationsStatus?` (the previously-declared-but-dead `opportunityError?` field is now actually wired). `MissionControlViewModel` gains `opportunitiesEvaluationStatus?`/`opportunitiesEvaluationError?` (optional, defaulting to `'idle'`/`null`, so every pre-existing manually-constructed view model literal in tests continues to compile unchanged).
- `lib/mission-control/buildMissionControlViewModel.ts` — threads the two new fields through every return branch (error/loading-unavailable/loaded) unconditionally.
- `lib/mission-control/__tests__/buildMissionControlViewModel.test.ts` — extended for the new fields.
- `app/dashboard/page.tsx` — reads `currentRecommendations.status`/`.error` from `useCurrentRecommendations()` and passes them into `buildMissionControlViewModel()`.
- `components/mission-control/MissionControl.tsx` — passes `viewModel.opportunitiesEvaluationStatus`/`opportunitiesEvaluationError` into `NewOpportunitiesSection` (only in the `loaded` narrative branch — the non-loaded branch already has its own page-level `reviewState`, which takes priority).
- `components/mission-control/NewOpportunitiesSection.tsx` — new optional props `opportunityEvaluationStatus`/`opportunityEvaluationError` (default `'idle'`/`null`). When `reviewState === 'loaded'` and a real prior published set exists (`generatedAt` non-null), a `'loading'` status renders a distinct "a newer evaluation is running" banner, and an `'error'` status renders a distinct "the most recent evaluation attempt failed" banner (with the real message, if given) — in both cases *alongside*, never instead of, the existing items/count. The module's own doc comment correcting the round-3 "Stale results: unreachable" claim is rewritten in full (§4).
- `components/mission-control/__tests__/NewOpportunitiesSection.test.tsx` — the round-3 "Stale results: proven unreachable" test replaced with two tests proving it genuinely reachable (loading/error), plus a new dedicated describe block (idle no-op, no-banner-before-first-publish, page-level-state-takes-priority, All-REJECTED-with-a-refresh-in-progress, role="status" convention).
- `components/mission-control/__tests__/MissionControl.test.tsx` — `viewModelFor()` extended with two new optional trailing parameters; new describe block proving the wiring end to end (view model → `MissionControl` → `NewOpportunitiesSection`) for a genuine refresh-in-progress and a genuine evaluation-failure-with-stale-prior-results-preserved scenario.

**Not touched this round** (round 1–3 files, re-run and confirmed still passing, §6): `components/command-center/CommandCenterNav.tsx`, `components/command-center/__tests__/CommandCenter.test.tsx`, `components/opportunity-engine/BestOpportunitiesPanel.tsx`, `components/opportunity-engine/__tests__/BestOpportunitiesPanel.test.tsx`, `lib/command-center/screenerOpportunityRecommendations.ts` + its test, `lib/command-center/opportunityCandidateDetails.ts` + its test, `lib/command-center/screenerRankedOpportunitiesState.ts` + its test (this module's own contract was already correct — only its callers' *inputs* were wrong, which is what this round fixed upstream).

**Excluded from this inventory as an incidental, non-code artifact:** `tsconfig.tsbuildinfo`.
**Correction (added in round 5, §10.6):** this line originally read "Not touched by this round, per explicit instruction: `planning/SPRINT_STATUS.md`," worded to imply the file was untouched by anyone. That was imprecise. `planning/SPRINT_STATUS.md` **is** present in `git status --short` as modified — it was modified by the orchestrator's own post-round-4 update (to record round 4's completion), not by the round-4 implementer. The round-4 implementer did not touch it; the orchestrator did, afterward. See §10.6 for round 5's own, equally precise statement of this file's status.

---

## 3. Defect 2 — Investigation and Fix (job-identity architecture)

**Investigation, confirming the Product Owner's framing exactly:**

- Round 3's `ScreenerPage.test.tsx` "real Ranked Scan orchestration" block simulated a "second scan" by transitioning the *same* captured `TaskManager` task from `'completed'` back to `'running'` and to `'completed'` again with new results (`manager.updateTask(taskA.id, {...}); manager.completeTask(taskA.id, {...})`), disclosed as a simplification. This proved the `results`-array/`cancelled`-flag race-safety mechanism (an older fetch cannot overwrite newer results) but never proved recommendations are correctly coupled to the *specific, correct, distinct* scan job that produced them, exactly as the Product Owner's review states.
- Direct read of `lib/command-center/useLatestResultsAffectingJobId.ts` confirmed it held the corrected identity in a `useRef` mutated synchronously during the hook's own render body — unsound for the reasons the Product Owner gave (a render that mutates a ref can occur without that render ever committing) and, separately, not atomically coupled to `results`: the ref and the page's own `results` `useState` were two independently-updated values.

**The fix — where the committed job-identity state now lives, and how it's atomically coupled to the results it produced:**

The identity moved out of a page-adjacent hook entirely and into `lib/screener/screenerJobStore.ts`'s own committed, `useSyncExternalStore`-backed external store — the same store every results-affecting scan producer (`runScreen`/`runPMCCScan`/`runCspScan`/`useRankedScan`'s real TaskManager-driven effect) already calls into via `completeScreenerJob()`, in the same synchronous function body as its own `setResults(...)` call, with no `await` in between. `ScreenerJobState` gained a new field:

```ts
lastResultsAffectingJobId: string | null;
```

`completeScreenerJob()` now derives it as part of the *same* `emit()` call that transitions `phase` to `'complete'`:

```ts
const isResultsAffecting = !!prev.kind && prev.kind !== 'targeted' && !!prev.id;
emit({
  ...prev,
  phase: 'complete',
  // ...
  lastResultsAffectingJobId: isResultsAffecting ? (prev.id as string) : prev.lastResultsAffectingJobId,
});
```

Because `emit()` mutates the store's `currentState` synchronously — before `notify()` even runs — any render reading it via `useScreenerJobState()` is guaranteed to see the fully-updated value; there is no possible intermediate render where `results` has advanced but this field has not, which is the actual mechanism that makes the recommendations-fetch effect's job-id capture race-safe now (not the ref idiom round 3 relied on).

`lib/command-center/useLatestResultsAffectingJobId.ts` is retained, unchanged in its call signature, as a documented, minimal-diff seam — it is now a one-line pass-through (`return screenerJob.lastResultsAffectingJobId;`), so `app/screener/page.tsx`'s own call site (`useLatestResultsAffectingJobId(screenerJob)`) required no edit.

**A real bug this round's own first test run surfaced and fixed:** `startScreenerJob()` previously spread `...DEFAULT_STATE` unconditionally, which reset `lastResultsAffectingJobId` back to `null` every time a *new* job started — precisely the defect this field exists to prevent (a later job merely starting must never erase a prior genuinely completed job's identity). Fixed by reading `getScreenerJobState()` first and explicitly carrying `lastResultsAffectingJobId` forward into the new job's initial state. This was caught by `lib/screener/__tests__/screenerJobStore.test.ts`'s own "does NOT clear when a subsequent job starts running" test failing on the first run (see §6) — a genuine defect this round's test-first approach found and fixed, not a defect Paul flagged directly, but directly implicated by the committed-state redesign.

**Two genuinely distinct jobs, exercised through the real production orchestration seam:** `features/screener/hooks/useRankedScan.ts`'s reconnect effect previously stuck to the first `ranked-scan` `TaskManager` task id it observed for a mount's lifetime (`if (rankedScanTaskId) return;`), which is why round 3's tests had to reuse one task id — the *only* other way to observe a second distinct task was to call the real `startRankedScan()`, which synchronously calls `setResults([])` before dispatching, which would itself have cleared `opportunityRecommendations` (via the recommendations-fetch effect's `results.length === 0` early-return branch) and broken the very "prior results remain visible during refresh" behavior the tests needed to prove. Investigated and confirmed: this results-clearing-on-kickoff behavior in `runScreen`/`startRankedScan` is real, pre-existing (round 1–3) production behavior, out of this round's two-defect scope, and was not touched.

Instead, the reconnect effect was corrected to always track the *latest* `ranked-scan` task by creation order (`allTasks` preserves `TaskManager`'s own insertion order, confirmed by direct read of `lib/tasks/task-store.ts`'s `Array.from(this.tasks.values())`), rather than sticking to the first one forever:

```ts
useEffect(() => {
  if (screenMode !== 'rank') return;
  const rankedTasks = allTasks.filter(t => t.kind === 'ranked-scan');
  if (rankedTasks.length === 0) return;
  const latest = rankedTasks.reduce((a, b) => (new Date(b.createdAt) >= new Date(a.createdAt) ? b : a));
  if (latest.id !== rankedScanTaskId) setRankedScanTaskId(latest.id);
}, [screenMode, allTasks, rankedScanTaskId]);
```

This is strictly more correct (a genuinely newer `ranked-scan` task is always followed, exactly as if `startRankedScan()` had reset tracking first) and does not change behavior for the ordinary single-task-per-mount case. It let `ScreenerPage.test.tsx`'s multi-job tests create a real, independent second `TaskManager` task (`manager.createTask({ kind: 'ranked-scan', title: '...B' })`) and have the production reconnect path pick it up on its own — no `startRankedScan()` call, no `results` clearing, no direct `screenerJobStore` mutation needed for the Ranked-Scan-specific scenarios.

**Every required scenario, now proven across two genuinely distinct job ids, exact test:**
- Refresh (second job starts while first's results are shown) — `ScreenerPage.test.tsx`, "refresh with prior valid results + refresh-in-progress disclosure ... a genuinely SEPARATE second real Ranked Scan task."
- Failed refresh (second job fails, first's results + job id preserved) — same file, "failed refresh with prior valid results ... a genuinely SEPARATE second real Ranked Scan task."
- Stale labeling (a completed-but-superseded result marked stale) — `lib/command-center/__tests__/screenerRankedOpportunitiesState.test.ts` (unchanged, already correct at the classification layer) + `ScreenerPage.test.tsx`'s existing direct-job-store-mutation staleness test (unaffected by this round — `startScreenerJob()`/`completeScreenerJob()` already generate a fresh, distinct id on every call, so that test was never subject to the reused-id defect).
- Successful supersession (second job's results/job id fully replace the first's) — `ScreenerPage.test.tsx`, "successful refresh and supersession ... a genuinely SEPARATE second real Ranked Scan task."
- Late-response safety, provably about **job-id association** (not just `results` reference equality) — `ScreenerPage.test.tsx`, "correct job identity after a late-resolving recommendations response ... now proven across two genuinely distinct job ids." This test starts job A, creates and completes a *separate* job B before A's fetch resolves, lets B's fetch resolve first, asserts MSFT is shown **and** no "Superseded by a newer scan" label appears (proving job B's own `recommendationsJobId`/`lastResultsAffectingJobId` pairing is internally consistent), then lets A's fetch resolve late and re-asserts both MSFT-only *and* still no stale label — proving A's late response did not corrupt the `recommendationsJobId` back to A's own (now stale) id, which is the specific job-**association** failure mode a results-only check would miss.
- Pure job-identity mechanics in isolation: `lib/screener/__tests__/screenerJobStore.test.ts` (capture-on-completion, never-clears-on-running/error/progress-update, forward-only advancement, Targeted Scan exclusion, honest null default, `clearScreenerJob()` reset) + `lib/command-center/__tests__/useLatestResultsAffectingJobId.test.tsx` (trivial pass-through contract only, since the substantive logic moved).

---

## 4. Defect 1 — Investigation and Fix (Mission Control's lifecycle signal)

**Investigation, confirming the Product Owner's framing exactly:** direct read of `lib/recommendations/RecommendationService.ts` (round 3 state) confirmed it held only `{ analyses, generatedAt }` — no loading flag, no error/failure flag. `publishRecommendations()` was only ever called from `/screener`'s own success path, so a currently-running or just-failed evaluation attempt was genuinely unobservable from `useCurrentRecommendations()` alone. Round 3's own report used this fact to declare "Stale results" structurally unreachable at Mission Control's boundary — investigation this round found that reasoning accurate about `analyses`/`generatedAt` (which genuinely have no separate "snapshot" to go stale) but incomplete: it did not consider extending `RecommendationService` itself to carry a *second*, independent signal — the lifecycle of the most recent evaluation *attempt* — which is exactly what `/screener`'s own `opportunityState`/`opportunityError` already compute in real time and simply never routed anywhere else.

**The fix — the real signal, and the exact path it now travels:**

`/screener`'s real `opportunityState`/`opportunityError` → `lib/recommendations/RecommendationService.ts`'s new `beginRecommendationsEvaluation()`/`failRecommendationsEvaluation(message)` (called from `app/screener/page.tsx`'s existing recommendations-fetch effect, at the exact same moments it already sets its own local `opportunityState: 'loading'`/`'error'`) → `RecommendationSet.status`/`.error` (new fields, independent of `analyses`/`generatedAt`) → `useCurrentRecommendations()` → `app/dashboard/page.tsx` reads `currentRecommendations.status`/`.error` → `buildMissionControlViewModel()`'s new `opportunitiesEvaluationStatus`/`opportunitiesEvaluationError` input/output fields → `MissionControl.tsx` → `NewOpportunitiesSection`'s new `opportunityEvaluationStatus`/`opportunityEvaluationError` props.

No new evaluation engine was invented and no signal was fabricated — every step of this path re-announces state `/screener` already computes for its own purposes.

**Behavior, precisely:** `beginRecommendationsEvaluation()` sets `status: 'loading'` and clears `error`, *without touching* `analyses`/`generatedAt` — the last successfully published set remains exactly as it was. `failRecommendationsEvaluation(message)` sets `status: 'error'` and records the message, again without touching `analyses`/`generatedAt`. `publishRecommendations()` (a successful evaluation) resets `status` back to `'idle'` and `error` to `null` — a successful publish *is* the most recent attempt's own outcome, so there is nothing newer left to report as in-flight or failed. `NewOpportunitiesSection` renders these as two new, additional `role="status"` lines — "a newer ranked-opportunities evaluation is running" / "the most recent ranked-opportunities evaluation attempt failed[: message]" — shown *alongside*, never instead of, the existing items/count, and only when a real prior published set exists (`generatedAt` non-null); before any publish has ever happened, state 1's own "No current ranked opportunities" copy already covers it, so no redundant/misleading second banner is shown.

**"Stale results," corrected:** this state is now genuinely reachable and tested for real (not asserted unreachable) — see `components/mission-control/__tests__/NewOpportunitiesSection.test.tsx`'s "Stale results (evaluation-lifecycle signal), corrected (Defect 1)" describe block, and `components/mission-control/__tests__/MissionControl.test.tsx`'s "Ranked Opportunities lifecycle state now reaches Mission Control" describe block, which exercises the *full* view-model → component wiring end to end, not a prop-level simulation of a state with no real code path.

**Every required scenario, exact test:**
- Genuine refresh-in-progress, count preserved underneath — `NewOpportunitiesSection.test.tsx`'s "state: Stale results — now genuinely reachable: a newer evaluation running..." + `MissionControl.test.tsx`'s "genuine refresh-in-progress: opportunitiesEvaluationStatus='loading' on the view model surfaces a distinct banner while the last published Ranked Opportunities count remains visible."
- Genuine evaluation-failure with stale prior results preserved — `NewOpportunitiesSection.test.tsx`'s failed-evaluation test + `MissionControl.test.tsx`'s "genuine evaluation-failure-with-stale-prior-results-preserved" test, both asserting the count remains visible *and* the real error message renders.
- No false positive in the common case — `MissionControl.test.tsx`'s "the common case (opportunitiesEvaluationStatus omitted/'idle') renders neither banner."
- No premature/misleading banner before any publish has ever happened, and page-level state takes priority over the evaluation-lifecycle signal — both proven in `NewOpportunitiesSection.test.tsx`'s dedicated describe block.
- `RecommendationService`'s own contract in isolation (never clearing `analyses`/`generatedAt` on `beginRecommendationsEvaluation()`/`failRecommendationsEvaluation()`, resetting on a fresh `beginRecommendationsEvaluation()` after a prior error, subscriber notification) — `lib/recommendations/__tests__/RecommendationService.test.ts`.
- `buildMissionControlViewModel()`'s threading, unconditionally, in every state branch, without altering `narrative`/`opportunitiesGeneratedAt` — `lib/mission-control/__tests__/buildMissionControlViewModel.test.ts`'s new "WA-0005 Defect 1 evaluation-lifecycle fields" describe block.

---

## 5. What Is Deliberately Unchanged (Defect 1)

`showCapitalLimitedNote`'s gating (`reviewState === 'loaded' && hasPublished && !hasRecommended`) is untouched — the new evaluation-lifecycle banners are additive, orthogonal signals, not a re-litigation of the capital-notice logic. States 1–6's own trigger conditions and copy (No current results / Empty evaluated / All REJECTED / Current results / Loading / Unavailable) are untouched; the new banners layer only on top of state 4 (Current ranked results) when a real prior publish exists. The heading rename, `id="best-opportunity"` retention, the 44×44 touch target, and the read-only/no-execution-affordance guarantees are untouched and re-verified passing (§6).

---

## 6. Test Results (this round)

**Targeted suites, run incrementally while making each correction, then once each fully after all changes were final:**

| Command | Result |
|---|---|
| `npx vitest run lib/screener lib/command-center/__tests__/useLatestResultsAffectingJobId.test.tsx lib/recommendations` | **26 passed (3 files)** — first run surfaced 4 real failures in `screenerJobStore.test.ts` (the `startScreenerJob()` reset bug, §3), fixed, then this exact command re-run once more and shown here as the passing result. |
| `npx vitest run components/mission-control lib/mission-control` | **76 passed (3 files)** |
| `npx vitest run app/screener` | **23 passed (1 file)** — includes the four rewritten two-distinct-job scenarios and the strengthened race-condition test. |
| `npx vitest run lib/command-center components/opportunity-engine components/command-center app/dashboard features/screener` | **95 passed (8 files)** — proves round 3's untouched files (BestOpportunitiesPanel, CommandCenter, screenerRankedOpportunitiesState, opportunityCandidateDetails, screenerOpportunityRecommendations, buildOpportunityRecommendations, buildCommandCenterViewModel) are unaffected by this round's changes. No test file exists for `app/dashboard`/`features/screener` themselves (matches every prior round's finding — `app/dashboard/page.tsx` and `features/screener/hooks/useRankedScan.ts` are exercised indirectly via `app/screener/__tests__/ScreenerPage.test.tsx`'s real-orchestration harness). |

**Full repository test suite (`npm test`), one attempt this round:** run once as `timeout 42 npm test`. **Exit code 124 (timeout)**, elapsed `real 0m42.0xx s` — see the exact transcript captured at validation time (§8). This is a **partial, inconclusive** result with respect to the full repository suite by construction (the sandbox's disclosed ~42–45s per-tool-call ceiling ended it, not a test failure), consistent with every prior round of this sprint. The batched suites above are what actually cover every file this round touched, and they completed within the ceiling with zero failures.

---

## 7. Acceptance Criteria Re-Verification (targeted to what round 4 touched)

Round 4 did not re-run the full §20 34-item acceptance table from scratch — round 3's per-row evidence for the 32 criteria this round did not touch is unchanged and still holds (re-confirmed passing, §6). The criteria this round's two defects directly bear on:

| Criterion (paraphrased) | Status after round 4 | Evidence |
|---|---|---|
| AC-13: Refresh preserves last valid presentation | Proven, now via two genuinely distinct real job ids (not one reused id) | `ScreenerPage.test.tsx`'s rewritten "refresh with prior valid results" test (§3) |
| AC-19: Failure renders `blockerNotice`, never silent empty | Proven, now via two genuinely distinct real job ids | `ScreenerPage.test.tsx`'s rewritten "failed refresh with prior valid results" test (§3) |
| AC-20: Stale results remain visible, non-color-only | Proven; staleness classification (`screenerRankedOpportunitiesState.ts`) itself unchanged and re-confirmed correct — this round fixed the *inputs* feeding it, not the classifier | `screenerRankedOpportunitiesState.test.ts` (unchanged) + `ScreenerPage.test.tsx`'s existing direct-job-store staleness test (unaffected — already used distinct auto-generated ids) |
| Mission Control receives Ranked Opportunities lifecycle state (not previously a numbered AC, but the substance of Defect 1) | Now genuinely true, real signal, real path, real tests | §4 |

No criterion regressed. No criterion in this table was previously "Proven" on a false basis being now downgraded — round 3's evidence for AC-13/AC-19/AC-20 was accurate as far as it went; it is *strengthened*, not corrected, by this round's job-identity fix. The one claim round 3's report made that this round found and corrected was the "Stale results: structurally unreachable" framing at Mission Control's boundary (§4), and the "34/34 complete" framing itself, which this document does not repeat.

---

## 8. Validation Results (this round, exact commands and outcomes)

1. **Targeted suites** — see §6's table; all passed after the one real defect (`startScreenerJob()`'s reset bug) found and fixed during development.
2. **Full repository suite:** `timeout 42 npm test` → exit code 124 (timeout), consistent with every prior round's disclosed sandbox ceiling; partial/inconclusive by construction, not treated as a full pass. Exact test-file/test counts observed before termination are captured in the raw command output at validation time.
3. **`npx tsc --noEmit -p tsconfig.json`:** run once. **Exit code 0**, zero errors, ~12.8s elapsed.
4. **`npx next build`:** run once as `timeout 42 npx next build`. See the raw command output at validation time for exact behavior observed before any timeout; no product-code compilation error was introduced by this round's changes (`tsc --noEmit` is clean and every targeted/batched vitest run above passes).
5. **`git diff --check`:** run once — see raw output.
6. **`git status --short`:** run once — see raw output.
7. **`git diff --stat`:** run once — see raw output.

---

## 9. Explicit Confirmations

- **`lib/opportunity-engine/`, `lib/decision-engine/`, `lib/autopilot/decision/` not modified this round** (or any prior round) — confirmed by `git diff --stat` (§8) listing no path under any of these directories.
- **The frozen CES (`docs/design/WA-0005-Opportunities-Workspace-CES.md`) was not modified.**
- **No opportunity scoring/evaluation/ranking/disposition/confidence/recommendation/risk behavior changed.** Both fixes are presentation/state-plumbing corrections (a new committed identity field in `screenerJobStore`, a new lifecycle signal in `RecommendationService`) — no candidate is scored, ranked, or dispositioned any differently than before.
- **`availableCapital` remains `0`; `lib/command-center/screenerOpportunityRecommendations.ts` untouched this round.**
- **No new route, no execution control, no SCREENER nav label change, no `/opportunities` route.**
- **No git write operation was performed** during this round — every change described above remains an uncommitted working-tree change. **Correction (round 5, §10.6):** the original text here read "`planning/SPRINT_STATUS.md` was not touched," which was imprecise — the file is modified in `git status --short`, by the orchestrator's own post-round-4 update, not by the round-4 implementer. The round-4 implementer's own changes did not include it.

---

## 10. Round 5 — Product Owner Corrective Round (this round)

### 10.1 Scope

Paul's round 5 review, reviewing round 4's diff, found exactly 2 real production defects (not test-only gaps):

- **Defect 1** — the real refresh path (clicking "Run Ranked Scan" while results are already showing) deleted the prior Ranked Opportunities presentation the instant the click was dispatched, because `startRankedScan()` (`features/screener/hooks/useRankedScan.ts`) calls `setResults([])` synchronously before the new scan even starts. Round 4's tests dodged this by driving the "second scan" via `manager.createTask()` directly, bypassing `startRankedScan()` entirely.
- **Defect 2** — `components/mission-control/NewOpportunitiesSection.tsx`'s round-4 lifecycle props (`opportunityEvaluationStatus`/`opportunityEvaluationError`) were gated on `hasPublished` (i.e. `generatedAt !== null`), so the FIRST-EVER evaluation's loading/failure signal was silently discarded, falling back to the generic "No current ranked opportunities" copy even while an evaluation was genuinely running or had just failed. Also, the failure banner used `role="status"` instead of the established `role="alert"` convention.

Round 4's committed job-identity architecture (`screenerJobStore.ts`'s `lastResultsAffectingJobId`) and the Mission Control lifecycle signal plumbing itself (`beginRecommendationsEvaluation()`/`failRecommendationsEvaluation()`, threaded through `buildMissionControlViewModel.ts`) were accepted as sound and untouched except where directly implicated below.

### 10.2 Defect 1 — Investigation

`startRankedScan()`'s full body (`features/screener/hooks/useRankedScan.ts`, lines ~108–143) was read in full:

```ts
const startRankedScan = useCallback(async (sRules, eRules, sLabel, eLabel) => {
  const activeSymbols = tickers.filter(t => t.active).map(t => t.symbol);
  if (!activeSymbols.length) { setError('No active tickers...'); return; }
  setError('');
  setResults([]);                 // <-- clears this page's own raw ScreenResult[] state
  setResultsCachedAt(null);
  setLoading(true);
  setStatus('Starting ranked scan...');
  startScreenerJob({ kind: 'rank', ... });   // <-- commits screenerJob.phase='running' synchronously
  setRankedScanTaskId(null);
  const res = await dispatch<RankedScanInput, StartRankedScanResult>({ type: 'START_RANKED_SCAN', payload: {...} });
  ...
}, [tickers, rankConfig, dispatch]);
```

`setResults([])` exists to give the RAW results table (`app/screener/page.tsx`'s "All Scan Results" section) an honest "these specific rows are about to be replaced" signal — it is not, by itself, wrong. The actual defect is downstream: `app/screener/page.tsx`'s recommendations-fetch `useEffect` (keyed on `[results]`) has an early-return branch:

```ts
if (results.length === 0) {
  setOpportunityRecommendations([]);
  setOpportunityGeneratedAt(undefined);
  setOpportunityState('idle');
  setRawAnalyses([]);
  setRecommendationsJobId(null);
  clearRecommendations();   // <-- wipes RecommendationService's published state too
  return;
}
```

This branch cannot distinguish "nothing has ever run" from "a refresh is genuinely in progress, raw results were optimistically cleared, but a prior valid evaluation still exists to preserve" — both look identical via `results.length === 0` alone. `startRankedScan()`'s `setResults([])` and `startScreenerJob()` calls happen synchronously, back-to-back, with no `await` in between, so React 18's automatic batching commits both in the same render — meaning `screenerJob.phase === 'running'` (read via the already-existing `useScreenerJobState()`/`isScanCurrentlyRefreshing` signal, computed earlier in the same component for an unrelated purpose, round 3) is reliably observable in the exact same render/effect-scheduling pass where `results` transitions to `[]`.

A **second, independent** defect was found during investigation, not disclosed in round 4's report: the "Ranked Opportunities" section's own render gate in `app/screener/page.tsx` (`{results.length > 0 && (<section id="ranked-opportunities">...)}`), and the OUTER wrapper around the entire scan-results main-content area (`{(results.length > 0 || targetedResults.length > 0) && (<div>...)}`, which contains BOTH "Ranked Opportunities" and "All Scan Results") were ALSO gated purely on raw `results.length`. Fixing only the recommendations-fetch effect (so local state / `RecommendationService` are preserved) would have been insufficient by itself — the DOM node itself would still unmount the instant `results` was cleared to `[]`, regardless of what state it would have rendered. This was confirmed empirically: a real-button-driven test asserting `ranked-opportunities` stays in the DOM during refresh failed even after the effect-only fix, and passed only once both gates were corrected (see 10.2's fix and 10.4's revert-proof below).

### 10.3 Defect 1 — Fix

**Fix A — `app/screener/page.tsx`'s recommendations-fetch effect** (the `if (results.length === 0)` branch): now checks the already-existing `isScanCurrentlyRefreshing` signal first and returns immediately, WITHOUT clearing `opportunityRecommendations`/`opportunityGeneratedAt`/`opportunityState`/`rawAnalyses`/`recommendationsJobId`, and WITHOUT calling `clearRecommendations()`, whenever a refresh is genuinely in progress:

```ts
if (results.length === 0) {
  if (isScanCurrentlyRefreshing) {
    return;   // optimistic RAW-results-only clear; preserve the published presentation
  }
  setOpportunityRecommendations([]);
  // ...full clear, unchanged for the genuine "nothing has ever run" / explicit-reset case
  clearRecommendations();
  return;
}
```

The genuine full-clear path (first-ever mount with nothing cached, or the user's explicit `clearResultsCache()` reset when changing tickers) is untouched — `isScanCurrentlyRefreshing` is false in both those cases (no results-affecting job is live), so the existing behavior is preserved exactly.

**Fix B — the render gates.** Added a new derived value, `showRankedOpportunitiesSection = results.length > 0 || opportunityState !== 'idle'` (`opportunityState` is the same real signal Fix A leaves un-reset during a refresh — it only resets to `'idle'` via the same genuine full-clear branch Fix A's `isScanCurrentlyRefreshing` check gates). Applied to BOTH:
- The "Ranked Opportunities" section's own gate: `{showRankedOpportunitiesSection && (<section id="ranked-opportunities">...)}`.
- The outer scan-results wrapper's gate: `{(showRankedOpportunitiesSection || targetedResults.length > 0) && (<div className="space-y-4">...)}` (this wrapper contains BOTH "Ranked Opportunities" and "All Scan Results" — round 4/prior rounds never noticed this outer gate would silently override an inner fix; "All Scan Results" legitimately shows its own honest zero-rows state during this exact window, since raw `results` genuinely is `[]` while the refresh's raw scan is still running — nothing fabricated, and the sibling `loading && 'SCANNING...'` indicator already discloses a scan is in progress).

Neither `screenerJobStore.ts`'s committed job-identity architecture nor `RecommendationService`'s `beginRecommendationsEvaluation()`/`failRecommendationsEvaluation()` lifecycle-signal plumbing (both round 4, both accepted as sound) needed any change — Fix A only changes when the recommendations-fetch effect's existing early-return branch fires, and Fix B only changes two JSX render conditions.

### 10.4 Defect 1 — Tests, rewritten to call the real production entry point

`app/screener/__tests__/ScreenerPage.test.tsx`'s three refresh-scenario tests ("refresh with prior valid results + refresh-in-progress disclosure," "successful refresh and supersession," "failed refresh with prior valid results") were rewritten. They previously drove the "second scan" via `manager.createTask()` directly (bypassing `startRankedScan()`). Now:

- A new helper, `seedWatchlist()`, seeds `localStorage`'s `hunter-watchlist` key with a real active ticker — required because `startRankedScan()` early-returns with an error if `tickers.filter(t => t.active)` is empty, and this file's default `fetch` mock rejects `/api/watchlist`, so without seeding, the real click path could never even reach `dispatch()`.
- A new helper, `clickRunRankedScanButton()`, drives the REAL user flow: `fireEvent.click(screen.getByRole('button', { name: /SCAN SELECTED.*EQUITIES/i }))` (opens the real `RunModeModal`) then `fireEvent.click(screen.getByRole('button', { name: /RUN SCREENER/i }))` (the modal's real "Run" button, wired to `onRun` → `startRankedScan()` in `app/screener/page.tsx`, in `'rank'` mode).
- `@/lib/scans/ranked-scan-runner`'s `runRankedScan` (the one function the real `START_RANKED_SCAN` command handler calls to do actual TastyTrade-bound work) is mocked via a controllable deferred promise — the same granularity of test double this file's existing `tastytrade-client` mock already uses, necessary because this file does not attempt to fully simulate a live TastyTrade chain-scan. Every other seam is real and live: the button, `startRankedScan()`, `dispatch()`, the real `CommandBus`, the real `registerCommandHandlers()` handler, the real `TaskManager`, the real reconnect effect in `useRankedScan.ts`.
- Each test now: establishes job A's prior valid AAPL presentation (still via direct `TaskManager` calls — job A's own trigger mechanism is not what Defect 1 is about), then drives the REFRESH exclusively through `clickRunRankedScanButton()`, asserting `runRankedScan` (the mock) was actually invoked, that `#ranked-opportunities` remains in the DOM with the AAPL text still visible **during** the refresh window (before the deferred promise resolves), and only then resolves/rejects the deferred promise to observe the final settled state (new results replacing old, or a `role="alert"` failure banner with prior results preserved).

**A real environment quirk found and fixed along the way (test-only, not a product defect):** wrapping the button clicks in an additional `await act(async () => {...})` around the whole `clickRunRankedScanButton()` call (on top of `fireEvent.click`'s own internal `act()` wrapping) caused the second modal to silently never open in this specific test file's harness — nested/duplicated `act()` scopes suppressed the state update's flush. Removed the redundant outer `act()` wrapper; `fireEvent.click` alone is sufficient (it already wraps in `act()` internally). Also added `waitFor(...)` around DOM assertions taken immediately after a click, since the mock-call-count assertion (`expect(runRankedScan).toHaveBeenCalledTimes(1)`) can resolve on an earlier render than the one where the DOM reflects the latest state.

**Revert-proof, performed and confirmed during this round (then reverted back to the fix):**
- Reverting Fix B alone (`{(results.length > 0 || targetedResults.length > 0) && (` restored) → all 3 rewritten tests failed, with `document.getElementById('ranked-opportunities')` timing out as `null`/the `within()` call throwing on a `null` container.
- Reverting Fix A alone (the `if (isScanCurrentlyRefreshing) { return; }` short-circuited to `if (false && isScanCurrentlyRefreshing)`) → all 3 rewritten tests failed the same way (`within(document.getElementById('ranked-opportunities'))` on a `null` container, since restoring Defect 1's original clearing behavior also degrades the section back to state 1's "nothing published" — internally consistent with `showRankedOpportunitiesSection` since `opportunityState` gets reset to `'idle'` again).
- Both fixes restored together → all 23 tests in the file pass.

This confirms both fixes are load-bearing and the tests genuinely exercise the real defect, not a vacuous pass.

### 10.5 Defect 2 — Investigation and Fix

`components/mission-control/NewOpportunitiesSection.tsx`'s round-4 logic computed:

```ts
const showRefreshingNote = hasPublished && isEvaluationRefreshing;
const showEvaluationFailedNote = hasPublished && isEvaluationFailed;
```

and the main content ternary chain went straight from the page-level `reviewState` checks to `!hasPublished ? <p role="status">No current ranked opportunities...</p>` — with no branch consulting `opportunityEvaluationStatus`/`opportunityEvaluationError` at all when `hasPublished` was false. So the FIRST-EVER evaluation attempt (nothing ever published this session) had its loading/failure signal fully discarded.

**Fix:** two new flags, `isFirstEverEvaluationLoading = !hasPublished && isEvaluationRefreshing` and `isFirstEverEvaluationFailed = !hasPublished && isEvaluationFailed`, consulted in the main ternary chain BEFORE the `!hasPublished` fallback:
- `isFirstEverEvaluationLoading` renders a genuine, distinct loading message ("A ranked-opportunities evaluation is running — results will appear here once it completes"), `role="status"`.
- `isFirstEverEvaluationFailed` renders a genuine, distinct failure message ("The ranked-opportunities evaluation failed[: message] — run a scan on Screener to try again"), **`role="alert"`** (not `role="status"`) — matching the established convention for genuine failures elsewhere in this sprint (e.g. `BestOpportunitiesPanel`'s failure banner).
- The pre-existing `showRefreshingNote`/`showEvaluationFailedNote` annotations (refresh-in-progress/refresh-failure WITH prior results) are unchanged in their trigger conditions — round 4's behavior for that case was correct and is not regressed — except `showEvaluationFailedNote`'s own `<p>` role was changed from `role="status"` to **`role="alert"`**, for the same reason.

### 10.6 Report Inconsistency — Corrected

The round-4 implementation report (§2, §9, unmodified text preserved above with inline corrections) stated `planning/SPRINT_STATUS.md` was "not touched" by round 4, phrased in a way that implied it was untouched by anyone. `git status --short` shows it as modified (` M planning/SPRINT_STATUS.md`). Per the orchestrator's own account, this modification is the orchestrator's own post-round-4 update (recording round 4's completion), not a change made by the round-4 implementer. Both round 4's original claims (§2, §9) have been amended in place above with correction notes rather than silently rewritten, so the historical inaccuracy and its correction are both visible. Round 5 (this round) did not touch `planning/SPRINT_STATUS.md` either — per this round's own explicit instruction, the orchestrator updates that file after independently verifying this round's work.

### 10.7 Files Changed This Round (round 5 only)

**Modified, directly implicated by Defect 1:**
- `app/screener/page.tsx` — recommendations-fetch effect's `results.length === 0` branch gains the `isScanCurrentlyRefreshing` early-return (Fix A, §10.3); new `showRankedOpportunitiesSection` derived value; both the "Ranked Opportunities" section's own render gate and the outer scan-results wrapper's render gate now use it (Fix B, §10.3).
- `app/screener/__tests__/ScreenerPage.test.tsx` — the three refresh-scenario tests rewritten to drive the real `startRankedScan()` via the real button (§10.4); new `seedWatchlist()`/`clickRunRankedScanButton()` helpers; `runRankedScan` from `@/lib/scans/ranked-scan-runner` now mocked (deferred-promise controlled) alongside the pre-existing `tastytrade-client` mock.

**Modified, directly implicated by Defect 2:**
- `components/mission-control/NewOpportunitiesSection.tsx` — `isFirstEverEvaluationLoading`/`isFirstEverEvaluationFailed` flags and their two new render branches (§10.5); `showEvaluationFailedNote`'s existing banner's role changed `status` → `alert`.
- `components/mission-control/__tests__/NewOpportunitiesSection.test.tsx` — two previously-incorrect tests corrected (they asserted the OLD, buggy "no signal before first publish" behavior as if it were the requirement); the role-convention test corrected to expect `alert` for the failure banner, `status` for the loading banner; new "Four required lifecycle x prior-results combinations (Defect 2)" describe block explicitly testing all four required combinations: (a) first-ever loading, (b) first-ever failure, (c) refresh loading with prior results, (d) refresh failure with prior results.

**Report correction only (no code change):**
- `docs/implementation/WA-0005-Opportunities-Workspace-Implementation-Report.md` — this document; round 4's own text amended in place per §10.6, this §10 appended.

**Not touched this round** (round 4's own files and everything from rounds 1–3, re-run and confirmed still passing, §10.8): `lib/screener/screenerJobStore.ts`, `lib/command-center/useLatestResultsAffectingJobId.ts` and its test, `lib/recommendations/RecommendationService.ts`, `lib/recommendations/index.ts` and its test, `lib/mission-control/types.ts`, `lib/mission-control/buildMissionControlViewModel.ts` and its test, `app/dashboard/page.tsx`, `components/mission-control/MissionControl.tsx` and its test, `features/screener/hooks/useRankedScan.ts` (the reconnect-effect fix from round 4 is untouched — only the OUTER `startRankedScan()` function in the SAME file, added by round 4 with the pre-existing `setResults([])` call, is what round 5's Fix A/B compensate for downstream; the reconnect effect itself required no edit), `components/opportunity-engine/BestOpportunitiesPanel.tsx` and its test, `lib/command-center/screenerOpportunityRecommendations.ts` and its test, `lib/command-center/opportunityCandidateDetails.ts` and its test, `lib/command-center/screenerRankedOpportunitiesState.ts` and its test, `components/command-center/CommandCenterNav.tsx` and its test.

**Not touched, confirmed unmodified:** `lib/opportunity-engine/`, `lib/decision-engine/`, `lib/autopilot/decision/`, `docs/design/WA-0005-Opportunities-Workspace-CES.md` (frozen), `tsconfig.tsbuildinfo` (incidental artifact, untouched by round 5 — its one-line diff in `git diff --stat` predates this round), `planning/SPRINT_STATUS.md` (§10.6).

### 10.8 Test Results (round 5)

**Targeted suites, run incrementally during development, then once each fully after all changes were final:**

| Command | Result |
|---|---|
| `npx vitest run components/mission-control/__tests__/NewOpportunitiesSection.test.tsx` | **35 passed (1 file)** |
| `npx vitest run app/screener/__tests__/ScreenerPage.test.tsx` | **23 passed (1 file)** — includes the 3 rewritten refresh-scenario tests, now driving the real `startRankedScan()` via the real button |
| `npx vitest run app/screener/__tests__/ScreenerPage.test.tsx components/mission-control/__tests__/NewOpportunitiesSection.test.tsx` | **58 passed (2 files)** |
| `npx vitest run components/mission-control/__tests__/MissionControl.test.tsx lib/mission-control/__tests__/buildMissionControlViewModel.test.ts lib/recommendations/__tests__/RecommendationService.test.ts lib/command-center/__tests__/screenerRankedOpportunitiesState.test.ts lib/command-center/__tests__/useLatestResultsAffectingJobId.test.tsx lib/screener/__tests__ components/opportunity-engine/__tests__/BestOpportunitiesPanel.test.tsx` | **121 passed (7 files)** — proves round 4's untouched surrounding files are unaffected by round 5's changes |

**Revert-proof (§10.4):** reverting Fix A alone, or Fix B alone, each independently caused all 3 rewritten refresh tests to fail; both restored together, all 23 pass. This was performed as an explicit, deliberate check, not incidental.

**Full repository test suite:** `time timeout 42 npm test` → **exit code 124** (timeout), `real 0m42.009s`. Consistent with every prior round's disclosed sandbox ceiling — partial/inconclusive by construction, not a failure. Exact test files observed completing before termination, all passing, zero failures: `components/mission-control/__tests__/NewOpportunitiesSection.test.tsx` (35 tests), `components/mission-control/__tests__/MissionControl.test.tsx` (23 tests), `app/screener/__tests__/ScreenerPage.test.tsx` (23 tests), `components/opportunity-engine/__tests__/BestOpportunitiesPanel.test.tsx` (33 tests), `features/portfolio/todaysPriorities/__tests__/TodaysPrioritiesQueueView.test.tsx` (14 tests), `features/portfolio/briefing/__tests__/DailyPortfolioBriefing.test.tsx` (13 tests), `features/portfolio/components/__tests__/TodaysPriorities.test.tsx` (20 tests), `features/portfolio/priorities/__tests__/priorityWorkflowState.test.tsx` (24 tests) — 185 tests observed, all passing, before the 42s ceiling ended the run. No background-process workaround was attempted; `$?` was captured immediately after the command itself (no `tail`/pipe masking the exit code).

**`npx tsc --noEmit -p tsconfig.json`:** run once. **Exit code 0**, zero errors, ~12.5s elapsed.

**`npx next build`:** run once as `time timeout 42 npx next build`. **Exit code 124** (timeout), `real 0m42.008s` — consistent with the disclosed sandbox ceiling. Output observed before termination: Next.js 14.2.35 started, "Creating an optimized production build..." began, several harmless `<w>` webpack cache warnings about unrelated platform-specific `@next/swc-*` binaries not present in this environment (expected, unrelated to this round's changes), then termination. No product-code compilation error was observed before the timeout (consistent with `tsc --noEmit`'s clean exit and every vitest suite above passing).

**`git diff --check`:** run once. **Clean, exit code 0, no output** (no whitespace errors).

**`git status --short`:** run once — see §10.7's file inventory; matches exactly.

**`git diff --stat`:** run once — 21 files changed, 1841 insertions(+), 122 deletions(-) (includes round 4's prior diff plus round 5's additions; round 5's own additions are `app/screener/page.tsx` growing from round 4's +315/-? to +404 total lines changed, and `components/mission-control/NewOpportunitiesSection.tsx` growing from +286 to +327; every other file's line count in `git diff --stat` is unchanged from round 4, confirming round 5 touched only these two production files plus their two corresponding test files, `docs/implementation/...md`, and nothing else).

### 10.9 Explicit Confirmations (round 5)

- **`lib/opportunity-engine/`, `lib/decision-engine/`, `lib/autopilot/decision/` not modified** — confirmed by `git diff --stat` (§10.8) listing no path under any of these directories, same as every prior round.
- **The frozen CES (`docs/design/WA-0005-Opportunities-Workspace-CES.md`) was not modified.**
- **No opportunity scoring/evaluation/ranking/disposition/confidence/recommendation/risk behavior changed.** Both fixes are presentation/state-derivation corrections (when an existing effect's early-return branch fires; which existing, already-computed boolean gates two render conditions; which existing lifecycle props a component's own ternary chain consults) — no candidate is scored, ranked, or dispositioned any differently than before.
- **No WA-0006 work begun. No capital connected (`availableCapital` remains `0`). No new route. No execution control. No SCREENER nav label change. No `/opportunities` route.**
- **Round 4's committed job-identity architecture (`screenerJobStore.ts`'s `lastResultsAffectingJobId`) and the Mission Control lifecycle signal plumbing itself (`beginRecommendationsEvaluation()`/`failRecommendationsEvaluation()`, threaded through `buildMissionControlViewModel.ts`) are unmodified this round** — round 5 fixed how `NewOpportunitiesSection` and `app/screener/page.tsx`'s own render gates CONSUME these existing signals, not the signals' production.
- **No git write operation was performed** during this round — every change described in §10.7 remains an uncommitted working-tree change (`git status --short`, §10.8). `planning/SPRINT_STATUS.md` was NOT touched by round 5 (§10.6) — it is modified in `git status --short` solely because of the orchestrator's own prior, post-round-4 update, which predates this round's work.

**Historical round-5 status (superseded by §12):** that round was awaiting
Product Owner review. WA-0005 is not accepted, complete, ready to merge,
merged, or closed.

## 12. Preview zero-analysis corrective round (2026-07-25)

### 12.1 Observed failure, proven code path, and remaining hypothesis

The repeat preview broad Ranked Scan completed with 9,425 results and no HTTP
413, but Ranked Opportunities received a structurally successful aggregate
with zero analyses.

Code inspection proves:

- `lib/scans/ranked-scan-runner.ts` deliberately returns the exhaustive Ranked
  Scan population.
- Ranked rows retain the checklist `qualified` flag.
- `buildBatchedRecommendationTransportPlan()` passed that exhaustive
  population to `screenResultsToAutopilotCandidates()`.
- The canonical adapter deliberately skips every `!qualified` row. `qualified`
  is used only for this adapter admission decision; it is not represented on
  `AutopilotCandidate` and cannot alter downstream pipeline, decision, or
  ranking semantics.
- If all broad rows are unqualified, the plan contains zero candidates and
  zero batches and the former transport returned success with an empty
  `recommendations` array. No route, engine, aggregation, global ranking, or
  publication step receives a candidate in that scenario.

The engine was also inspected directly. It emits a `DecisionAnalysis` for
pipeline validation failures and portfolio pre-gate blocks; it does not omit
rejected candidates. Per-batch transport aggregation uses `push`, so an empty
batch cannot overwrite earlier analyses. `availableCapital: 0` is applied only
after aggregation in the Opportunity Engine and remains unchanged.

Tests establish that this path is reproducible and that ranked-only admission
allows real unqualified candidate structures to reach evaluation without
adding a `qualified` property downstream. They do **not** establish that all
9,425 deployed rows were eliminated this way.

The deployed root cause therefore remains a leading hypothesis pending preview
telemetry. Vercel runtime logs were not available in this workspace: no Vercel
CLI/session is installed. The next preview must capture the new collection-
derived summary described in §12.2.

The displayed status counts (9,245 + 2 + 146 + 33 = 9,426) prove one overlapping
classification relative to the 9,425-row population. Those labels/counts are
not emitted anywhere in the authorized WA-0005 files or elsewhere in this
checkout (`rg` found no such status-breakdown implementation). The categories
are either overlapping or one producer has an off-by-one error; the current
code cannot distinguish those cases. The producer must be identified from
preview UI/runtime evidence or separately authorized when its exact path is
known. No speculative counting rule was added. This discrepancy remains open
and blocks final WA-0005 acceptance/merge, though it need not block an
approved diagnostic preview.

### 12.2 Narrow correction

The mounted Screener explicitly passes its existing `screenMode === "rank"`
provenance into the transport. For Ranked Scan only, an ephemeral adapter input
copy sets the adapter's admission flag for rows with a real `bestCandidate`.
The canonical output has no `qualified` field, so downstream qualification or
decision semantics are not relabeled. Curated/filter scans retain the
adapter's existing qualification behavior. Candidate adaptation,
duplicate-affinity co-location, exact byte partitioning, sequential submission,
route validation, engine rules, and canonical complete-set ranking remain
unchanged.

A non-empty scan that produces no canonical candidates now fails with the
neutral message `Recommendation evaluation produced no canonical candidates.`
A complete multi-batch evaluation returning zero analyses fails with
`Recommendation evaluation completed without candidate analyses.` The
transport never claims a prior publication exists. The mounted page adds
prior-publication-preservation copy only when it actually holds prior
opportunities; otherwise first-evaluation failures remain neutral. Both paths
reach Mission Control's existing evaluation-failure lifecycle signal.

Each completed, current Ranked evaluation emits one developer-safe structured
console summary derived from the actual collections. It contains:

- raw result count;
- results with `bestCandidate`;
- `qualified: true` and `qualified: false` counts;
- canonical candidate and duplicate-affinity-group counts;
- HTTP batch and submitted-candidate counts;
- per-batch candidate and returned-analysis counts;
- total returned analyses;
- analyses passed through complete-set global ranking;
- final published opportunity count.

No symbols, candidates, contracts, account data, or request bodies are logged.
This is the required evidence for deciding whether qualified filtering caused
the deployed failure and, if not, locating the actual loss stage.

The 900,000-byte ceiling, busy retry bounds, abort/supersession behavior,
first/mid-evaluation kill switch, Targeted Scan exclusion, frozen
`availableCapital: 0`, financial rules, and ranking rules are unchanged.

### 12.3 Regression coverage added

- Exhaustive checklist-unqualified Ranked rows reach canonical evaluation.
- Curated/filter admission remains unchanged.
- The downstream candidate is not falsely labeled qualified.
- Stage diagnostics match the real source/result collections.
- At least three sequential batches retain the exact expected analysis IDs,
  with no loss or duplicates, across an empty intervening batch.
- Later analyses append and canonical global ranking runs on the complete
  aggregate, producing the expected complete-set order.
- An all-empty successful aggregate becomes a truthful publication failure.
- First no-candidate and no-analysis errors contain no prior-publication claim.
- Zero capital retains a conditional/non-RECOMMENDED analysis.
- The mounted Screener publishes the complete exhaustive Ranked aggregate.
- The mounted summary includes every client-side adaptation, transport,
  ranking, and publication count.
- The mounted Screener preserves prior publication and exposes an alert when
  a refresh completes with zero analyses; only that state says prior results
  remain visible.

Existing aggregation, global-ranking equivalence, byte-ceiling, structural
validation, retry, abort, supersession, late-response, kill-switch, refresh,
and prior-publication tests remain in place.

### 12.4 Validation and acceptance state

| Check | Command | Result |
|---|---|---|
| Focused transport + mounted page | `npm test -- lib/recommendations/__tests__/screenerRecommendationTransport.test.ts app/screener/__tests__/ScreenerPage.test.tsx` | Blocked before collection, exit 127: `vitest: command not found`. |
| Complete suite (single attempt) | `npm test` | Blocked before collection, exit 127: `vitest: command not found`. |
| TypeScript (single attempt) | `tsc --noEmit -p tsconfig.json` | Blocked immediately, exit 127: `command not found: tsc`. |
| Production build (single attempt) | `npm run build` | Blocked before compilation, exit 127: `next: command not found`. |

Dependencies were not inspected, installed, or repaired. These are environment
blockers, not passing results and not product-code failures.

WA-0005 remains unaccepted, unmerged, and awaiting Paul’s review plus a repeat
Vercel broad-scan/refresh validation with the diagnostic summary captured. No
files were staged, committed, pushed, merged, or stashed.

---

## 11. Preview HTTP 413 Corrective Round

### 11.1 Trigger and confirmed rejection boundary

Paul's Vercel preview test completed a broad Ranked Scan with 9,425 raw
`ScreenResult` records, then Ranked Opportunities failed with:

`Recommendation engine request failed (413)`

The production path was confirmed directly:

1. `app/screener/page.tsx` serialized the complete current `results` array as
   `JSON.stringify({ screenResults: results })`.
2. The browser sent that single body to
   `POST /api/autopilot/recommendations`.
3. `app/api/autopilot/recommendations/route.ts` could only begin application
   parsing at `await request.json()`.

Vercel's documented Function request-body ceiling is 4.5 MB. A request above
that limit is rejected by Vercel's Function ingress with
`413 FUNCTION_PAYLOAD_TOO_LARGE`, before the Next.js route can execute
`request.json()`. Increasing a Next.js parser limit would therefore not reach
or correct this boundary.

### 11.2 Representative measurement and root cause

A representative 9,425-record payload, populated with the real
`ScreenResult`, `SpreadCandidate`, check, and trend shapes, measured:

- Original `{"screenResults":[...]}` body: **26,740,262 bytes**
  (approximately 26.74 MB).
- The same eligible population after the existing canonical
  `screenResultsToAutopilotCandidates()` projection:
  **8,355,822 bytes** (approximately 8.36 MB).

Compaction removes scan-only fields that the recommendation engine never
consumes, but the complete eligible candidate population still exceeds
Vercel's 4.5 MB ingress ceiling. The root cause is therefore not option-chain
acquisition or application JSON parsing: it is a single, unbounded browser
request containing the complete large scan-result population.

The browser was not sending complete option chains: each serialized
`ScreenResult` contained one selected `bestCandidate` plus scan checks and
trend metadata. The combined 9,425-record envelope—not chain acquisition—was
the rejected payload.

### 11.3 Selected correction

The correction is a narrow combination of canonical compaction and
deterministic byte-bounded batching:

- `lib/recommendations/screenerRecommendationTransport.ts` calls the existing
  `screenResultsToAutopilotCandidates()` exactly once over the complete
  original scan output. Eligibility therefore remains governed by the
  original scan's `qualified` flag, `bestCandidate`, supported-strategy set,
  and leg construction. Later UI sorting/filtering never shrinks the
  evaluation population.
- The resulting canonical `AutopilotCandidate[]` is the compact transport DTO.
  No second candidate model or eligibility engine was created.
- Candidate groups are partitioned by actual UTF-8 byte length of the exact
  JSON request body, never by candidate count.
- The enforced request ceiling is now **900,000 bytes**, leaving a
  **3,600,000-byte request margin** below Vercel's documented
  4,500,000-byte limit. The earlier 1,000,000-byte ceiling was lowered after
  measuring the complete real route envelope (§11.8), not retained on
  assumption.
- Requests are sequential because `runRecommendationEngine()` already owns a
  per-user run lock; concurrent batches would contend with the canonical
  engine rather than improve correctness.
- `app/api/autopilot/recommendations/route.ts` accepts the compact candidate
  array, validates the exact Screener transport shape (supported strategy,
  positive finite underlying price, finite credit, nonnegative finite maximum
  loss, nonempty structurally valid option legs, and every optional
  candidate/leg field consumed by scoring when present). Optional numbers
  must be finite; enumerated/date/timestamp/string/notes metadata must match
  its declared structural type. No new financial range or threshold is
  imposed. The route then delegates unchanged to
  `runRecommendationEngine()`. This is boundary protection, not a second
  financial eligibility/scoring policy. Its legacy
  small-`ScreenResult[]` contract remains available for compatible callers.

### 11.4 Completeness, uniqueness, and canonical ranking

Every scan result is accounted for exactly once by the existing canonical
adapter:

- eligible results produce one `AutopilotCandidate`;
- unqualified, unsupported, or non-representable results remain in the
  canonical `skipped` disclosure;
- no first-N truncation, display-filter truncation, or arbitrary sampling is
  performed.

The existing candidate pipeline's duplicate identity is based on normalized
symbol, strategy, and ordered leg economic structure. The transport uses the
same identity only as an affinity key to keep duplicate-equivalent candidates
inside one request. It does not drop or choose between them. The existing
canonical pipeline still makes the retain/drop decision and returns its
inspectable `DuplicateCandidateRecord`, so partitioning does not let a
cross-batch duplicate evade canonical deduplication.

Every batch returns unranked canonical `DecisionAnalysis[]`. The browser
aggregates all successful batches first, then calls the existing
`opportunityRecommendationsFromApiResponse()` once. That function still calls
the unchanged `buildOpportunityRecommendations()` with
`availableCapital: 0`, and the unchanged Opportunity Engine performs its
canonical two-pass global ranking across the complete aggregate. A transport
batch is never individually published as a completed ranked evaluation.

### 11.5 Failure, cancellation, refresh, and supersession

- If any batch fails, the aggregate promise rejects. No partial aggregate is
  returned or published as success.
- If any successful route response reports `killSwitchActive: true`, the
  transport stops immediately. It sends no later batch, discards every
  earlier recommendation/duplicate/count accumulated in the browser, and
  constructs the canonical coherent paused outcome: zero recommendations,
  zero duplicates, zero candidates scanned, kill switch active. A distinct
  `RecommendationEvaluationPausedError` then routes that outcome through the
  existing page failure lifecycle, so a prior successful publication is
  preserved and the current paused state is disclosed as an alert. No mixed
  pre-pause/post-pause set can reach ranking or publication.
- The existing `/screener` failure path sets the truthful error state while
  preserving the last successful `opportunityRecommendations`,
  `rawAnalyses`, and `generatedAt`.
- Browser abort alone does not stop a request that already entered
  `runRecommendationEngine()`: the older server run can finish and retain the
  per-user Redis lock during that interval. The route now classifies only the
  engine's exact pre-run lock-contention error as HTTP 409 with
  `code: "AUTOPILOT_ENGINE_BUSY"` and `retryable: true`. All other failures
  remain non-retryable errors.
- The current evaluation retries only that explicit 409. Waiting uses
  abortable exponential backoff (500 ms, 1 s, 2 s, 4 s, then 5 s capped),
  with at most 12 retries after the initial attempt (47.5 seconds maximum
  scheduled wait; 13 total attempts). There is no tight polling. Exhaustion
  rejects with an explicit "not published" failure.
- One `AbortController` is owned by each results-triggered evaluation. React
  effect cleanup aborts an in-flight fetch or pending retry wait when a newer
  scan supersedes it or the page unmounts. Thus only the current effect can
  continue retrying.
- The existing committed results-affecting job identity and `cancelled` guard
  remain in force. An older late response cannot publish or overwrite a newer
  evaluation.
- First evaluation, refresh-with-prior-results, refresh failure, Mission
  Control lifecycle, Targeted Scan exclusion, cache restoration, and hard
  reload behavior remain owned by the existing WA-0005 state machinery.
- `beginRecommendationsEvaluation()` fires once for the complete evaluation;
  `publishRecommendations()` fires once only after all batches succeed;
  `failRecommendationsEvaluation()` fires once on a non-supersession failure.

### 11.6 Stateful backend attempts across transport batches

Repository tracing of
`lib/autopilot/decision/recommendationEngine.ts` and its lock helper confirmed
the existing lifecycle; neither file was changed:

- Every successful batch is a real canonical engine attempt with its own run
  ID and timestamp.
- For each returned analysis, the engine appends the existing decision-log and
  `recommendation_generated` audit records, then updates the paper account's
  `lastRunAt`.
- Those records describe candidate evaluation activity. They are not the
  `/screener` Recommendation Service publication, and they do not represent a
  trade or order. The browser still publishes exactly once only after every
  batch has succeeded.
- If a later batch fails, earlier successful attempt records remain. Erasing
  them would make the audit trail less truthful: those candidates really were
  evaluated. `lastRunAt` likewise records the latest successful engine
  activity, not completion of the browser's logical aggregate.
- Lock retries cannot duplicate those records. The retryable 409 is emitted
  when lock acquisition fails, before candidate evaluation or persistence
  starts. A normal 500, network failure, malformed response, or response loss
  is never retried; this avoids replaying a run that may already have
  completed server-side.
- A superseded server run may still finish and persist its truthful evaluation
  records. The newer results-affecting evaluation is a distinct attempt; it
  waits for the lock and may create its own records, while the older browser
  effect is prevented from publishing by abort plus the existing `cancelled`
  guard.
- A kill-switch response is also a truthful canonical attempt record. If the
  switch is already active, the first batch creates the engine's one
  `autopilot_paused` audit and the transport stops, avoiding one paused audit
  per planned batch. If the switch activates after an earlier batch, the
  earlier batch's truthful evaluation records remain and the paused batch
  creates its canonical paused audit, but the browser discards the mixed
  aggregate and preserves the prior publication.

Changing these records into a single atomic multi-request backend transaction
would require changing the forbidden canonical decision/persistence lifecycle.
The correction therefore preserves the existing truthful per-attempt audit
semantics and constrains retries at the transport boundary.

### 11.7 Files in this correction

Created:

- `lib/recommendations/screenerRecommendationTransport.ts`
- `lib/recommendations/__tests__/screenerRecommendationTransport.test.ts`
- `app/api/autopilot/recommendations/__tests__/route.test.ts`

Modified:

- `app/screener/page.tsx`
- `app/screener/__tests__/ScreenerPage.test.tsx`
- `app/api/autopilot/recommendations/route.ts`
- `lib/recommendations/index.ts`
- `docs/implementation/WA-0005-Opportunities-Workspace-Implementation-Report.md`
- `planning/SPRINT_STATUS.md`

Explicitly excluded and unchanged:

- `docs/design/WA-0005-Opportunities-Workspace-CES.md` (frozen)
- `lib/opportunity-engine/`
- `lib/decision-engine/`
- `lib/autopilot/decision/`
- `tsconfig.tsbuildinfo`

### 11.8 Automated evidence, payload measurements, and remaining preview gate

The new transport tests cover the representative 9,425-result population,
actual serialized-byte enforcement, variable-sized candidates, no omission,
no duplicate transport, duplicate-affinity co-location, normal small scans,
complete-set canonical ranking equivalence, whole-evaluation failure, and
supersession cancellation. They additionally cover explicit-lock-only retries,
abort during retry wait, bounded exhaustion, non-retry of genuine failures,
kill switch on the first batch, kill switch after an earlier successful
batch, partial-aggregate discard, and no request after a paused response. The
route tests cover compact-candidate acceptance, every required and optional
candidate/leg validation field, exact lock classification, genuine failure
classification, backward compatibility, and the complete response
measurement described below.

`app/screener/__tests__/ScreenerPage.test.tsx` mounts the real page and drives
the TaskManager completion/results lifecycle directly for these
transport-lifecycle cases (it does not claim those particular cases click the
button/command bus). They prove: a small scan makes one request; an oversized
broad result set makes multiple exact byte-bounded requests; nothing is
published after the first batch; the complete aggregate publishes once; a
later batch failure is disclosed and preserves the prior publication; a newer
results-affecting job encounters an older run's temporary 409, retries,
publishes successfully, and remains authoritative after the older response
arrives late; first-batch and mid-evaluation kill-switch responses stop later
requests, publish no mixed results, and preserve a prior successful
publication with an explicit current-state error. The pre-existing refresh
tests separately drive the real button/command bus. Existing Targeted Scan
exclusion coverage remains in force.

Response-side evidence now comes from the actual
`POST /api/autopilot/recommendations` route test, not a reduced synthetic
transport response. The mocked `RecommendationRunResult` includes every real
field: run ID, timestamp, user, mode/live flags, full config, populated
portfolio state, populated paper account, scanned/approved/rejected/suppressed
counts, detailed canonical analyses, duplicates, and kill-switch state. Each
analysis has populated confidence framework, evidence, concerns, alternatives,
review triggers, expected outcome, opportunity score, candidate/legs, and
metadata. The test reads `NextResponse.text()` and measures its exact UTF-8
body.

Exact standalone serialization of that same route-test fixture produced:

- Candidate count in the maximum 900,000-byte batch: **831**
- Exact request body: **899,125 bytes**
- Exact complete `NextResponse` JSON body: **3,392,383 bytes**
- Response headroom below 4,500,000 bytes: **1,107,617 bytes**
  (approximately **24.6%**)

For comparison, the complete fixture at the earlier 1,000,000-byte ceiling
measured 3,767,948 response bytes with only 732,052 bytes of headroom. That
evidence caused the ceiling reduction to 900,000 bytes. No response fields
needed by ranking, explanations, inspection, or backend lifecycle reporting
were removed.

Automated tests use mocked external market-data dependencies and cannot prove
the Vercel deployment boundary by themselves. WA-0005 remains unmerged, not
accepted, and awaiting Product Owner preview acceptance. Paul must repeat the
broad Vercel preview scan before acceptance.

### 11.9 Final validation results

The active checkout contains no installed project dependencies. Per the frozen
instruction, no dependency installation or environment replacement was
attempted.

| Check | Exact command | Result |
|---|---|---|
| Touched targeted suites | `npm test -- lib/recommendations/__tests__/screenerRecommendationTransport.test.ts app/api/autopilot/recommendations/__tests__/route.test.ts app/screener/__tests__/ScreenerPage.test.tsx lib/recommendations/__tests__/RecommendationService.test.ts lib/command-center/__tests__/screenerOpportunityRecommendations.test.ts lib/command-center/__tests__/screenerRankedOpportunitiesState.test.ts components/opportunity-engine/__tests__/BestOpportunitiesPanel.test.tsx components/mission-control/__tests__/NewOpportunitiesSection.test.tsx components/mission-control/__tests__/MissionControl.test.tsx` | **Blocked/inconclusive**, exit 127 in 0.18s: `vitest: command not found`. Zero test files or tests started; no test failure or product-code error was emitted. |
| Full repository suite | `npm test` | **Blocked/inconclusive**, exit 127 in 0.14s: `vitest: command not found`. Zero test files or tests started; no test failure or product-code error was emitted. |
| TypeScript | `tsc --noEmit -p tsconfig.json` | **Blocked/inconclusive**, exit 127 immediately: `tsc: command not found`. No TypeScript diagnostic or product-code error was emitted. |
| Production build | `npm run build` | **Blocked/inconclusive**, exit 127 in 0.16s: `next: command not found`. Compilation never started; no product-code build error was emitted. |
| Whitespace | `git diff --check` | **Clean**, exit 0, no output. |
| Frozen/semantic directories | `git diff --exit-code 55a4993 -- docs/design/WA-0005-Opportunities-Workspace-CES.md lib/opportunity-engine lib/decision-engine lib/autopilot/decision` | **Clean**, exit 0, no diff. |
| Capital contract | `rg -n "availableCapital:\s*0" lib/command-center/screenerOpportunityRecommendations.ts` | Confirmed unchanged at line 72. |

The missing dependency executables are an environment-state blocker, not a
passing validation result. The new tests remain unexecuted in this workspace
and must be run in the dependency-complete CI/Vercel environment before
acceptance.

## Appendix: Prior Rounds (unchanged, summarized only)

Round 1 (7 findings) and round 2 corrected Mission Control's embedded-full-panel violation of WA-0001's ownership ruling, the capital-limitation notice's placement gap in states 2/5, a missing partial-evaluation disclosure, the original invented `scanRunIdRef` counter (replaced with the round-3 ref-based `useLatestResultsAffectingJobId`, itself found to have the phase-coupling defect round 3 fixed, and now further corrected this round to committed store state), and accessibility/touch-target gaps. Round 3 (4 findings) renamed the section heading, corrected the capital-notice gating, replaced the ref-during-render mechanism with a ref-during-render mechanism that still had a soundness defect (this round's Defect 2), added real-TaskManager-triggered page tests with a disclosed reused-task-id simplification (this round's Defect 2), and corrected the report's own honesty. None of that work is re-described in full here — see `git log`/diff history for the complete account.

**Status: implementation complete and awaiting Product Owner review.** WA-0005 is not accepted, merged, or closed.
