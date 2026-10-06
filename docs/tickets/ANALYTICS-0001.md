# ANALYTICS-0001: Analytics page (new, additive): the "book" view, built on existing modules

Status: v2 DRAFT, team review recorded 2026-10-06 (section 8). Dean approved building it as a NEW page (2026-10-06); how it combines with existing screens is decided after it is live.
Mock: Diane's v2 canvas "TradeEdge Analytics v2" (claude.ai artifact). v3 is needed to match this scope (section 2).
Why v2: v1 of this ticket proposed a new calculation layer. A check of main (da6c3cb) found most of it already built, so v2 reuses it and adds only what is missing.

## 1. What already exists (do not rebuild)

| Mock section | Already built | Where |
|---|---|---|
| Closed-trade headline, win rate, expectancy, profit factor, max drawdown, return on capital at risk | PERF-0001 step 2a | `lib/tradeLog/performanceMetrics.ts` (`buildPerformanceReport`) |
| By strategy, by month (with running total), by ticker | PERF-0001 | same report; panels in `features/performance/PerformanceReportView.tsx` |
| "Rule discipline" (50% target, 2x stop, 21 DTE, beyond-stop leak) | PERF-0001 "Rule check" and "How trades ended" | same |
| Trades that cannot be totalled (incomplete, suspected rolls) | PERF-0001 "Needs review"; `reconstructTrades` flags them, never counts them as ordinary trades | `lib/tradeLog/reconstructTrades.ts` |
| P/L, capital, theta by position type; cash to deploy; largest exposure vs limit | PORTFOLIO-SUMMARY-0001 (implemented 2026-10-05) | `features/portfolio/positions-workspace/model/portfolioSummary.ts` |
| Exposure limit 25% (Dean decision 2026-10-05) | PORTFOLIO-SUMMARY-0001 | `DEFAULT_EXPOSURE_LIMIT_PCT` |
| Leveraged products and economic underlying | LEV-0001, issuer-confirmed catalog (leverage is never inferred from a ticker name) | `lib/instrument-metadata`, `lib/portfolio/leveragedPositionExposure.ts` |

## 2. Scope

In scope, phase 1: new route `/analytics`, these panels only:
1. Summary tiles: Realized, Open, Total, Capital deployed. Same numbers as Performance and Positions. The range control is the shared one used by Performance and the Trade Log: presets (1m to 12m) plus a custom from/to date. The range is shown beside every number.
2. Monthly P&L, realized vs open: realized bars from the PERF-0001 report by month; open P&L shown as its own bar for the current month. A month is never presented as a mix of the two.
3. Capital by strategy: the existing per-group capital from the portfolio summary, shown as shares of total. Groups with no capital say so.
4. Concentration by economic underlying: share of capital per underlying, leveraged products tagged from the catalog, with the existing 25% limit marked and a 15% warning level.
5. Position size distribution: positions per size band (share of account value), against the Prosper rule set's max 5-10% of portfolio per position.
6. Risk summary: needs-attention count (existing flag), expiring within 7 days, and a concentration alert row. No Low/Medium/High position tiers: no such tier exists in the app, so none is invented.
7. DTE at entry: closed trades by entry-DTE band against the 30-45 target window.
8. Monthly CSP P&L: the same PERF-0001 byMonth data filtered to CSP.
9. Open P&L by position: the largest open contributors, each linking to the position.

Out of scope:
- Anything in section 1: those panels stay on the Performance tab. This page shows the headline numbers and links to Performance for detail. No second copy of any table.
- Return on secured cash (1.88% a month, 22.6% annualized in the mock): deferred to ANALYTICS-0002 (section 7).
- Ticker Focus/Review status: dropped for now (ticker samples are 1 to 6 trades).
- Rule discipline panel: already exists as "Rule check".
- Changes to scoring, qualification, recommendations, risk limits, order paths, the Performance tab or the Positions page.
- New broker calls, AI calls or data sources. Phone layout (follows the platform layer).

## 3. Definitions (all adopted from existing code; Alan)

