# SCREENER-RESULTS-0001 — Task 1 Wiring: Implementation Report

## Scope

Wires the six in-scope production Screener workflows (Spread–Filtered, Spread–Ranked, Spread–Targeted, CSP–Filtered, Covered Call–Filtered, PMCC–Filtered) in `app/screener/page.tsx` to the pre-existing canonical scan-session model (`lib/screener/scanSession.ts`), so scan scope, execution outcomes, displayed results, accounting, cache restoration, and recommendation generation can no longer drift independently. This is Task 1 correctness work only — no card/layout redesign, no buying-power correction, no new scoring, no production order execution changes.

Base: `main @ 638a562` → checkpoint `7bd917a` (canonical model already present, not yet wired) → this commit.

## Execution paths wired

- **Filtered spreads** (`runScreen`): full session lifecycle over `session.plannedScanSymbols`; trend-gated zero-candidate outcomes recorded via `recordSymbolEvaluated(..., [], {reasonCode: 'NO_QUALIFYING_CANDIDATE'})`; chain-fetch failures via `recordSymbolFailed(..., 'MARKET_DATA_REQUEST_FAILED')`; strict `completeSession()` on finish.
- **Ranked spreads** (`useRankedScan.ts` / `ranked-scan-runner.ts` background task): the real per-symbol loop lives in a separately-owned, already-tested module executed via the task/command-bus. The hook reconstructs one canonical outcome per planned symbol from the runner's own real signals once the task completes — a symbol present in `rawScanCache` (a successful chain/quote fetch) is `evaluated` with whatever real candidates it produced; a planned symbol absent from `rawScanCache` is `failed`, never silently dropped or given a fabricated zero-candidate result.
- **Targeted spreads** (`runTargetedScan`, module-level): aggregates all `TargetedScanEntry` rows for a symbol (one entry per expiration × strategy) into a single `recordSymbolEvaluated` call; cancellation via the STOP SCAN button calls `stopSession(..., 'CANCELLED')`, which auto-resolves any unattempted planned symbols as `skipped`.
- **CSP–Filtered** (`runCspScan`): `requestedStrategy: 'csp'`, `mode: 'filter'`; every planned symbol evaluated or failed; results REPLACE the active session/results, never merge.
- **Covered Call–Filtered** (`runCcScan`): `requestedStrategy: 'cc'`; scope-exclusion resolver distinguishes `CC_NO_SHARES_OWNED` / `CC_FULLY_COVERED` / `CC_HIDDEN_BY_TRADER` / `CC_NO_CAPACITY`; an empty ordinary Opportunity Universe now blocks the scan with an explicit message instead of silently scanning every eligible holding (see "Deviations" below for the resulting UI/test changes); `capacityReport.status !== 'ok'` (including unattributable exposure) fails closed via the existing pre-session guard, before any session is constructed.
- **PMCC–Filtered** (`runPMCCScan`): same pattern as CSP.
- **`applyRules`** (client-side rules re-filter over `rawScanCache`): a third, previously undocumented independent result-mutation path — now derives a new session from the prior session's scope, replays evaluation for symbols present in `rawScanCache`, and carries forward the prior session's real outcome (evaluated/failed) for symbols outside it, rather than fabricating anything.

## Canonical state ownership

