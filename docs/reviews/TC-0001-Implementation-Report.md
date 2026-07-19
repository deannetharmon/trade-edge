# TC-0001 — Trade Command Center — Implementation Report

Status: **IMPLEMENTED, AWAITING PRODUCT OWNER REVIEW.** Complete on branch `feature/trade-command-center`. Not committed, not pushed, not merged. This report, together with `docs/design/TC-0001-Trade-Command-Center.md` and the accompanying `.diff` patch file, is the review package.

## 0. Pre-flight verification

- Required starting state per the Implementation Directive: `main` clean, matching `origin/main`, with ES-0002's merge commit reachable.
- `main` and `origin/main` are both at `424e068` ("Merge branch 'feature/pending-order-replacement-safety'"), i.e. ES-0002 is merged. `git merge-base --is-ancestor 424e068 HEAD` on this branch returns exit 0 — confirmed reachable.
- Branch `feature/trade-command-center` was created off this clean `main` (`git merge-base feature/trade-command-center main` returns `424e068`, i.e. no divergence beyond this branch's own uncommitted working-tree changes).
- No commits exist on this branch — all TC-0001 work is uncommitted working-tree changes, per the directive's explicit "do not commit or push" instruction.
- Required pre-flight reading completed: `TC-0001-Trade-Command-Center.md` (design spec), `TC-0001-Claude-Implementation-Directive.md` (process doc), `lib/dailyBriefing`, `lib/portfolioHealth`, `lib/todaysPriorities`, `lib/portfolioReview`, `lib/portfolio-intelligence`, `lib/opportunity-engine` (adapter + ranker), `components/opportunity-engine/BestOpportunitiesPanel.tsx`, `hooks/useTaskManager`, `components/tasks/TaskProvider.tsx`, `lib/theme.ts`, and the relevant sections of `app/portfolio/page.tsx` (its inline composition `useMemo`/`useEffect` chain, and later, in full, `loadPositions()`, lines 2249-2955).

## 1. Architecture summary

Two architecture conflicts were found between the spec's assumed structure and the actual codebase, and were escalated to the Product Owner rather than resolved by assumption (per the spec's explicit "stop and explain conflicts rather than assume" instruction). Both are documented in full, with the Product Owner's exact resolving direction, in `docs/design/TC-0001-Trade-Command-Center.md` §5.4. Summary:

1. **Shared composition logic** — `app/portfolio/page.tsx`'s private inline composition chain (canonical priorities → Today's Priorities → average position health → Portfolio Health → Portfolio Review → Daily Briefing) could not be duplicated into a second location without violating the spec's own "must not reproduce rule logic" / "do not duplicate the orchestration" requirements. Resolved by extracting it into one new shared, pure module: `lib/portfolio-intelligence/dashboardComposition.ts` (`buildDashboardComposition()`), now consumed by both `app/portfolio/page.tsx` and `app/dashboard/page.tsx`.
2. **Next.js page.tsx export restriction** — an initial attempt to export the needed helpers directly from `app/portfolio/page.tsx` broke `tsc --noEmit`, because Next.js App Router's auto-generated route-type contract only permits a small fixed set of exports from a `page.tsx` file. Resolved by redesigning `dashboardComposition.ts`'s input contract so `netEdgeDeclinePct`/`netEdgeNegative`/`remainingOpportunityPct` are pre-computed **input fields**, not values the module derives itself — eliminating any need to import from `page.tsx` at all.
3. **`loadPositions()`'s true scope** — relocating the live TastyTrade fetch-and-enrich pipeline itself (as opposed to the pure composition downstream of it) was found, on full reading, to be a ~4,000-6,000-line, tightly-coupled, safety-critical subsystem realistically verifiable only against a live TastyTrade session. This was escalated rather than attempted at that risk level without explicit sign-off. The Product Owner's direction: keep it entirely in `app/portfolio/page.tsx`, unmodified; extract only the pure downstream composition; treat live-acquisition relocation as a separate future ticket; have `/dashboard` render an honest `unavailable` state for anything it cannot yet source (see §7 below and the design doc §7).

