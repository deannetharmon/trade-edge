# RF-0001 Implementation Report

## 1. Executive Summary

Extracted Ranked Scan's orchestration logic and one rank-only display piece out of `app/screener/page.tsx` into a new `features/screener/` module, per ADR-0004's feature-oriented architecture direction. Pure refactor — no behavior, UI, formula, or scoring change. `runScreen()` and `runTargetedScan()` (Filter/Targeted) were diffed byte-for-byte before/after and are identical. Build passes clean.

Deviated from the ticket's suggested 4-component split (`RankedScanPanel`/`RankedToolbar`/`RankedProgress`/`RankedResultsTable`) — see §3 for why, and §10/§11 for what a fuller split would require.

## 2. Files Changed

**Created:**
- `features/screener/types.ts` — 39 lines
- `features/screener/hooks/useRankedScan.ts` — 110 lines
- `features/screener/components/RankedScoreTierSummary.tsx` — 28 lines

**Modified:**
- `app/screener/page.tsx` — 5,946 → 5,864 lines. Removed the inline task-orchestration block and inline score-tier JSX; added a `useRankedScan()` call and a `<RankedScoreTierSummary />` usage; renamed two call sites (`startRankedScanTask` → `startRankedScan`) to match the hook's return.

## 3. Components/Hooks Extracted

**`useRankedScan(params)`** — the entire Ranked Scan orchestration TE-0005A added to the page: task reconnect-on-mount, task-state mirroring into `results`/`loading`/`status`/`error`, and `startRankedScan()` (dispatches `START_RANKED_SCAN`, tracks the task). Moved verbatim; only the containing scope changed (component closure → hook).

**`RankedScoreTierSummary`** — the 🟢🟡🟠🔴 score-tier count spans shown in Rank mode's results header. Pure presentational, takes `results` and `rankConfig`, same JSX/classNames/emoji as before.

**Not extracted, and why:** `ResultCard` (the results-list item renderer) is used by both Filter and Rank mode — it's genuinely shared, not Rank-only. Moving it into `features/screener/` would make Filter depend on a module that ADR-0004 scopes to Rank, and would point a dependency backwards (`app` → `features/screener` → back into `app`-shared code). I left it in `page.tsx`. Same reasoning for the shared loading spinner and the results-header toolbar (CSV button, rerun button) — these render for all three modes from one shared block, not a Rank-specific one. Extracting them would mean either duplicating them per-mode (against "avoid duplicate logic") or building a fake wrapper with no real modularity gain (against "do not over-extract"). This is why the actual split has 1 hook + 1 component rather than the suggested 4 components + 1 hook — the ticket explicitly allowed this ("exact component split may vary if the current code shape requires it").

## 4. Before/After Screener Page Responsibilities

**Before:** `page.tsx` owned Ranked Scan's task-reconnect effect, task-mirroring effect, and `startRankedScanTask` inline, alongside all Filter/Targeted logic, `ResultCard`, modals, and watchlist UI.

**After:** `page.tsx` calls `useRankedScan()` for orchestration and renders `<RankedScoreTierSummary />` for the rank-only stat line; everything else (Filter, Targeted, `ResultCard`, modals, watchlist) is unchanged in place. `page.tsx` is now a thinner orchestrator for the Rank slice specifically, per RF-0001's "keep page.tsx as orchestrator, delegate where practical" — not yet true for Filter/Targeted, which is out of scope here.

## 5. Behavior Preservation Notes

- `runScreen()` and `runTargetedScan()` — confirmed byte-identical (Python string-match diff, not just line-count) before vs. after this refactor.
- `useRankedScan()`'s internals are an unmodified copy of the block it replaced — same effects, same dependency arrays, same setter calls, same comments.
- `RankedScoreTierSummary` renders the exact same JSX (same `className`s, same emoji, same `scoreCandidate()`/threshold logic) that used to be inline.
- The two Ranked Scan trigger call sites were renamed (`startRankedScanTask` → `startRankedScan`) but not otherwise changed — same arguments, same call sites, same conditions.