`activeSession` (React state) + `activeSessionIdRef` (a ref, so long-running async scan functions can synchronously check at any await boundary whether they've been superseded) are the sole authoritative record. `results`/`resultsCachedAt` are populated FROM `session.results` at each commit (`commitScanSession`), never independently accumulated. Every scan function's session REPLACES the previous one — CSP/CC/PMCC no longer merge into a shared `results` array (the root cause of the pre-existing "CSP results mixed with spreads" class of bug).

## Accounting definitions

The UI renders `lib/screener/scanSession.ts`'s own `formatSessionAccountingSummary()` directly (not a reimplementation), whenever `activeSession.mode === screenMode`: `N selected · N planned · N attempted · N evaluated · [N failed] · [N skipped] · N qualified · N disqualified` — `failed`/`skipped` segments only render when nonzero. `attemptedCount` (`evaluated + failed`) is never labeled "scanned"; the pre-existing `results.length` "SCANNED" label and the accounting summary now both render side by side, distinctly captioned.

## Cache behavior

New module `lib/screener/scanSessionCache.ts` (ADR-0004-compliant — a self-contained IndexedDB reader/writer, not an import of page.tsx's private idb helpers) provides `persistScanSession`/`restoreScanSession`/`clearScanSessionCache`. Only a `'complete'` session is ever persisted, tagged with `cacheProvenance: 'idb-cache'` and a fresh `cachedAt` at write time. Restoration runs every cached entry through the model's own `validateSessionData()`; an invalid, malformed, cross-strategy, or unknown-schema-version entry is rejected and the cache entry cleared, never trusted. A new active session ID is established (via `beginScanSession`) before any async scan result can arrive, so a stale cache read can never be combined with a running scan's live results.

## Strategy isolation / Best Opportunities trust boundary

The FIND SPREADS/CSPs/COVERED CALLS/PMCCs buttons highlight based on `activeSession?.requestedStrategy`, never on `screenMode` or result shape — a CSP scan cannot silently revert the highlight to Spreads. The Best-Opportunities-generating effect is gated by `shouldGenerateRecommendationsForSession(activeSession, activeSessionIdRef.current)` and sends only `activeSession.results.filter(r => r.qualified)` — never the full qualified+disqualified array the prior version sent. `BestOpportunitiesPanel`'s empty state renders the exact required copy — "No qualified opportunities for this scan. Review the disqualified candidates and their reasons below." — when a completed session has results but none qualified.

## Failure-reason mapping

Real failure paths map to explicit canonical codes: access-token failure and unrecognized network errors → `ACCESS_TOKEN_UNAVAILABLE` / `MARKET_DATA_REQUEST_FAILED` (heuristically distinguished by message content, same convention across all five scan functions' outer catch blocks); Covered Call's account-wide unattributable exposure → the pre-existing fail-closed path (`capacityReport.status !== 'ok'`), never converted into a per-symbol scope exclusion; cancellation → `CANCELLED` (Targeted only, the sole workflow with a cancel control); a superseded session is simply discarded by `commitScanSession` (its `void committed;` return value signals "this session was stale, nothing was written"). The four `errResult()` fabricated-`ScreenResult`-on-catch helpers (Filtered/CSP/CC/PMCC, plus `ranked-scan-runner.ts`'s equivalent) were removed; every catch site now calls `recordSymbolFailed()` instead of pushing a synthetic disqualified result into the live results array.

## Deviations / notable findings

- **Empty-Opportunity-Universe bug (pre-existing, fixed per ticket requirement).** `runCcScan`'s `universeNarrows` check was `opportunityUniverse.length > 0 && !bypassUniverse` — false whenever the universe was empty, which made `scannable` silently fall back to `allScannable` (every eligible holding), even though the trader never asked for that. Fixed to require an explicit `bypassUniverse === true`; an empty ordinary universe now blocks the scan with an explicit message. Because this removed the only UI path that could reach "scan all eligible holdings" from a genuinely empty universe, a dedicated affordance (a "SCAN ALL ELIGIBLE HOLDINGS" button) was added to the empty-universe branch of the eligible-holdings status card.
  - This is a real, intentional behavior change mandated by the ticket ("An empty ordinary Opportunity Universe must NOT silently behave as the override"), and it broke three pre-existing tests that had encoded the old buggy behavior as their expected outcome: `UnifiedStrategyLauncher.test.tsx` (test 2, "empty universe... scans all eligible holdings"), `SingleCoveredCallLaunchAction.test.tsx` (two tests premised on an implicit all-holdings scan), and `OiAndSortWiring.test.tsx` (its CC OI-floor test). All three were updated to assert the corrected, ticket-mandated behavior — not weakened, since the old assertions were the bug — plus a fourth pre-existing test in `CcCapacityGate.test.tsx` needed the same fix (add an explicit ticker to the universe before scanning) for the same reason.
- **Ranked-mode reconstruction is best-effort, not a rewrite.** `ranked-scan-runner.ts` (shared with the server-side TE-0002B job engine) was deliberately not modified — higher risk, out of scope. `useRankedScan.ts` reconstructs session outcomes from the runner's own already-real `rawScanCache`/`results` signals after the fact, which is accurate but means a symbol whose fetch succeeded with a real disqualified outcome and a symbol whose fetch simply never got attempted are distinguished only by `rawScanCache` membership — the same signal `runScreen`'s own scanCache-based logic already relies on.
- **Session supersession is largely prevented by the UI, not just the model.** `app/screener/page.tsx` gates every scan-trigger button behind one page-level `loading` flag (each button relabels to "SCANNING..." and disables while any scan is in flight), so two scan loops can never truly overlap through user interaction alone. The canonical model's own supersession safety (a new `beginScanSession()` call always fully replaces the prior session, even one still `'running'`) is exercised directly in `ScreenerSessionWiring.test.tsx`, and the practical, reachable race — a stale Best-Opportunities recommendation-fetch response from an already-completed prior session landing after a newer session is active — is also tested directly with real (unmocked) timing control.

## Tests added

New file `app/screener/__tests__/ScreenerSessionWiring.test.tsx` (10 tests, all against the real page component and lib functions, only the tastytrade-client network boundary and `fetch` mocked):

1. Six selected / five planned (one excluded by scope) / five attempted / mixed qualified+disqualified / exactly one skip, with the "failed" segment absent entirely on a run with no real failures.
2. (same test) a planned symbol with zero qualifying candidates is a real evaluated/disqualified outcome, not a failure.
3. A real chain-fetch failure for one planned symbol is recorded as failed and visible in accounting.
4. Strategy isolation: a CSP scan renders CSP-typed badges and highlights FIND CSPs (never FIND SPREADS).
5. Session supersession: a second scan (CSP) always fully replaces a completed prior session (CC) — never a merged/dual-session display.
6. Best Opportunities: only qualified results reach the recommendation request body; a disqualified result is provably excluded.
7. No qualified results renders the exact required empty-state copy and never calls the recommendation endpoint.
8. A prior session's in-flight (deliberately deferred) recommendation response cannot populate a newer, already-active session's display.
9. CC scope-exclusion precision: a mix of a never-verified symbol and a fully-covered verified symbol are both excluded (2 skipped) and never reach the market-data boundary, alongside the one real, planned, scannable symbol.
10. (module-level, real `lib/screener/scanSessionCache.ts` functions against a minimal spec-shaped fake IndexedDB) a validly completed session round-trips through `persistScanSession`/`restoreScanSession` with reconciled accounting and honest cache provenance; malformed/unknown-schema cached data is rejected and cleared, never trusted.

Plus corrections to four pre-existing tests (`UnifiedStrategyLauncher.test.tsx`, `SingleCoveredCallLaunchAction.test.tsx` ×2, `OiAndSortWiring.test.tsx`, `CcCapacityGate.test.tsx`) whose assertions encoded the empty-Opportunity-Universe bug this ticket fixes.

### Ticket's 20 required scenarios — coverage map

| # | Scenario | Covered by |
|---|---|---|
| 1 | Six-selected/five-planned accounting, one explicit skip | `ScreenerSessionWiring.test.tsx` #1 |
| 2 | Zero-candidate planned symbol counted as evaluated | `ScreenerSessionWiring.test.tsx` #1 |
| 3 | Chain-fetch failure recorded as failed, visible in accounting | `ScreenerSessionWiring.test.tsx` #2 |
| 4 | Cancellation-after-partial-attempt — correct attempted/skipped totals | Not re-tested at wiring level this pass — Targeted mode's `stopSession('CANCELLED')` call and its auto-resolution of unattempted symbols is exercised by `lib/screener/__tests__/scanSession.test.ts`'s own `stopSession` coverage; a full RunModeModal-driven Targeted UI test was judged lower-value/higher-risk to add blind in this pass (see Remaining risks) |
| 5 | Superseded scan cannot write late results into the replacement session | `ScreenerSessionWiring.test.tsx` #5 (session-level) and #8 (the actually-reachable async-response race) |
| 6 | CSP-launch isolation | `ScreenerSessionWiring.test.tsx` #4 |
| 7 | Spread sessions accept BPS/BCS/IC | `lib/screener/__tests__/scanSession.test.ts` (strategy-acceptance coverage, pre-existing) |
| 8 | Foreign-strategy result cannot enter the live session/UI | Enforced by the model's own `recordSymbolEvaluated` strategy check (throws on mismatch — `scanSession.test.ts`); `ScreenerSessionWiring.test.tsx` #4 confirms only CSP-typed results ever render from a CSP session |
| 9 | Qualified/disqualified totals exactly reconcile | `ScreenerSessionWiring.test.tsx` #1 |
| 10 | Disqualified result never in Best Opportunities | `ScreenerSessionWiring.test.tsx` #6 |
| 11 | No-qualified-results empty state | `ScreenerSessionWiring.test.tsx` #7 |
| 12 | Recommendation generation only for matching active/completed/nonempty session | `ScreenerSessionWiring.test.tsx` #7, #8 |
| 13 | Old session's recommendations never describe a newer session | `ScreenerSessionWiring.test.tsx` #8 |
| 14 | Valid cached-session restoration reproduces accounting + provenance | `ScreenerSessionWiring.test.tsx` #10 |
| 15 | Invalid/malformed/unknown-schema cached data rejected | `ScreenerSessionWiring.test.tsx` #10 |
| 16 | Ordinary CC universe intersection accounts for selected-but-ineligible with precise reasons | `ScreenerSessionWiring.test.tsx` #9 |
| 17 | Explicit CC "Scan all eligible holdings" override works without weakening capacity checks | `UnifiedStrategyLauncher.test.tsx` #7, `CcCapacityGate.test.tsx` #10 (pre-existing, still passing) |
| 18 | Empty ordinary CC universe does not implicitly scan all holdings | `UnifiedStrategyLauncher.test.tsx` #2, `SingleCoveredCallLaunchAction.test.tsx`, `CcCapacityGate.test.tsx` (all updated this pass to the corrected behavior) |
| 19 | `CC_UNATTRIBUTABLE_EXPOSURE` fails closed, never a scope-exclusion skip | `CcCapacityGate.test.tsx` #9 (pre-existing, still passing — the guard runs before any session exists) |
| 20 | Existing TE-0007/CC-capacity/OI-multisort/portfolio-mode tests unchanged and passing | Full suite run below: 1750/1750 |

## Validation

- Focused canonical model tests + new/updated Screener wiring tests + existing Screener suite: `npx vitest run app/screener lib/screener lib/scans features/screener` → **11 files, 217/217 passing**.
- Full suite: `npx vitest run` → **113 files, 1750/1750 passing** (checkpoint was 112 files/1740 tests; +1 new file, +10 new tests, 0 regressions).
- `npx tsc --noEmit` → clean, no errors.
- `git diff --check` → clean, no whitespace errors.
- `npx next build` → succeeds (production build completes; `/screener` route compiles at 64.3 kB / 175 kB First Load JS).

## Before/after: six-selected/five-attempted case

**Before:** no canonical accounting existed; the UI showed only `results.length` labeled "SCANNED" (which conflated attempted with evaluated, and never accounted for skipped/excluded symbols at all).
**After:** `formatSessionAccountingSummary()` renders e.g. `6 selected · 5 planned · 5 attempted · 5 evaluated · 1 skipped · 2 qualified · 3 disqualified` — every selected symbol is visibly accounted for, and the skipped symbol (never verified as a holding) is never silently absorbed into either the "attempted" or "qualified/disqualified" counts.

## CSP isolation behavior

**Before:** `runCspScan` called `setResults(prev => [...prev, ...newResults])`, merging CSP results into whatever spread results were already displayed, and the FIND SPREADS button had no way to know a CSP scan had run — it could remain highlighted, or CSP results could appear to be spread results.
**After:** a CSP scan constructs a fresh `requestedStrategy: 'csp'` session that fully replaces `results`; the launcher highlight reads `activeSession.requestedStrategy === 'csp'` and switches to FIND CSPs; every rendered strategy badge is CSP.

## Best Opportunities behavior

**Before:** all `results` (qualified + disqualified) were sent to `/api/autopilot/recommendations`, and there was no session-identity check on the response — a disqualified candidate could theoretically influence the ranked list, and a slow response from an old scan could overwrite a newer scan's panel.
**After:** only `activeSession.results.filter(r => r.qualified)` is ever sent; the response is only published if `shouldGenerateRecommendationsForSession(activeSession, activeSessionIdRef.current)` is still true when it arrives; a completed session with zero qualified results shows the required exact empty-state message instead of an empty/ambiguous panel.

## Cache behavior

**Before:** page-local IndexedDB reads/writes of raw `results`/`rawScanCache` arrays, no schema validation, no cross-strategy check, no cache provenance marking.
**After:** only a `'complete'` session is cached, via `lib/screener/scanSessionCache.ts`; restoration validates through `validateSessionData()` and clears anything invalid; a restored session is honestly marked `cacheProvenance: 'idb-cache'`.

## Remaining risks / backlog

- Targeted-mode cancellation (`stopSession('CANCELLED')`'s auto-resolution of unattempted planned symbols) is proven correct at the pure-function level (`scanSession.test.ts`) but not re-verified this pass via a full RunModeModal-driven UI test (STOP SCAN button mid-scan) — a reasonable follow-up if Task 2 or a future ticket touches Targeted mode again.
- Ranked mode's outcome reconstruction in `useRankedScan.ts` depends on `rawScanCache` membership as its sole evaluated-vs-failed signal, inherited from the pre-existing `runScreen` convention — accurate but indirect; a more direct signal would require changes to `ranked-scan-runner.ts` itself, explicitly deferred as higher-risk/shared-with-server-engine.
- The duplicate React key warning (`MU-CC`) noted as pre-existing and explicitly out of scope remains unaddressed.
- The `$100,000` buying-power placeholder and broker balance normalization remain unaddressed (explicitly out of scope).

## Commit

Kept as a single commit on top of `7bd917a` on branch `fix/screener-session-and-account-integrity`. Not pushed, not merged. No PAT requested. Task 2 not started.
