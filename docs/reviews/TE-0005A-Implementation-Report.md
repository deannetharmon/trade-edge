# TE-0005A Implementation Report

## 1. Executive Summary

Ranked Scan now runs as a background task owned by the Task Manager, dispatched through the Command Bus, instead of living in page-local `runScreen()` state. This is the first real integration of TE-0003 (Task Manager) and TE-0004 (Command Bus).

What changed:
- 26 shared scan helpers were mechanically extracted from `app/screener/page.tsx` into `lib/scans/` (Phase 1, previously reviewed).
- A new `lib/scans/ranked-scan-runner.ts` runs the rank-only scan loop standalone, with progress reporting and cooperative cancellation.
- `lib/commands/command-handlers.ts` now registers `START_RANKED_SCAN` and `CANCEL_TASK`, wiring the runner to `TaskManager`.
- `app/screener/page.tsx`'s two Rank-mode trigger points now dispatch `START_RANKED_SCAN` instead of calling `runScreen()` directly, and a reconnect effect re-attaches to the active/completed task on mount.

Stayed within TE-0005A scope: no global notifications, no Task Center UI, no Screener (Filter/Targeted) migration, no Portfolio AI or Autopilot changes. Filter and Targeted modes still run entirely inside `runScreen()`/`runTargetedScan()`, untouched.

## 2. Files Changed

**Created:**
- `lib/scans/types.ts`, `constants.ts`, `scan-utils.ts`, `tastytrade-client.ts`, `spread-finder.ts`, `checklist.ts`, `rank-scoring.ts`, `trend.ts` (Phase 1 — helper extraction)
- `lib/scans/ranked-scan-runner.ts` (Phase 2 — background orchestration)

**Modified:**
- `app/screener/page.tsx` — Phase 1: import block only. Phase 2: added ranked-scan task state, reconnect effect, `startRankedScanTask()` helper, and swapped both Rank-mode trigger call sites.
- `lib/commands/command-handlers.ts` — registered `START_RANKED_SCAN` and `CANCEL_TASK`.
- `components/commands/CommandProvider.tsx` — now reads `TaskManager` from the enclosing `TaskProvider` and passes it into `registerCommandHandlers`.

## 3. Helper Extraction

All 26 helpers moved verbatim (mechanical extraction, byte-for-byte copy — no logic rewritten):

| Helper | Original location | New location | Behavior changed |
|---|---|---|---|
| `getAccessToken` | `app/screener/page.tsx` | `lib/scans/tastytrade-client.ts` | No |
| `ttFetch` | same | same | No |
| `getMarketMetrics` | same | same | No |
| `getQuote` | same | same | No |
| `getChain` | same | same | No |
| `classifyUnderlying` | same | same | No |
| `getTrend` | same | `lib/scans/trend.ts` | No |
| `normalizeTickerToken` | same | `lib/scans/scan-utils.ts` | No |
| `runChecklist` | same | `lib/scans/checklist.ts` | No |
| `exploreAllCandidatesForRank` | same | `lib/scans/rank-scoring.ts` | No |
| `findBestIC` | same | `lib/scans/spread-finder.ts` | No |
| `findBestSpread` | same | same | No |
| `findBestICUnfiltered` | same | same | No |
| `findBestSpreadUnfiltered` | same | same | No |
| `scoreCandidate` | same | `lib/scans/rank-scoring.ts` | No |
| `scoreBuffer` | same | same | No |
| `daysUntil` | same | `lib/scans/scan-utils.ts` | No |
| `calcSpreadPop` | same | same | No |
| `normalizeIv` | same | same | No |
| `formatDisplayDate` | same | same | No |
| `estimateNextEarningsDate` | same | same | No |
| `trySpreadAtWidth` | same | `lib/scans/spread-finder.ts` | No |
| `tryICSideAtWidth` | same | same | No |
| `getWidthSteps` | same | `lib/scans/scan-utils.ts` | No |
| `getBidAskMax` | same | same | No |
| `normalCdf` | same | same | No |

**Extracted types** (`lib/scans/types.ts`): `CheckResult`, `SpreadCandidate`, `TrendResult`, `ScreenResult`, `RankConfig`, `DimensionScore`, `RawScanEntry`

**Extracted constants** (`lib/scans/constants.ts`): `INDEX_IVR_MIN`, `RANK_SCAN_DTE_MIN`, `RANK_SCAN_DTE_MAX`, `ESTIMATED_EARNINGS_CYCLE_DAYS`, `DEFAULT_RULES`, `RulesType`, `DEFAULT_ETF_RULES`, `YAHOO_INDEX_CHART_MAP`, `BASE`, `CLIENT_ID`, `LS_ACCESS_TOKEN`, `LS_ACCESS_TOKEN_EXPIRY`

