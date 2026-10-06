# LEAPS-QV-0001 — Gate 3 input builder (StrategyInput assembler): data contract

**Status: SPECIFICATION — Quinn, 2026-10-06.** Scope approved by Paul and Dean (2026-10-06): fetch fundamentals and price history per Opportunity Universe symbol, build the QV-v1.0 `StrategyInput`, run the strategy. **Out:** any Gate 3 rule change, any UI (that is the Gate 6 MVP). No investment logic is added here, so no Ian gate.

## 1. Why

Gate 3 (`QV_V1_0_STRATEGY`) and Gate 4 are complete, but nothing builds Gate 3's input from real data, so no symbol can reach SETUP / ACTIONABLE in the app. The data sources exist and are tested (Gates 2, 2b, 2c); only the join is missing.

## 2. Where it runs

Browser-side orchestration, server-side data, pure assembly:

| Piece | Location | Notes |
|---|---|---|
| Fundamentals + price history | existing `GET /api/fundamentals?symbol=` (SEC EDGAR + Yahoo, server-side) | unchanged; returns `LoadedFundamentals` (`metrics`, `technicals`, issues, coverage) |
| Earnings date | existing TastyTrade `/market-metrics?symbols=` through the same-origin proxy | normalized by the existing `buildMarketMetrics` (Gate 2) |
| Assembly | **new pure** `lib/discovery/qv/assembleInput.ts` | no I/O, no clock; takes the two payloads and `asOf`, returns `StrategyInput` |
| Run | new `lib/discovery/qv/runUniverse.ts` with injected fetchers | concurrency 3; one symbol's failure never affects another |
| Browser binding | new `lib/scans/qvUniverseTransport.ts` | the only file that calls `fetch`; outside `lib/discovery` (isolation guard unchanged) |

## 3. Metric map (every id QV-v1.0 reads)

| Metric id(s) | Source | If the source fails |
|---|---|---|
| `revenue_cagr_5y_pct`, `revenue_growth_yoy_ttm_pct`, `eps_cagr_5y_pct`, `eps_growth_yoy_ttm_pct`, `operating_margin_ttm_pct`, `operating_margin_change_yoy_pp`, `roic_v1_pct`, `fcf_ttm`, `fcf_annual_history_5y`, `net_debt_to_ebitda` | `/api/fundamentals` → `metrics` (SEC) | each UNAVAILABLE with the loader's reason; never defaulted |
| `pe_ttm`, `pe_ttm_percentile_3y/5y`, `pe_ttm_discount_to_median_3y/5y_pct` | `/api/fundamentals` → `metrics` (SEC + price history) | UNAVAILABLE |
| `price_last_close`, `sma_50`, `sma_200`, `sma_200_change_20d_pct`, `distance_from_52w_high_pct`, `rsi_weekly_14`, `rsi_monthly_14`, `rsi_weekly_change_4w`, `rsi_weekly_slope_1w`, `price_vs_sma50_gap_change_4w_pp`, `relative_return_126d_vs_benchmark_pct`, `relative_return_126d_change_4w_pp` | `/api/fundamentals` → `technicals` (Yahoo, completed bars only) | UNAVAILABLE; a SPY failure only affects the two benchmark ids |
| `days_to_next_earnings` | TastyTrade `/market-metrics` → `buildMarketMetrics` | UNAVAILABLE (informational in QV-v1.0: earnings approaching never disqualifies) |
| `corporate_event_flags` | **no provider** (Gate 3 A6) | UNAVAILABLE → event coverage UNKNOWN → risk gate NOT_EVALUABLE, non-blocking (ratified) |
| `analyst_eps_revision_90d_pct`, `analyst_revenue_revision_90d_pct`, `analyst_revision_breadth_90d` | **no provider** | UNAVAILABLE → reason only, non-blocking |

`StrategyInput.underlyingPrice` = the `price_last_close` metric (a completed-session close, same basis as the technicals). The live TastyTrade price is **not** used for Gate 3: fundamentals and technicals are session-level, and Gate 4 takes its own timestamped spot.