- Included trades: complete, not user-excluded, exactly as `buildPerformanceReport`. Incomplete and suspected-roll rows are excluded everywhere and counted in "Needs review" (this answers the open roll question).
- Win = pnl > 0. Win rate = wins / included trades (breakeven counts as not a win). Expectancy = net pnl / included trades. These are the existing definitions; no second win rate is introduced.
- Realized P&L: by close date, after fees, window as selected. Open P&L: mark-to-market on the same basis the Positions page uses (mid), labelled with the basis.
- Total = Realized + Open.
- Date range (Dean, 2026-10-06): a preset or a custom from/to, inclusive, by close date. Realized panels (Realized tile, monthly realized, DTE at entry, monthly short-put P&L) follow the range. Open P&L, capital, concentration, position size and risk are as of now and are labelled so. Total P&L is shown only when the range ends today; otherwise the tile shows Realized only, because realized for a past range plus open now would mix two moments. Months cut by the range are marked partial. A start earlier than the Trade Log's fetched lookback is limited to it, with the limit stated; trades opened before the lookback stay unmatched, as today.
- Position and group membership: the portfolio summary's groups, which partition the portfolio. This is the single count for Position size and Risk summary. (The 6-versus-10 mismatch seen in the mock came from the external mock, not the app.)
- Capital: the portfolio summary's per-group capital (`buildCapitalViewModel` basis). One basis for Capital by strategy and concentration.
- Position size % = position capital / account net liquidation value, because the rule set measures per-position size against the portfolio. Quinn confirms the field exists; if account value is unavailable the panel says "Unavailable" and does not silently fall back to deployed capital. Bands: 0-5, 5-10, 10+.
- DTE band by `ClosedTrade.dteAtEntry`: 0-14, 15-29, 30-45, 46+. Win rate and average P&L per band with the existing group stats.

## 4. Rules (Ian; Paul co-signs). Labels and alerts only; nothing here changes scanning or qualification.

- Concentration: alert at the existing 25% limit (Dean, 2026-10-05). New warning level at 15%, proposed.
- Position size (Prosper rule set: max 5-10% of portfolio per position): up to 5% "Within rule", 5-10% "Upper range", above 10% "Over max". The earlier 7-15% "Optimal" bands came from the external mock and contradicted the rule set; they are removed.
- DTE labels: "In target" for 30-45, "Outside target" otherwise. The label states the trader's rule, not a performance result. Samples are small; the page shows the trade count.
- Win rate and P&L show no good/bad color when a group has fewer than 3 trades.
- Color follows the Positions page convention (PORTFOLIO-SUMMARY-0001): red and green only on P&L numbers; amber for over-limit, over-max and needs-attention. Limits and bands never use red.

## 5. Architecture (Quinn)

- New `lib/analytics/bookAnalytics.ts`: pure functions that COMPOSE `buildPerformanceReport` and the portfolio summary builder. No re-implementation of any existing metric. If something needed is not exported, export it with no behavior change.
- No static leveraged list. Leverage tags come from `lib/instrument-metadata` and `leveragedPositionExposure`; an uncatalogued ticker is untagged, never guessed.
- `app/analytics/page.tsx`: layout and calls only; no named exports beyond the allowed Next.js list. The route has no nav link until Dean confirms the numbers.
- No new TastyTrade calls; browser-side acquisition stays as is.
- `bookAnalytics.ts` takes `{ from, to }` dates; presets are just ranges. The custom from/to control is added to the shared selector by RANGE-0001 (separate small ticket; touches Performance and the Trade Log; Paul scopes). Until RANGE-0001 ships, the page offers the presets only.
- Build order: A = `bookAnalytics.ts` + tests (green first), B = page.

## 6. Acceptance and tests

1. Realized + Open = Total.
2. Sum of monthly realized = Realized, and equals the Performance tab for the same window.
3. Page numbers equal PORTFOLIO-SUMMARY-0001's tiles (capital, groups) for the same moment.
4. Capital by strategy sums to total capital; groups partition the portfolio (none missing, none in two).
5. Concentration percentages sum to 100%; the 25% marker uses `DEFAULT_EXPOSURE_LIMIT_PCT`.
6. Position size band counts sum to the number of positions in the summary.
7. DTE band trade counts sum to the included trades with a known entry DTE; the rest are counted as "unknown".
8. A held leveraged product is tagged from the catalog; an uncatalogued ticker is not.
9. The range filter is inclusive by close date; each preset equals its custom equivalent; Total shows only when the range ends today; partial months are marked.

Golden fixture (Alan): a small hand-computed trade and position set. CI-0001 runs the suite on every push. Dean checks numbers on production behind the hidden route (Vercel Preview does not work for him).

## 7. Deferred

- ANALYTICS-0002: return on secured cash. `returnOnRiskPct` today is an aggregate over closed trades, not a time-weighted monthly return, so annualizing it is wrong. A real monthly figure needs average secured cash over time (daily position snapshots exist; history depth unverified). Alan to define before any build.
- Ticker Focus/Review status, once there are enough trades per ticker.

## 8. Team review (2026-10-06)

| Role | Verdict | Condition |
|---|---|---|
| Paul | Approved | Scope as section 2; Performance tab and Positions page untouched |
| Ian | Approved after correction | Position-size bands follow the rule set (5-10% max); 15% warning level is new; colors follow the Positions page; everything else reuses decided rules |
| Alan | Approved | Existing definitions adopted; return on secured cash deferred; golden fixture required |
| Quinn | Approved | Compose, do not reimplement; catalog-only leverage tags; hidden route first |
| Diane | Mock v3 needed | Remove the panels listed under "Out of scope", keep section 2's nine |

Dane builds phase A after Diane's v3 is approved by Dean.