**Extracted shared state**: `classificationCache` (the `Map` backing `classifyUnderlying`'s memoization) — same single shared instance, now living in `tastytrade-client.ts`.

`runScreen()` and `runTargetedScan()` were diffed byte-for-byte before/after extraction and are identical.

## 4. Ranked Scan Flow

**BEFORE:**
```
Page (screener/page.tsx)
  ↓
runScreen(mode='rank')          ← page-local async function
  ↓
page-local state (results, loading, status, error, rawScanCache)
  ↓
unmounts if user navigates away → scan is abandoned
```

**AFTER:**
```
Page (screener/page.tsx)
  ↓
useCommandBus().dispatch({ type: 'START_RANKED_SCAN', payload })
  ↓
CommandBus → START_RANKED_SCAN handler (lib/commands/command-handlers.ts)
  ↓
TaskManager.createTask({ kind: 'ranked-scan' }) → TaskManager.startTask()
  ↓
runRankedScan() (lib/scans/ranked-scan-runner.ts) — runs independently of the page
  ↓
TaskManager.updateProgress() per ticker scanned
  ↓
TaskManager.completeTask(result) / failTask() / cancelTask()
  ↓
Page reconnects via useTask(taskId) — finds the task by kind on mount,
mirrors its status/result into the same results/loading/status/error
state the UI already renders from
```

The task lives in the `TaskManager` instance mounted at the app root (`app/providers.tsx`), which survives the Screener page unmounting on navigation — so the scan keeps running and the page can reattach to it later.

## 5. Public APIs

**`lib/scans/ranked-scan-runner.ts`**
- `runRankedScan(input: RankedScanInput, onProgress?, signal?): Promise<RankedScanResult>`
- `RankedScanInput { activeSymbols, sRules, eRules, sLabel?, eLabel?, rankConfig }`
- `RankedScanResult { results: ScreenResult[], rawScanCache: RawScanEntry[] }`
- `RankedScanProgress { label, completed, total }`
- `RankedScanCancelledError` — thrown when the `AbortSignal` fires; callers treat this as "cancelled," not "failed"

**`lib/commands/command-handlers.ts`**
- `registerCommandHandlers(bus: CommandBus, taskManager: TaskManager): () => void` — signature changed from TE-0004 (now takes `taskManager` too)
- `StartRankedScanResult { taskId: string }`
- `CancelTaskPayload { taskId: string }`

No changes to `lib/tasks/*` or `lib/commands/command-bus.ts`/`command-types.ts` public APIs — TE-0004's shapes were sufficient.

## 6. Provider / Handler Wiring

- **Registration:** `CommandProvider` (mounted inside `TaskProvider` since TE-0004) now calls `useTaskManagerContext()` to get the same `TaskManager` instance the rest of the app uses, and passes it into `registerCommandHandlers(bus, taskManager)` in a `useEffect`.
- **Task creation:** the `START_RANKED_SCAN` handler calls `taskManager.createTask({ kind: 'ranked-scan', ... })` then `taskManager.startTask(task.id)`, synchronously, before returning `{ taskId }` to the caller.
- **Task updates:** `runRankedScan()` is invoked with a progress callback that calls `taskManager.updateProgress(task.id, pct, label)` after each ticker. This runs fire-and-forget — dispatch resolves immediately with the `taskId` so the page doesn't block on the whole scan.
- **Completion/failure/cancellation:** the handler's `.then()/.catch()` on the runner's promise calls `completeTask(result)`, `failTask(message)`, or `cancelTask()` (if the error is a `RankedScanCancelledError`).
- **Page reconnect:** on mount, or whenever `screenMode` becomes `'rank'`, the page filters `useTaskManager().tasks` for `kind === 'ranked-scan'`, takes the most recently created one, and tracks its `id` in local state. `useTask(taskId)` then subscribes to that task's live updates, and a separate effect mirrors `status`/`progressLabel`/`result`/`error` into the page's existing `results`/`loading`/`status`/`error` state — no new rendering path was added.

## 7. Build Results

`npx tsc --noEmit`: clean, zero errors.

`npm run build`: passed. All 39 routes generated. `/screener` bundle: 46.4 kB route-specific (down from 57.1 kB pre-extraction — scan logic now lives in a shared chunk), First Load JS 149 kB (up from 145 kB, expected: now also pulls in command-bus/task-manager hooks).

`npm run lint`: not available — no ESLint config in this repo (unchanged from prior tickets).

## 8. Manual Test Results

**Important scope note:** I don't have a live browser session or TastyTrade credentials in this sandbox, so I could not perform the ticket's literal 9-step manual smoke test (open app, click Rank, navigate away, come back, watch it render). What I verified instead, at the code level:

- Can I start Ranked Scan? — Both trigger paths (`RunModeModal` and `RulesModal` re-run) now correctly call `startRankedScanTask()`, confirmed by reading the modified call sites and the `dispatch()` → handler → `createTask()`/`startTask()` chain.
- Can I leave the page? — `TaskManager` is instantiated once at `app/providers.tsx` (app root), not inside the Screener page component, so it isn't torn down on navigation. Confirmed by provider tree inspection.
- Does the scan continue? — `runRankedScan()` runs as a detached promise inside the command handler, not inside any React component lifecycle — nothing about it depends on the Screener page being mounted.
- Can I return? — The reconnect `useEffect` runs on every mount and whenever `screenMode` becomes `'rank'`, and doesn't require the task ID to have been persisted anywhere the page controls — it looks the task up fresh from `TaskManager` each time.
- Are results preserved? — `completeTask(result)` stores the full `RankedScanResult` on the task record in memory; the reconnect effect reads `task.result` and calls the same `setResults`/`setRawScanCache` the old `runScreen()` path used.
- Regressions: none identified in Filter/Targeted — both diffed byte-identical pre/post extraction, and neither trigger path was touched in Phase 2.

I recommend you run the actual 9-step smoke test from the ticket (start scan → navigate to Portfolio → wait → return → confirm running/completed → confirm results render → confirm no blank pages → confirm no console errors) before merging, since that's real-browser behavior I can't replicate here.

## 9. Diff Statistics

Phase 2 only (`feat(scans): run ranked scan as background task`):
```
$ git diff --stat HEAD~1 HEAD
 app/screener/page.tsx                   |  97 +++++++++++++++++++++++-
 components/commands/CommandProvider.tsx |  22 ++++--
 lib/commands/command-handlers.ts        | 110 ++++++++++++++++++++++++---
 lib/scans/ranked-scan-runner.ts         | 130 ++++++++++++++++++++++++++++++++
 4 files changed, 340 insertions(+), 19 deletions(-)
```

Combined, both TE-0005A commits (helper extraction + background task wiring):
```
 app/screener/page.tsx                   | 1873 ++----------------------
 components/commands/CommandProvider.tsx |   22 +-
 lib/commands/command-handlers.ts        |  110 +-
 lib/scans/checklist.ts                  |  233 +++
 lib/scans/constants.ts                  |   41 +
 lib/scans/rank-scoring.ts               |  401 +++++
 lib/scans/ranked-scan-runner.ts         |  130 ++
 lib/scans/scan-utils.ts                 |  126 ++
 lib/scans/spread-finder.ts              |  213 +++
 lib/scans/tastytrade-client.ts          |  259 ++++
 lib/scans/trend.ts                      |  487 ++++++
 lib/scans/types.ts                      |  115 ++
 12 files changed, 2245 insertions(+), 1765 deletions(-)
```

## 10. Technical Debt

**Known limitations:**
- No cancel button exists yet in the UI — `CANCEL_TASK` is wired end-to-end (dispatchable, aborts the runner, marks the task cancelled) but nothing in the page calls it. Intentional per scope (no Task Center UI, no new visible UI this ticket).
- Task results are memory-only (per ADR-0001/TE-0005A explicitly allowing this) — a page refresh loses the task and its result, unlike Filter/Targeted's IndexedDB-cached results. Rank mode results are not written to `IDB_RESULTS_KEY`/`IDB_RAW_SCAN_KEY` when sourced from a task.
- Cancellation is cooperative and checked only between ticker iterations — a slow in-flight `getChain`/`getTrend` call for the current ticker will still complete before the abort takes effect, per ADR-0003's documented trade-off.
- Only one ranked-scan task's worth of history is meaningfully reachable from the page (it always reconnects to the *most recent* one) — multiple concurrent ranked scans aren't distinguished in the UI.

**Deferred / future improvements:**
- Persisting task results (IndexedDB) so a refresh doesn't lose a completed Rank scan.
- A visible cancel affordance once Task Center UI exists (TE-0006 per TE-0002's roadmap).
- Reconsidering whether `CANCEL_TASK` should force-mark a task cancelled even with no active controller (currently a no-op in that case).

## 11. Architecture Assessment

**What I'd improve:** the reconnect effect currently always grabs the *latest* `ranked-scan` task by `createdAt` — fine for a single-user, single-tab today, but if Autopilot Paper Mode (TE-0007+) or a future multi-tab scenario starts creating `ranked-scan`-adjacent tasks, "latest of this kind" stops being a safe reconnect heuristic. I'd want an explicit task-ownership or task-origin tag before that happens.

**Concerns:** the command handler owns real orchestration logic now (progress mapping, error-vs-cancel branching) — it's still thin, but it's the first handler with actual behavior instead of a stub, and it's a good point to watch for the handler layer quietly absorbing business logic that should stay in the runner.

**What to watch during TE-0005B:** if TE-0005B is Task Center UI, the main risk is the temptation to have UI components reach past `useTaskManager()`/`useTask()` and query `lib/tasks` internals directly for convenience — worth keeping the hook boundary strict. Also worth deciding then whether Rank task results should move from memory-only to IndexedDB-backed, since a visible Task Center will make the "refresh loses your scan" limitation much more noticeable to Dean than it is today.
