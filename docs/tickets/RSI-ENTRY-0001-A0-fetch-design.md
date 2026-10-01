# RSI-ENTRY-0001 slice A0: fetch seam design

Author: Dane (design only, no gate code). Reviewers: Alan (sizing), Quinn (failure handling), Ian (scoring-adjacent edit), Diane (A2 consistency rule). Date: 2026-10-01.
Status: design complete; step 0 (close-adjustment check) is open and must run on a Vercel preview.

## 1. Call sites (verified by reading the enclosing function of each)

| Call site | Enclosing function | Strategy | In scope |
|---|---|---|---|
| `app/screener/page.tsx` ~10573 | `runCspScan` | CSP | **Yes** |
| `app/screener/page.tsx` ~10846 | `runCcScan` | CC | **Yes** |
| `app/screener/page.tsx` ~7711 | `runTargetedScan` | Spreads (width, POP, OTM) | No |
| `app/screener/page.tsx` ~9892 | `runScreen` | Spreads | No |
| `lib/scans/ranked-scan-runner.ts:115` | ranked spread scan | Spreads | No |
| `app/screener/page.tsx` ~10248 | `runPMCCScan` | PMCC | No |
| `app/portfolio/page.tsx` ~2893 | its own local `getTrend` | Portfolio cards | No |

Both in-scope sites have the same shape: `classifyUnderlying`, then `getChain`/`getQuote`, then `try { trendResult = await getTrend(symbol, isEtf); } catch {}`, then `runCspChecklist(...)` or `runCcChecklist(...)`. Both are in a per-symbol loop, so the gate evaluates once per symbol and attaches to every row from that symbol. `getTrend` is called with the swallowed `catch {}`, so a `getTrend` failure never stops the scan today; the gate must keep that property.

## 2. Why no extra Yahoo call is possible, and the seam

`getTrend` (`lib/scans/trend.ts` lines 8-16) fetches `/api/chart?symbol=<mapped>` and keeps only `bars[].c`. The gate needs the same bars including `t` (to drop the forming bar). Two fetches per symbol would double Yahoo traffic through `/api/chart`, so the gate must read the bars `getTrend` already fetched.

**Seam: a short-lived per-symbol bars memo, `lib/scans/dailyBarsMemo.ts` (new).**
- `fetchDailyBars(chartSymbol): Promise<unknown[]>` calls `fetch('/api/chart?symbol=...', { cache: 'no-store' })` exactly as `getTrend` does today, returns `data?.bars ?? []`, throws the same `Yahoo chart fetch failed for X (status)` error on a non-OK response.
- Memo keyed by `chartSymbol` (after `YAHOO_INDEX_CHART_MAP`), holding the in-flight or resolved promise for 60 seconds. Concurrent callers share one request. A rejected request is **removed** from the memo (failures are never cached).
- Entries older than 60 s are evicted on each call; the map cannot grow without bound across a long scan.
- `getTrend` change (the only edit to existing scoring-adjacent code): replace its inline `fetch` + `res.json()` (lines 10-14) with `const bars = await fetchDailyBars(chartSymbol)`; everything from `const closes = bars.map(...)` onward is untouched, including its own `calcRsi`/`rsi14`. Error text and the `< 90 closes` throw are unchanged.
- New `lib/scans/rsiEntryForSymbol.ts`: `getRsiEntryGate(symbol, strategy, now = new Date())` normalizes the symbol the same way `getTrend` does (`normalizeTickerToken`, `YAHOO_INDEX_CHART_MAP`), calls `fetchDailyBars` (a memo hit when `getTrend` ran first), then `completedDailyCloses` and `evaluateRsiEntryGate`. It never throws: any failure returns the `UNAVAILABLE` result ("RSI n/a").
- Result: with `getTrend` first, a scan row costs **zero** extra requests. If `getTrend` failed (so nothing is memoized), the gate makes one retry of the same request; that is the only case that adds a call, and it only happens when the first one failed.

Alternatives rejected: (a) change `TrendResult` to carry closes: edits a widely consumed type and risks scoring consumers; (b) a second independent fetch: doubles traffic; (c) server-side fetch: Yahoo is only reachable the way `/api/chart` already does it, and the ticket forbids new server paths for the gate in Phase A.

Index symbols (SPX, NDX, RUT, VIX, DJX) already map through `YAHOO_INDEX_CHART_MAP`; reused unchanged. The "RSI n/a" outcome for a symbol with fewer than 22 completed closes is correct and fail-closed.

## 3. Failure handling (Quinn)
- Fetch failure, non-OK status, malformed JSON, non-array `bars`, bad bar fields, or too few completed closes: `UNAVAILABLE`, label "RSI n/a". Never throws into the scan loop, never marks a row failed, never changes `trendResult`.
- Gate Off: no gate call at all (A2 skips it), so Off is behaviorally identical to today.
- Gate On and "RSI n/a": the row is not eligible for Best Opportunity (fail closed, per the ticket), stays visible and tradeable.
- The gate result is data on the row (planned field `rsiEntry?: RsiEntryGateResult` on the scan result, additive and optional). It never feeds `scoreCandidate`, qualification, or the order payload.

## 4. Slicing consequence
The `getTrend` edit touches a verbatim-extracted, scoring-adjacent function, so it ships as its own slice **A1b** (order updated), with a golden test that `getTrend` output is byte-identical with the memo as before. A2 depends on A1b.