## 4. Assembly rules (tested)

1. The three sources are merged into one `MetricSet`. Metric ids must be disjoint across sources; an id present in two sources is a contract error (throws in test, `INVALID` in production) — never "last one wins".
2. A source that failed contributes its ids as UNAVAILABLE with a source-specific reason (`FUNDAMENTALS_HTTP_502`, `FUNDAMENTALS_NETWORK`, `MARKET_METRICS_UNAVAILABLE`), so Gate 3 reports INSUFFICIENT_DATA with the named ids rather than a guessed state.
3. Every id QV-v1.0 reads is present in the set (VALID or not); an id missing from every source is added as UNAVAILABLE `NO_PROVIDER` (the two no-provider rows above).
4. `asOf` = one evaluation instant read once by the caller after all fetches (same rule as Gate 4, 4.1).
5. Nothing is copied from Find LEAPS or the screener; no `Number(x || 0)` coercion.

## 5. Run rules

- Input: the Opportunity Universe symbols (deduplicated, upper-cased). Concurrency 3. Per-symbol budget 30 s → that symbol's sources fail as `TIMEOUT` (rule 4.2).
- One `/market-metrics` request per batch of up to 50 symbols (the endpoint takes a list).
- Output per symbol: `{ symbol, input: StrategyInput, evaluation: StrategyEvaluation, sourceIssues: string[] }`, in input order. These pairs are exactly what `runQvLeaps` (Gate 4c) consumes.
- **Previous state:** none until Gate 7 (persistence). The strategy runs with no prior state; state transitions are not computed and the output says so (`previousState: null`). Gate 7 adds it.
- **SEC load:** `/api/fundamentals` makes several SEC calls per symbol. With concurrency 3 and SEC's published fair-access limit (10 requests/s per user agent) a 25-symbol universe is safe; a larger universe needs the server-side cache (follow-up, measured in the feasibility run).

## 6. Feasibility run (before the Gate 6 mock is approved)

This session cannot reach SEC or Yahoo (sandbox egress), so the first real run is Dean's: after the slice ships, a read-only console script on the production site runs the assembler + QV-v1.0 on his Opportunity Universe and prints, per symbol, the Gate 3 state, the blocking metric ids and the source issues. Purpose: confirm that real symbols can reach SETUP / ACTIONABLE with the data available, and size the SEC load. If none can, Gate 6 waits and the blocking ids decide the next data slice.

## 7. Tests (Quinn)

1. Metric map completeness: every id QV-v1.0 reads (from `QV_V1_0_POLICY.inputs` and the classifiers) is produced by exactly one source or is listed as no-provider; a new QV id without a source fails the test.
2. Disjointness: an id in two sources fails.
3. Source failures: fundamentals 502 / network / timeout and market-metrics failure each give UNAVAILABLE ids with the named reason, and QV returns INSUFFICIENT_DATA naming them; other symbols unaffected.
4. Golden assembly: a recorded `LoadedFundamentals` + market-metrics fixture (sanitized) assembles to a pinned `StrategyInput` and a pinned `StrategyEvaluation` (state and reason codes).
5. Determinism: the same payloads and `asOf` give a deep-equal input and evaluation; input order does not change any symbol's result.
6. Isolation: `lib/discovery/qv/assembleInput.ts` and `runUniverse.ts` stay inside the discovery guard (no fetch, no clock); only `lib/scans/qvUniverseTransport.ts` calls `fetch`; Find LEAPS goldens (`FindLeapsGolden.test.tsx`) unchanged.
7. End to end with Gate 4: assembled pairs feed `runQvLeaps` with mocked transports; non-qualifying symbols make zero chain calls.

## 8. Build order

One slice, one push: assembler + run + transport + tests 1-7, full suite, `tsconfig.check.json`; then Dean's feasibility run (Section 6); then the Gate 6 mock (Diane).