## 6. Build Results

`npx tsc --noEmit`: clean, zero errors.

`npm run build`: passed. All 39 routes generated. `/screener` bundle: 46.5 kB (was 46.4 kB pre-refactor — negligible, expected from chunk-boundary shift, not a behavior change).

`npm run lint`: not available — no ESLint config in this repo (unchanged from prior tickets).

## 7. Manual Smoke Test Results

Same caveat as TE-0005A: no live browser/TastyTrade session available in this sandbox. Verified at the code level instead:

- Ranked Scan starts / navigate away / return / reconnect / results display — `useRankedScan()` is a byte-for-byte relocation of the code already verified for this in TE-0005A; the reconnect-by-task-kind logic and TaskManager's app-root lifetime are unchanged.
- Filter still works / Targeted still works — `runScreen()`/`runTargetedScan()` confirmed byte-identical; neither trigger path nor any of their internals were touched.
- No console/provider errors — `CommandProvider`/`TaskProvider` wiring untouched (RF-0001 didn't touch `app/providers.tsx` or either provider file); `tsc --noEmit` and `next build` both clean, which would surface import/type errors from a broken provider chain.

**Recommend running the live 9-step smoke test from the ticket before merging further**, same as flagged for TE-0005A.

## 8. Diff Statistics

```
$ git diff --stat HEAD~1 HEAD
 app/screener/page.tsx                              | 115 +++------------------
 features/screener/components/RankedScoreTierSummary.tsx |  28 +++++
 features/screener/hooks/useRankedScan.ts                | 110 ++++++++++++++++++++
 features/screener/types.ts                               |  39 +++++++
 4 files changed, 193 insertions(+), 99 deletions(-)
```

## 9. Technical Debt

**Known limitations:**
- `ResultCard`, the shared loading indicator, and the shared results-header toolbar remain in `page.tsx` — genuinely shared across Filter/Rank/Targeted, not extractable into a Rank-only feature module without either duplication or a cross-mode shared-UI module that's out of RF-0001's scope.
- `page.tsx` is still ~5,864 lines — this ticket made a real but modest dent (82 lines net), consistent with "do not attempt to clean up the entire Screener page in this ticket."
- `features/screener/types.ts` defines a structurally-compatible `RankedScanTickerInput` instead of importing `page.tsx`'s local `WatchlistTicker` (which isn't exported) — works via TypeScript structural typing, but means the two types can drift out of sync if `WatchlistTicker`'s shape changes without a corresponding check here.

**Deferred / future improvements:**
- A future RF ticket extracting genuinely shared results-display UI (`ResultCard`, results header) into `features/screener/components/` or a `components/screener-shared/`-type location, once Filter/Targeted also start moving — at that point it stops being "Rank importing shared code sideways" and becomes real shared infrastructure.
- Extracting Filter and Targeted's own orchestration (mirroring what TE-0005A/RF-0001 did for Rank) once TE-0005B or a follow-up RF ticket approves migrating them.

## 10. Recommendations Before TE-0005B

- If TE-0005B is Global Ranked Scan completion notifications, it's a clean next consumer of `useRankedScan()` — the hook already tracks `rankedScanTaskId`/task status internally; a notification component would want that exposed (currently it's fully private to the hook, matching "keep public APIs small," but a completion-notification feature will need at least the task's terminal status to fire a toast). Worth deciding then whether to widen the hook's return value or have the notification component use `useTaskManager()` directly (kind-filtered) rather than reaching into this hook.
- Consider whether `RankedScanTickerInput`'s structural-typing approach (vs. exporting `WatchlistTicker` from `page.tsx`) is the long-term pattern for feature-module ticker types, or whether `WatchlistTicker` itself should eventually move to a shared location (`lib/` or `features/screener/types.ts`) as more of the Screener page decomposes — right now it's a reasonable one-off, but repeating it per feature slice would fragment the ticker type across the codebase.