Tests for A1b:
- `fetchDailyBars`: one request for two concurrent callers; a second call within 60 s reuses; after 60 s refetches; a failure is not cached; error text and status preserved.
- `getTrend` golden: same `TrendResult` as before the change for a fixed 130-bar fixture and for the `< 90` throw.
- `getRsiEntryGate`: warmed memo makes no second request; fetch failure returns UNAVAILABLE and does not throw; index symbol mapping; forming bar dropped at 11:00 ET, kept after 16:00 ET.

## 5. Step 0: close-adjustment check (Alan's open item; not runnable from the planning sandbox)
Yahoo is blocked from the planning environment, so this runs on the Vercel preview once A1b is up (or any preview of main).
1. Open `/api/chart?symbol=AAPL` on the preview; pick 5 dates; compare each bar's `c` with TradingView's daily close (dividend adjustment OFF). Equal to the cent = not dividend-adjusted.
2. Split check: pull a symbol with a known split (for example a closes range spanning NVDA's June 2024 10-for-1) through `/api/chart-history` and confirm which close field it reads; confirm closes are split-adjusted so RSI has no artificial gap.
3. Record here: dates, both values, verdict.

Result: **PENDING**. If closes turn out dividend-adjusted, the RSI difference is small for daily RSI(14) over a short window, but Alan decides whether the gate needs unadjusted closes before the default flips On.

## 6. Simplicity and consistency rule for A2 (Dean's directive, 2026-10-01; Diane and Ian gatekeep)
Dean: a very comprehensive tool for the best decisions, with as much simplicity and consistency as possible.
- One new control concept, not several: the "Entry timing (RSI)" On/Off. Dip level, peak level, window, lift and ceiling live under advanced and default to the ticket values.
- Reuse the existing scan-control, receipt ("Active CSP rules"/"Active CC rules"), row-chip and order-line components and wording patterns; no new visual idiom. Diane's mock is the reference; where the mock and an existing pattern differ, Diane rules and records it.
- The same words mean the same thing everywhere: "Wait", "Pass", "RSI n/a" are used identically in chip, receipt, order screen, and alert email.
- Every number a trader sees must say what it is (RSI value, dip level) without a legend; if it cannot, it is cut.
- Ian confirms that each added element helps a trade decision; anything that does not is cut or moved to advanced.

## 7. A2 design addendum (Dane, 2026-10-01; found while mapping the existing code; Diane and Ian gate)

Findings that shape A2, each checked in the repo:
- **Receipt and controls are registry-driven.** CSP: `lib/screener/scanConfig/cspRegistry.ts` (criteria with card, control, lifecycle; `buildCspReceipt`, `valuesFromSnapshot`) feeding `CspScanModal` and `ActiveCspRules`. CC: `ccRegistry.ts` feeding `CcScanModal` and `ActiveCcRules` (takes `values`, no snapshot). The RSI control and its receipt line therefore go in as **registry criteria**, so the modal summary and the receipt cannot word it differently (Dean's consistency directive).
- **CSP snapshot is persisted with strict validation.** `CspRuleSnapshot` is stored in the scan session (`SCHEMA_VERSION = 9`, `isValidCspRuleSnapshot` checks named fields and ignores extras). The RSI setting is added as an **optional** field `rsiEntry?: { on: boolean; low: number; window: number; lift: number; mid: number }`, validated when present. No schema bump, so cached sessions are not discarded. CC has no snapshot; its receipt reads the same setting from its config values.
- **Best Opportunity eligibility** is joined in the pure `features/screener/lib/bestOpportunityRows.ts` (`buildBestOpportunityRows`, three call sites in `app/screener/page.tsx` near 12224, 12236, 12278). CSP rows already pass `isBestOpportunitiesEligible` there. The gate is one more filter in that function, driven by the row's own `ScreenResult.rsiEntry`, so it is unit-testable without the page and the recommendation engine, scores, and ranks upstream stay untouched (ranks are renumbered after the filter, as today).
- **An override pattern already exists**: `OrderOverrideAcknowledgment` (QUAL-STATES-0001) blocks a not-Qualified order until a checkbox is ticked. An RSI Wait is **not** a qualification failure, so it must not reuse that red/amber blocking panel. It gets the single neutral line in the order window, no checkbox, no lock (as Dean approved in the mock), plus the audit entry. Same words as everywhere else: "Wait", "Pass", "RSI n/a".

Evaluation timing: when the scan setting is On, the scan loop calls `getRsiEntryGate` once per symbol (after `getTrend`, so a memo hit) and attaches the result to every row of that symbol as `ScreenResult.rsiEntry?` (optional, additive, absent when Off). When Off, nothing is called and nothing is attached, so results are identical to today. The setting is applied at scan time like every other scan control (change it with "Edit / Run Again").

Split of A2 into two pushes so each can be checked on a preview (Frank's call):
- **A2a (visible, no eligibility change):** registry criterion and modal control, optional snapshot field and validator, persistence of last-used setting, receipt line with "N of M pass", scan-loop attach, row chip. With the gate On, chips and the receipt show; Best Opportunity is still unchanged.
- **A2b (eligibility and order screen):** the `buildBestOpportunityRows` filter, the empty-slot message, the order-window line, and the audit entry; payload byte-identical test.
Default stays Off through both; the flip to On is Paul's call after Ian's pass-rate check.
