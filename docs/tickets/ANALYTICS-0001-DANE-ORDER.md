# ANALYTICS-0001: Implementation order for Dane

Issued by: Frank (facilitator), 2026-10-06. Ticket: `docs/tickets/ANALYTICS-0001.md` (v2). Mock: Diane's "TradeEdge Analytics v3" canvas (claude.ai artifact; figures in it are illustrative).
Approved by Paul, Ian, Alan, Quinn. Dean approved the mock on 2026-10-06.

## Start trigger
Paul confirms the go in `docs/ROADMAP.md`. This ticket changes no scoring, qualification, recommendation, order path, or existing page behavior.

## Rules for every slice
- Read `docs/ROADMAP.md` first. Run `git status; git branch -vv; git stash list` and flag issues in 1 or 2 lines.
- Read only the ranges you need. Do not read `app/screener/page.tsx` or `app/portfolio/page.tsx` in full; grep for the symbol. No new named exports from any `page.tsx`; logic lives in `lib/` or `features/`.
- No TastyTrade call and no change to any order path. The new page is read-only.
- Reuse, do not reimplement: `buildPerformanceReport` (`lib/tradeLog/performanceMetrics.ts`), `buildPortfolioSummary` (`features/portfolio/positions-workspace/model/portfolioSummary.ts`), the leveraged catalog (`lib/instrument-metadata`, `resolveCatalogInstrumentMetadata`). An uncatalogued ticker is untagged, never guessed. If something you need is not exported, export it with no behavior change.
- Color follows the Positions page: red and green only on P&L numbers; amber for over-limit, over-max and needs-attention.
- One batched push per slice. Before the first push: code, tests, sibling-defect search, targeted tests, and the `tsconfig.check.json` type check. Slice A0 touches the Performance page, so ask Dean before running the full suite.
- Before handing off, state (a) which sibling paths you checked for the same class of bug and (b) that tsc and tests were actually run, with results. Never claim verification you did not run.
- Vercel Preview does not work for Dean. Production is the check, behind the hidden route (no nav link) until he confirms the numbers.
- Frank closes a slice only after required GitHub CI is green and the current head's Vercel build is Ready.

## Slice A0: share the period logic (extraction only)
- Move `PeriodPreset`, `PERIOD_PRESETS`, `presetDates` (about lines 34 to 46 of `app/performance/page.tsx`) into `lib/performance/period.ts` and import them back. `LS_PERF_PERIOD` stays `hunter-perf-period`. Performance behavior must be byte-identical.
- Tests: `presetDates` for every preset on ordinary days, month starts and ends, January (Last month crosses the year), a leap day, and the first of the year.
- Quinn reviews before the push.

## Slice A1: book analytics module (pure, in lib/)
New `lib/analytics/bookAnalytics.ts`. No fetch, no React, no clock read (the caller passes `now` and the period).
- Realized by month from the `buildPerformanceReport` `byMonth` output, each month marked `partial` when the period cuts it. Open P&L is a separate figure for the current month, never merged into a month's result.
- Total P&L only when `period.to` equals today (New York date); otherwise `null`.
- Capital by position type from `buildPortfolioSummary` groups (value and share); groups not held are listed as not held.
- Concentration by economic underlying: per-symbol capital on the same basis as the summary (extract the private per-symbol aggregation in `buildPortfolioSummary` into an exported helper, no behavior change), roll up through `resolveCatalogInstrumentMetadata(DIREXION_GATE1_BOOTSTRAP, symbol)` (`economicUnderlyingSymbol`), tag leveraged members, flag over `DEFAULT_EXPOSURE_LIMIT_PCT` (25) and a watch level at 15.
- Position size: position capital divided by account net liquidation value; bands 0-5, 5-10, 10+. If net liquidity is missing or not positive, return "Unavailable" and never fall back to deployed capital. Confirm where net liquidity is available (`balances?.netLiquidity` appears in `lib/portfolio-intelligence/dashboardComposition.ts`).
- Risk summary: needs-attention count from the summary total tile; expiring within 7 days from the position's existing expiry or DTE field (grep for an existing "expiring" definition and match it); over-limit and watch counts from the concentration result.
- DTE at entry: included closed trades in the period by `dteAtEntry`, bands 0-14, 15-29, 30-45, 46+; trades with a non-finite `dteAtEntry` counted as unknown. Win rate and average P&L through the existing `groupStats`.
- Monthly short-put P&L: included CSP trades, by close month, through `groupStats`.
- Open P&L by position: largest absolute contributors from each row's `position.pnl` (mid), each carrying the symbol and position key for the link.
- Tests: the eight reconciliation invariants in the ticket section 6 plus test 9. Alan supplies the golden fixtures; do not invent fixture values.
- Ian and Quinn review the module before the page starts.

## Slice A2: the page (after A1 is green)
- New `app/analytics/page.tsx`: layout and calls only. Match Diane's v3 panel order and copy; Diane gatekeeps the visual with Ian.
- Trades: the same load as Performance (`readCache('12m')`, `fetchAndReconstructTrades('12m')`, `writeCache`), filtered to the period by `closeDate`, with the user's excluded ids applied as Performance does.
- Positions, equities, pending orders, cash and balances: find what `app/portfolio/page.tsx` passes to `PositionsWorkspace` (`model`, `pendingOrders`, `cashBalance`) and what `usePortfolioData()` (`components/portfolio-data/PortfolioDataProvider.tsx`) exposes, and reuse it. If the model is built inline in `page.tsx`, extract that build to `lib/` with no behavior change and ask Quinn to review before the push. This path is unverified; confirm it before building.
- Period control: presets plus Custom from/to as on Performance, stored under `hunter-analytics-period`. Show the period and "as of now" labels as in the mock.
- No nav link. Link "Open Performance" and each Open P&L row to the existing pages.
- Tests: render test for the panels with a fixture; the period change updates realized panels only; "Unavailable" renders when net liquidity is missing.

## Done when
Each slice: CI green, current-head Vercel build Ready, the sibling-path statement and the verification statement delivered, Frank closes it, Paul updates `docs/ROADMAP.md`. After A2, Dean checks the numbers on production against Performance and Positions, then decides how the pages combine.