The resulting composition boundary:

```text
Existing data sources (Portfolio Intelligence, Daily Briefing, Decision Engine, Opportunity Engine, Task Manager)
    |
    v
lib/portfolio-intelligence/dashboardComposition.ts  (buildDashboardComposition -- pure)
    |
    v
lib/command-center/buildCommandCenterViewModel.ts   (pure)
    |
    v
app/dashboard/page.tsx  -->  components/command-center/*  (presentation only)
```

`app/portfolio/page.tsx` also now calls `buildDashboardComposition()` in place of its former inline chain, preserving its existing behavior (verified in §9).

## 2. Exact files changed

**Added:**
- `app/dashboard/page.tsx` — the new route.
- `components/command-center/CommandCenter.tsx`, `CommandCenterHeader.tsx`, `CommandCenterNav.tsx`, `BriefingSummaryCard.tsx`, `PriorityListCard.tsx`, `BestOpportunityCard.tsx`, `PortfolioHealthCard.tsx`, `BackgroundTaskCard.tsx` — presentational components.
- `components/command-center/__tests__/CommandCenter.test.tsx` (7 tests)
- `lib/command-center/types.ts`, `buildCommandCenterViewModel.ts`, `buildOpportunityRecommendations.ts`, `index.ts` — the view-model composition layer.
- `lib/command-center/__tests__/buildCommandCenterViewModel.test.ts` (14 tests)
- `lib/command-center/__tests__/buildOpportunityRecommendations.test.ts` (4 tests)
- `lib/portfolio-intelligence/dashboardComposition.ts` — the shared pure composition module (Conflict 1's resolution).
- `lib/portfolio-intelligence/__tests__/dashboardComposition.test.ts` (7 tests)
- `docs/design/TC-0001-Trade-Command-Center.md`
- `docs/reviews/TC-0001-Implementation-Report.md` (this file)

**Modified:**
- `app/portfolio/page.tsx` — its former inline composition chain (`canonicalPriorities` state/effect; `todaysPrioritiesInput`/`todaysPrioritiesDashboard`, `topPriority`, `averagePositionHealth`, `healthInput`/`portfolioHealth`, `portfolioReviewInput`/`portfolioReview`, `dailyBriefingInput`/`dailyBriefing` — all `useMemo`s) was replaced with one `composition = useMemo(...)` that attaches `netEdgeDeclinePct`/`netEdgeNegative`/`remainingOpportunityPct` to each position (via its existing, unmodified `computeNetEdgeEvidence()`/`scorePortfolioRemainingOpportunity()`) and calls `buildDashboardComposition()`. Every downstream consumer of `canonicalPriorities`/`todaysPrioritiesDashboard`/`topPriority`/`averagePositionHealth`/`portfolioHealth`/`portfolioReview`/`dailyBriefing` is unchanged — they now destructure from `composition` instead of from seven separate `useMemo`s. No other function in this file was touched. `Position`, `PendingOrder`, `computeNetEdgeEvidence`, `scorePortfolioRemainingOpportunity`, `loadPositions`, `loadAccountBalances`, `fetchSnapshotStore`, `attachSnapshotHistory` remain private, unexported, and logically unchanged (an earlier attempt to export several of these was fully reverted once Conflict 2 above was resolved a different way).
- `tsconfig.tsbuildinfo` — auto-regenerated by `tsc --noEmit`; not a substantive change, consistent with every prior ticket's report.

**Not modified (per explicit scope boundary, §5.4/Conflict 3):**
- `loadPositions()`, `loadAccountBalances()`, and the rest of `app/portfolio/page.tsx`'s live TastyTrade fetch/enrichment subsystem — deliberately untouched; relocating it is an explicit future ticket, not part of TC-0001.
- Nothing in `lib/opportunity-engine`, `lib/decision-engine`, `lib/dailyBriefing`, `lib/portfolioHealth`, `lib/todaysPriorities`, or `lib/portfolioReview` — TC-0001 consumes all of these unchanged, per the spec's explicit "do not duplicate" requirement.

## 3. Real data-source inventory

| Panel | Data source | Real today? |
|---|---|---|
| Header | `buildCommandCenterViewModel()`'s own `greetingFor(now)` + `composition` presence | Real code; `composition` is always `null` on `/dashboard` this sprint (see §7) |
| Daily Briefing | `lib/dailyBriefing`'s `buildDailyBriefing()`, via `buildDashboardComposition()` | Real code path; not exercised on `/dashboard` this sprint (§7) |
| Today's Priorities | `lib/todaysPriorities`'s `buildTodaysPrioritiesDashboard()`, via `buildDashboardComposition()` | Real code path; not exercised on `/dashboard` this sprint (§7) |
| Portfolio Health | `lib/portfolioHealth`'s `calculatePortfolioHealthScore()`, via `buildDashboardComposition()` | Real code path; not exercised on `/dashboard` this sprint (§7) |
| Best Opportunity | `lib/opportunity-engine`'s real `decisionAnalysesToOpportunityCandidates()` + `rankOpportunityCandidates()`, via `lib/command-center/buildOpportunityRecommendations.ts`; rendered by the real, previously-unmounted `BestOpportunitiesPanel` | Real, fully wired pipeline; no real `DecisionAnalysis[]` feed exists anywhere in the app yet, so `app/dashboard/page.tsx` passes `[]` and the panel renders its own honest empty state |
| Background Tasks | `useTaskManager()` — the same global task list the existing status bar/task drawer read | Real and live today, no limitation |
| Navigation | Plain `next/link`s to existing routes | Real, no limitation |

`app/portfolio/page.tsx`'s own Daily Briefing/Priorities/Health/Portfolio Review sections continue to receive real, live composition (via the same `buildDashboardComposition()` function, fed real positions/balances/pending orders/decision reviews) — this refactor did not change what that page displays, only where the composition logic lives. See §9 for the regression proof.

## 4. Test results

All test files were run in this sandbox's per-command execution-time-limited environment, split into batches by directory; every batch passed.

**New TC-0001 tests (32 total):**
- `lib/portfolio-intelligence/__tests__/dashboardComposition.test.ts` — 7/7 passing
- `lib/command-center/__tests__/buildCommandCenterViewModel.test.ts` — 14/14 passing
- `lib/command-center/__tests__/buildOpportunityRecommendations.test.ts` — 4/4 passing
- `components/command-center/__tests__/CommandCenter.test.tsx` — 7/7 passing

**Full repository regression (all 74 test files, 1,034 tests, 0 failures):**

| Batch | Files | Tests | Result |
|---|---:|---:|---|
| 1 (lib: autopilot, command-center, dailyBriefing, decision-engine, decision-review, opportunity-engine, paper-trading) | 26 | 389 | ✅ |
| 2 (lib: portfolio, portfolio-intelligence, portfolioHealth, portfolioReview, position-snapshot, positionValuation, priorityScore, todaysPriorities, tradeLog) | 25 | 430 | ✅ |
| 3 (app/api/paper-trading; components/command-center, components/opportunity-engine) | 3 | 29 | ✅ |
| 4 (components/paper-trading, part 1) | 3 | 12 | ✅ |
| 5 (components/paper-trading, part 2; features/portfolio/briefing, part 1) | 3 | 18 | ✅ |
| 6 (features/portfolio/briefing, part 2) | 3 | 21 | ✅ |
| 7 (features/portfolio/briefing, part 3; features/portfolio/components) | 3 | 47 | ✅ |
| 8 (features/portfolio/dailyBriefing, decisionReview) | 3 | 30 | ✅ |
| 9 (features/portfolio/intelligence) | 3 | 28 | ✅ |
| 10 (features/portfolio/priorities, review) | 2 | 30 | ✅ |
| **Total** | **74** | **1,034** | **✅ all passing** |

This confirms: existing Portfolio Intelligence, Daily Briefing, Portfolio Health, Portfolio Review, Today's Priorities, Opportunity Engine, `BestOpportunitiesPanel`, ES-0001, ES-0002, PT-0001, and every other existing suite remain unaffected by this refactor.

## 5. TypeScript and diff-check results

- `npx tsc --noEmit` — clean, no errors.
- `git diff --check -- . ':!tsconfig.tsbuildinfo'` — clean, exit 0.

## 6. Read-only / no-execution-path confirmation

`components/command-center/__tests__/CommandCenter.test.tsx` includes an explicit assertion that the fully-composed `CommandCenter` renders zero `<button>` elements and that no rendered link's text matches `submit|execute|place order|cancel order|replace order|buy|sell`. `BestOpportunitiesPanel` (mounted, unchanged from OE-0001) is presentational only — it has no click handlers, no fetch, and no broker call anywhere in its source. No new API route, no new `ttPost`/`ttPostComplex`/`ttValidateOrder`/`ttDelete` call site, and no Autopilot activation was introduced anywhere in this diff. `app/dashboard/page.tsx` performs no network I/O of its own; its only data reads are `useTaskManager()` (existing, read-only) and pure in-memory composition calls.

## 7. Known limitations, disclosed

1. **`/dashboard` does not yet independently source live positions/balances.** `composition` is always `null` in `app/dashboard/page.tsx`, so the Daily Briefing, Today's Priorities, and Portfolio Health panels always render their `unavailable` state in production today (exact copy in `docs/design/TC-0001-Trade-Command-Center.md` §7). This is the direct, disclosed consequence of the Product Owner's Conflict 3 decision (§1 above) to keep `loadPositions()` out of this sprint. A separate, future, dedicated ticket can relocate or duplicate that live-acquisition pipeline and pass a real `DashboardComposition` through the exact same `buildDashboardComposition()` contract this page already calls — no change to this page's own logic will be required when that lands.
2. **No real `DecisionAnalysis[]` feed exists anywhere in the app.** The only producer (`POST /api/autopilot/recommendations`) requires a fresh client-POSTed `ScreenResult[]` from a completed screener scan, with no GET, persistence, or cache. `app/dashboard/page.tsx` therefore always passes `[]`, and the Best Opportunity card always renders "No ranked opportunity feed is available." This is explicitly acceptable per the Product Owner's direction (§1 above) — this sprint is not responsible for creating a new opportunity-acquisition mechanism.
3. **The `loading` panel state is reserved but not yet exercised.** No panel on `/dashboard` currently has an async data source of its own (composition is synchronously `null`; tasks come from an already-subscribed hook), so `CommandCenterPanelState`'s `'loading'` member exists in the type for forward-compatibility but has no code path that sets it today.
4. **No visual/screenshot QA.** Consistent with every prior ticket in this sandbox (production build hangs at the initial Next.js banner, a documented pre-existing environment limitation, not a regression) — verified via passing tests, `tsc --noEmit`, and code review only. Worth a manual look once deployed, especially the responsive column collapse at the `lg` breakpoint.

## 8. Acceptance criteria

See `docs/design/TC-0001-Trade-Command-Center.md` §8 for the full, item-by-item status table. Summary: all criteria are met except #1 and #5, which are partially met and explicitly disclosed (§7 above), and #16 (Product Owner review), which is what this package requests.

## 9. Commands run

```
git branch --show-current
git status / git status --short
git merge-base --is-ancestor 424e068 HEAD
git merge-base feature/trade-command-center main
npx tsc --noEmit
npx vitest run <10 batches by directory, listed in §4>
git diff --check -- . ':!tsconfig.tsbuildinfo'
git add -N -- <new TC-0001 paths>
git diff --binary -- . ':!tsconfig.tsbuildinfo' > /tmp/TC-0001-review.diff
```

## 10. Deliverables

- This report.
- `docs/design/TC-0001-Trade-Command-Center.md`.
- `/tmp/TC-0001-review.diff` — full patch (binary-safe, `tsconfig.tsbuildinfo` excluded), covering all 18 new files and the one modified file listed in §2.
- Updated `docs/roadmap/ROADMAP.md`, `planning/SPRINT_STATUS.md`, `docs/HANDOFF.md` (see those files for the exact updates, including ES-0002's status corrected to Complete/Merged/`424e068`/branch deleted, matching the repository's actual current state).

No commit, push, or merge has been made. This package is for Product Owner review before any of those steps.

---

## 11. Corrective Round Addendum

### 11.1 Why this addendum exists

The Product Owner rejected the round documented in §1–§10 above. Verdict: the architecture (shared composition extraction, framework-independent view model, real Opportunity Engine wiring) was correct, but the product outcome was not — `/dashboard` rendered Daily Briefing, Today's Priorities, and Portfolio Health as `unavailable` and had no real live portfolio data, which defeated the sprint's purpose. The root cause identified: treating "relocate the entire live-loading subsystem" and "leave `/dashboard` disconnected" as the only two options, when a narrower sharing seam was available. The Product Owner's corrective directive: find the narrowest architectural seam that lets `/portfolio` and `/dashboard` consume the same canonical live portfolio composition, without relocating or duplicating the entire acquisition pipeline, and without inventing a second live-acquisition path. §11.2–§11.8 below document what changed to satisfy that directive. Everything in §1–§10 above that was **not** rejected — the composition/view-model layering, the real Opportunity Engine wiring, the read-only guarantees, the test structure, the documentation approach — is unchanged and still accurate.

### 11.2 Corrective architecture: shared `PortfolioDataProvider`

Before writing any relocation code, the true size of `loadPositions()`'s dependency closure was measured directly rather than assumed. §1/§5.4 Conflict 3 (original round) had estimated "~4,000–6,000 lines, too risky to touch" from a read-through; this round instead ran an automated, iterative closure-check (starting from `loadPositions()`/`loadAccountBalances()` and transitively including every top-level symbol they call or reference, repeating until no missing dependency remained) against the actual file. The verified, closed result: **60 symbols, ~1,621 lines total**, entirely free of React hooks, JSX, or any other browser-page-specific coupling — i.e., a plain-TypeScript module in every case, just one that happened to live inside a `.tsx` route file.

Given that measured (not assumed) scope, the approved corrective architecture is:

1. **Relocate** (not duplicate) those 60 symbols verbatim into three new plain modules: `lib/tastytrade/client.ts` (4 symbols: `BASE`, `CLIENT_ID`, `getAccessToken`, `ttFetch`), `lib/portfolio-data/types.ts` (15 type/interface symbols), and `lib/portfolio-data/acquisition.ts` (41 symbols, including `loadPositions` and `loadAccountBalances` themselves). No logic was changed during this move — see §11.3 for the full audit table.
2. **Introduce one new shared Context Provider**, `components/portfolio-data/PortfolioDataProvider.tsx`, mounted once at the app-shell root (`app/providers.tsx`, alongside the existing `TaskProvider`). It owns the state (`positions`, `pendingOrders`, `balances`, `decisionReviews`, `loading`, `error`, `lastRefresh`, `composition`) and the three async actions (`refresh()`, `refreshBalances()`, `refreshDecisionReviews()`) that call the relocated `loadPositions()`/`loadAccountBalances()`.
3. **Both `app/portfolio/page.tsx` and `app/dashboard/page.tsx` now call `usePortfolioData()`** to read this same state and trigger the same refresh functions, each in its own mount-time `useEffect` — so each page still fetches fresh data on every visit, exactly as `app/portfolio/page.tsx` always has, but from one shared live acquisition pipeline instead of two.
4. **`app/portfolio/page.tsx`'s two snapshot-history side effects** (`captureSnapshotsIfNeeded`, `captureLifecycleSnapshotsIfNeeded`) remain private to that file — the closure-check proved they are not called by `loadPositions()`/`attachSnapshotHistory()`/any of the 60 relocated symbols, so moving them was unnecessary. They are passed into `PortfolioDataProvider.refresh()` as optional callbacks (`onRawPositionsLoaded`, `onSnapshotHistoryAttached`) invoked at the exact same two call sites/timing as before. `app/dashboard/page.tsx` omits these callbacks, so no duplicate snapshot write occurs if both pages are open in the same browser session.

### 11.3 Relocation audit table (60 symbols)

Old locations are line numbers in `app/portfolio/page.tsx` as it stood at the start of this corrective round (the TC-0001A/B baseline documented in §1–§10 above, 10,906 lines, before this round's edits). All symbols were relocated verbatim — no signature, logic, or behavior change.

**→ `lib/tastytrade/client.ts`**

| Symbol | Kind | Old location (`app/portfolio/page.tsx`) |
|---|---|---|
| `BASE` | const | line 161 |
| `CLIENT_ID` | const | line 162 |
| `getAccessToken` | function | lines 1508–1532 |
| `ttFetch` | function | lines 1534–1542 |

**→ `lib/portfolio-data/types.ts`**

| Symbol | Kind | Old location (`app/portfolio/page.tsx`) |
|---|---|---|
| `ActionType` | type | lines 185–186 |
| `PositionIntent` | type | lines 198–201 |
| `StopStatus` | type | line 671 |
| `StopLossInfo` | interface | line 679 |
| `Recommendation` | type | lines 2958–2959 |
| `PositionLeg` | interface | lines 188–196 |
| `Position` | interface | lines 203–304 |
| `PendingOrderLeg` | interface | lines 306–320 |
| `PendingOrder` | interface | lines 321–334 |
| `PositionSnapshot` | interface | lines 336–358 |
| `GtcOrderLeg` | interface | line 673 |
| `GtcOrder` | interface | lines 674–678 |
| `PriceSupportAnalysis` | interface | lines 681–699 |
| `TrendResult` | interface | lines 701–707 |
| `EntrySnapshot` | interface | lines 1360–1378 |

**→ `lib/portfolio-data/acquisition.ts`**

| Symbol | Kind | Old location (`app/portfolio/page.tsx`) |
|---|---|---|
| `LS_ENTRY_SNAPSHOTS` | const | line 167 |
| `LS_PROFIT_TARGETS` | const | line 163 |
| `TRADING_DAYS` | const | lines 8268–8277 |
| `scorePortfolioPositionHealth` | function | lines 360–365 |
| `computeNetEdgeEvidence` | function | lines 367–381 |
| `computeMarketablePnlPct` | function | lines 383–393 |
| `computeRawPositionValuation` | function | lines 395–409 |
| `scorePortfolioPositionObjective` | function | lines 411–467 |
| `scorePortfolioRemainingOpportunity` | function | lines 469–493 |
| `fetchSnapshotStore` | function | lines 540–547 |
| `attachSnapshotHistory` | function | lines 549–564 |
| `fetchEntrySnapshots` | function | lines 1380–1389 |
| `postEntrySnapshots` | function | lines 1391–1411 |
| `migrateLocalEntrySnapshotsIfNeeded` | function | lines 1413–1441 |
| `positionEntrySnapshotKey` | function | lines 1443–1449 |
| `attachEntrySnapshots` | function | lines 1451–1506 |
| `parseOptionSymbol` | function | lines 1991–1996 |
| `calculateSpreadCredit` | function | lines 1999–2008 |
| `sideGrossRisk` | function | lines 2010–2049 |
| `calculateMaxRisk` | function | lines 2051–2071 |
| `normalizeOccSymbol` | function | line 2073 |
| `normalizeOrderAction` | function | line 2074 |
| `isBuyToCloseAction` | function | line 2075 |
| `isStopOrder` | function | line 2076 |
| `pickOrderField` | function | lines 2078–2081 |
| `mapGtcOrder` | function | lines 2083–2109 |
| `collectRawOrders` | function | lines 2111–2136 |
| `findProfitGtcOrder` | function | lines 2138–2151 |
| `fetchAllComplexOrders` | function | lines 2165–2178 |
| `fetchGtcOrders` | function | lines 2180–2227 |
| `classifyPositionStopLoss` | function | lines 2229–2243 |
| `loadPositions` | function | lines 2245–2938 |
| `loadAccountBalances` | function | lines 2940–2956 |
| `isShortDateEntry` | function | lines 2961–2964 |
| `getRecommendation` | function | lines 2966–3040 |
| `normalizePercentValue` | function | lines 3885–3889 |
| `getCurrentPop` | function | lines 3891–3900 |
| `netEdgeFrom` | function | lines 8279–8296 |
| `netEdgeLive` | function | lines 8298–8300 |
| `netEdgeSeries` | function | lines 8309–8318 |
| `netEdgePeak` | function | lines 8320–8327 |

**Totals:** 4 + 15 + 41 = **60 symbols, ~1,621 lines**, closure-verified (no symbol outside this set is required by any symbol inside it, and every symbol inside it was proven to be part of one connected dependency graph rooted at `loadPositions`/`loadAccountBalances`).

**Explicitly not relocated** (confirmed, by the same closure-check, not to be part of this dependency graph — remain page-local in `app/portfolio/page.tsx`, unchanged): `ttPost`, `ttPatch`, `ttDelete`, `ttPostComplex`, `ttValidateOrder`, `cancelOrder`, `buildReplaceOrder`, `buildCloseOrder`, `buildOpenSpreadOrder`, `runPendingOrderReplacementWorkflow`, `submitCloseOrderIfSafe`, every AI-analysis/roll-suggestion/audit-log/trading-memory function, `captureSnapshotsIfNeeded`, `captureLifecycleSnapshotsIfNeeded`, `toPositionSnapshotInput`, `fetchLifecycleSnapshotStore`, `todayLocalDateString`, `isUpcomingEarningsRisk`. No order-submission code, and no ES-0001/ES-0002 safety-gated call site, moved or changed.

### 11.4 Architecture note (as required by the corrective directive)

**(1) Why this sharing mechanism.** A React Context Provider mounted once at the app-shell root was chosen because Next.js App Router remounts `page.tsx` components on every route change but does **not** remount layouts/providers that wrap the root layout — so state placed in a root-level provider naturally survives navigation between `/portfolio` and `/dashboard`, while each page can still independently trigger `refresh()` in its own mount effect to preserve the existing "fetch fresh on every visit" behavior. This was the narrowest mechanism available: it required no new persistence layer, no new global store, no new API route, and reused the exact pattern already established by the pre-existing `TaskProvider`.

**(2) Why this avoids relocating the entire live-loading subsystem.** "The entire live loading subsystem" was, in the original (rejected) round, an unverified estimate of 4,000–6,000 lines. This round replaced that estimate with an automated, iterative dependency-closure proof and found the real, closed dependency set is 60 symbols / ~1,621 lines — a minority of the file, entirely free of React/JSX coupling, and mechanically separable without touching order-submission logic, safety gates, AI-analysis code, or any UI. What moved is exactly this measured, closed set, verbatim, with no redesign or optimization. Everything the Product Owner listed as must-not-touch (order submission, ES-0001/ES-0002 safety gates) was confirmed by the same closure-check to sit outside this set and was left untouched.

**(3) Why this maintains one canonical composition pipeline.** After this change, `loadPositions()` and `loadAccountBalances()` are each called from exactly one runtime call site: inside `PortfolioDataProvider.refresh()` / `refreshBalances()`. Both `app/portfolio/page.tsx` and `app/dashboard/page.tsx` read the resulting `positions`/`pendingOrders`/`balances`/`decisionReviews`/`composition` via the same `usePortfolioData()` hook — there is no second acquisition call, no forked copy of `loadPositions()`, and `composition` itself is still computed by the one, unchanged `buildDashboardComposition()` function introduced in the original round (§1 above), now computed once inside the Provider instead of once inside each page.

### 11.5 Updated real data-source inventory (supersedes §3 above)

| Panel | Data source | Real today? |
|---|---|---|
| Header | `buildCommandCenterViewModel()`'s `greetingFor(now)` + live `composition` from `PortfolioDataProvider` | Real, live |
| Daily Briefing | `lib/dailyBriefing`'s `buildDailyBriefing()`, via `buildDashboardComposition()`, fed live positions/balances from `PortfolioDataProvider` | **Real, live** (previously `unavailable` — corrected this round) |
| Today's Priorities | `lib/todaysPriorities`'s `buildTodaysPrioritiesDashboard()`, via the same live composition | **Real, live** (previously `unavailable` — corrected this round) |
| Portfolio Health | `lib/portfolioHealth`'s `calculatePortfolioHealthScore()`, via the same live composition | **Real, live** (previously `unavailable` — corrected this round) |
| Best Opportunity | Real adapter/ranker/panel, unchanged from the original round | Still legitimately empty — no real `DecisionAnalysis[]` feed exists anywhere in the app (unchanged, explicitly approved by the Product Owner to remain out of scope) |
| Background Tasks | `useTaskManager()` | Real and live, unchanged |
| Navigation | Plain `next/link`s | Unchanged |

### 11.6 Updated known limitations (supersedes §7 above)

1. **Best Opportunity remains the one legitimately empty panel.** No real `DecisionAnalysis[]` acquisition mechanism exists anywhere in the app; this is unchanged from the original round and explicitly out of scope per the Product Owner's direction (§1, "Opportunity Engine" instruction in the corrective directive).
2. **The two limitations from the original round's §7 items 1–2 concerning Daily Briefing/Priorities/Health being `unavailable` are resolved** — those panels now render live data via `PortfolioDataProvider`, as required.
3. **`loading` panel state is now exercised.** `PortfolioDataProvider.loading` reflects the in-flight `refresh()` call, so both pages now have a genuine, live `loading` transition (previously reserved-but-unused, per original §7 item 3).
4. **No visual/screenshot QA**, unchanged from the original round's disclosed limitation (production build hangs at the initial Next.js banner in this sandbox — a pre-existing environment limitation, not a regression).

### 11.7 Revalidation results

- **Full regression suite:** re-run in the same 10 batches used originally — **74 files / 1,034 tests, all passing**, confirming the 60-symbol relocation and Provider wiring introduced zero regressions.
- **`npx tsc --noEmit`:** clean, no errors (checked immediately after the Provider-wiring edits, and reconfirmed after this round's final EOF whitespace fix below).
- **`git diff --check -- . ':!tsconfig.tsbuildinfo'`:** initially reported three "new blank line at EOF" warnings in the three newly created files (`lib/portfolio-data/acquisition.ts`, `lib/portfolio-data/types.ts`, `lib/tastytrade/client.ts` — each had picked up one extra trailing blank line during extraction). Fixed by normalizing each to a single trailing newline; re-run is clean, exit 0.
- No behavioral change was discovered during extraction that required deviating from a mechanical relocation — the stop condition in the corrective directive was not triggered.

### 11.8 Updated deliverables

- This addendum (§11) plus the unchanged original report (§1–§10) above.
- `docs/design/TC-0001-Trade-Command-Center.md`'s own Corrective Round Addendum.
- `/tmp/TC-0001-corrective-review.diff` — full patch (binary-safe, `tsconfig.tsbuildinfo` excluded), covering all 29 changed/added files: everything from the original round plus `lib/tastytrade/client.ts`, `lib/portfolio-data/types.ts`, `lib/portfolio-data/acquisition.ts`, `components/portfolio-data/PortfolioDataProvider.tsx` (new), and `app/portfolio/page.tsx`, `app/dashboard/page.tsx`, `app/providers.tsx` (modified).
- Updated `docs/roadmap/ROADMAP.md`, `planning/SPRINT_STATUS.md`, `docs/HANDOFF.md`.

No commit, push, or merge has been made. This remains a review package for Product Owner approval.
