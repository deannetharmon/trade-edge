# TE-0005A Implementation Report — Phase 1: Helper Extraction

**Scope of this report:** the approved mechanical extraction of shared scan helpers into `lib/scans/`. This is a checkpoint within TE-0005A, not the full ticket — the background task runner, `START_RANKED_SCAN` command handler, page reconnect behavior, and cancellation support are not yet built (see §9).

## 1. Executive Summary

21 functions plus their required shared types, constants, and module state were mechanically extracted from `app/screener/page.tsx` into 8 new files under `lib/scans/`. This was a pure code move: every extracted function was copied byte-for-byte via scripted line-range extraction (no retyping), with only an `export` keyword added where needed to compile. `app/screener/page.tsx` was changed in exactly one place — a new import block — with zero other lines touched. `runScreen()` and `runTargetedScan()` (Filter/Rank/Targeted orchestration) are byte-for-byte identical before and after, verified by diff. Build passes clean.

## 2. Files Changed

**Created (`lib/scans/`):**
- `types.ts` — 114 lines
- `constants.ts` — 40 lines
- `scan-utils.ts` — 125 lines
- `tastytrade-client.ts` — 258 lines
- `spread-finder.ts` — 212 lines
- `checklist.ts` — 232 lines
- `rank-scoring.ts` — 400 lines
- `trend.ts` — 486 lines

**Modified:**
- `app/screener/page.tsx` — one import block added (29 lines) immediately after existing imports. No other lines added, removed, or changed except the 1,747 lines that were deleted because their content moved to `lib/scans/` (see §7).

## 3. Exact Functions Extracted (21 approved + 4 transitive dependencies discovered during extraction)

The originally-approved 21:
`getAccessToken`, `ttFetch`, `getMarketMetrics`, `getQuote`, `getChain`, `classifyUnderlying`, `getTrend`, `normalizeTickerToken`, `runChecklist`, `exploreAllCandidatesForRank`, `findBestIC`, `findBestSpread`, `findBestICUnfiltered`, `findBestSpreadUnfiltered`, `scoreCandidate`, `scoreBuffer`, `daysUntil`, `calcSpreadPop`, `normalizeIv`, `formatDisplayDate`, `estimateNextEarningsDate`.

4 additional functions found to be required for the above to compile (not in the original 21-item list I presented, but covered by your approval's "plus required shared types/constants/state needed to compile"):
- `trySpreadAtWidth` — called by `findBestSpread`
- `tryICSideAtWidth` — called by `findBestIC`
- `getWidthSteps` — called by `findBestSpread`/`findBestIC`
- `getBidAskMax` — called by `trySpreadAtWidth`/`tryICSideAtWidth`
- `normalCdf` — called by `calcSpreadPop`

(That's 5, not 4 — I undercounted in the moment; full corrected list is 26 functions total.)

## 4. Exact Types/Constants Extracted

**Types** (`lib/scans/types.ts`): `CheckResult`, `SpreadCandidate`, `TrendResult`, `ScreenResult`, `RankConfig`, `DimensionScore`, `RawScanEntry`

**Constants** (`lib/scans/constants.ts`): `INDEX_IVR_MIN`, `RANK_SCAN_DTE_MIN`, `RANK_SCAN_DTE_MAX`, `ESTIMATED_EARNINGS_CYCLE_DAYS`, `DEFAULT_RULES`, `RulesType`, `DEFAULT_ETF_RULES`, `YAHOO_INDEX_CHART_MAP`, `BASE`, `CLIENT_ID`, `LS_ACCESS_TOKEN`, `LS_ACCESS_TOKEN_EXPIRY`

**Module state**: `classificationCache` (the `Map` backing `classifyUnderlying`'s memoization) — moved to `tastytrade-client.ts`, same single shared instance.

`ESTIMATED_EARNINGS_CYCLE_DAYS` was a second transitive dependency not in the original list (used inside `estimateNextEarningsDate`).

## 5. Page.tsx Changes

Exactly one change: a 29-line import block inserted after line 6 (after the existing `react`/`next`/`react-dom` imports), importing every extracted symbol from its new `lib/scans/*` location. No function bodies, no other imports, no JSX, no state, no UI code was touched.

Verified via diff: `runScreen()` (Filter/Rank/Targeted orchestration, 126 lines) and `runTargetedScan()` (549 lines) are byte-for-byte identical between the pre-extraction and post-extraction versions of the file.

## 6. Confirmations

- **Filter/Targeted not migrated:** confirmed. Neither mode's control flow was touched — `runScreen()` and `runTargetedScan()` still own their full execution, still page-local, still call the same functions (now via import instead of local closure) with identical signatures and behavior.
- **Ranked Scan behavior preserved:** confirmed. The `rank` branch inside `runScreen()` is untouched — same helper calls, same order, same logic. No formulas, scoring weights, strike-walk logic, or error handling were changed anywhere in the extracted code.

## 7. Diff Statistics

```
app/screener/page.tsx: 7,569 → 5,852 lines (1,747 lines removed, 29 lines added)
lib/scans/: 8 new files, 1,867 lines total
```

The 1,747 removed lines correspond exactly to the 26 extracted functions/types/constants; nothing else was deleted.

## 8. Build Results

`npx tsc --noEmit`: one error on first pass (`checklist.ts` — missed importing `normalizeIv`, used in the relaxed-rules fallback inside `runChecklist`). Fixed by adding the import. Second pass: clean, zero errors.

`npm run build`: passed. All 39 routes generated. `/screener` bundle size unchanged (57.1 kB, identical to pre-extraction) — consistent with a pure code move rather than a behavior change.

`npm run lint`: not available in this repo (no ESLint config), same as prior tickets.

## 9. Not Yet Done — Remaining TE-0005A Scope

This extraction was explicitly scoped and approved as its own step. The rest of TE-0005A is still open:

- `lib/scans/ranked-scan-runner.ts` — the actual background orchestration function (progress callback, `AbortSignal`), built on top of the helpers extracted here
- `START_RANKED_SCAN` command handler in `lib/commands/command-handlers.ts`, wired to `TaskManager`
- Ranked Scan page reconnect behavior (active/completed task lookup on mount)
- Cancellation support per ADR-0003

I'm stopping here to confirm before starting that next piece, since it touches `app/screener/page.tsx`'s actual control flow (how Rank mode is triggered) rather than just imports — a different risk profile than this extraction.

## 10. Technical Debt / Notes

- `getTrend` (478 lines) and `scoreCandidate`+`exploreAllCandidatesForRank` (`rank-scoring.ts`, 400 lines) are large single-function files by design — kept as one file each to avoid further splitting beyond what "move code, don't restructure" implies.
- Several extracted functions still take `any[]`/`any` parameters (option chain legs, metrics) exactly as they did in `page.tsx` — untyped by original design, preserved verbatim rather than typed as part of this ticket.

