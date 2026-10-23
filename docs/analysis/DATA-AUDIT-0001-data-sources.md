# DATA-AUDIT-0001: Market and fundamentals data audit for the Portfolio Advisor

Date: 2026-10-23. Author: Dane. Scope: audit only; nothing in the app was changed. Budget constraint (Dean): $0, no new paid feeds.
Builds on `docs/analysis/LEAPS-QV-0001-gate2-data-audit.md` and `LEAPS-QV-0001-gate2b-sec-fundamentals.md`.

## Headline findings

1. **The earlier audit's "no fundamentals provider exists" is out of date.** Gate 2b built a free SEC EDGAR adapter (`lib/fundamentals/`, `GET /api/fundamentals`, `GET /api/qv-feasibility`). It was live-validated on AAPL in production on 2026-10-03. Revenue/EPS/margin/FCF/debt history, TTM P/E, EV/EBITDA, FCF yield, ROIC and 3y/5y P/E percentile are computed from filings at no cost. No paid feed is needed for the fundamentals the Advisor wants.
2. **FMP is used for one thing only**: an earnings / ex-dividend / split calendar (`lib/scans/eventCalendar.ts`, `app/api/event-risk/route.ts`). FMP fundamentals and price targets were removed (FUNDAMENTALS-0001/0002 reverted; `eventCalendar.ts:9-18`, `docs/ROADMAP.md:155`). The earnings date is already available free from TastyTrade `/market-metrics`; only ex-dividend depends on FMP.
3. **The FMP calendar call is wasteful and possibly not entitled.** Each `/api/event-risk` request makes 3 uncached FMP calls to the legacy `/api/v3` calendar endpoints for a date range (market-wide), then filters by symbol. On the free plan (250/day) that is about 83 symbol lookups a day at most. FMP's own site lists "Corporate Calendars" under its paid Premium tier, and the code comments mention free-tier access problems. Dean's plan and usage must be checked on the FMP dashboard.
4. **The Advisor's biggest data gaps are estimates, not fundamentals**: forward P/E, PEG, consensus, price targets, revisions, guidance and short interest have no source. Historical IV has no source either.
5. **Daily RSI exists but the portfolio recommendation path does not use it.** `lib/portfolio/trendClassification.ts` uses 60/90-day moving averages and 60-day momentum only. RSI lives in `lib/indicators/` and `lib/scans/rsiEntryForSymbol.ts` (screener side).
6. **Price history is all unofficial Yahoo** (six server routes plus two browser-direct calls). Three of the routes have no sign-in check. It works today, with no caching and no fallback.
7. **The AI gateway forbids web search** (`lib/ai-policy/providerClient.ts:13` blocks `tools`, `web_search`, `plugins`, `mcp`). "Claude looks up the story on the web" needs an explicit decision: a separate research step feeding grounded text into the gateway, or a policy exception.
8. **The stock intent vocabulary cannot express Dean's intents.** Stock choices are hold / wheel / undecided (`lib/positionIntent/vocabulary.ts:31`). There is no "hold and sell covered calls until it recovers" and no "cut and redeploy".
9. **Fundamentals coverage for the real book has known gaps.** ETFs (TQQQ, SOXL) are not SEC-covered by design. The ROADMAP (line 3) records an open concept-mapping defect: `roic_v1_pct` blocks UBER, META and NFLX, and NFLX P/E history and net debt/EBITDA also fail. SNDK has a short listing history, so expect 5-year metrics UNAVAILABLE (expectation, not tested).

## 1. Source inventory

| Source | Endpoints actually called | Where (file) | Fields used | Runs | Caching | Key / env var name | Rate limit and plan | Failure handling |
|---|---|---|---|---|---|---|---|---|
| **TastyTrade API** | `/accounts/{n}/positions`, `/accounts/{n}/balances`, `/market-data/by-type`, option chains, `/market-metrics?symbols=` | `lib/scans/tastytrade-client.ts:115`, `lib/portfolio-data/acquisition.ts:1439-1467` and `:2234`, `lib/discovery/normalized/optionMetrics.ts:243-276`, `components/BalancesTab.tsx:70` | positions and cost, net liq, buying power, quotes, IV, IVR, HV30, beta, liquidity rating, next earnings date (with "estimated" flag) | Browser-side (token about 15 min). Server proxy `/api/tastytrade/proxy` exists | None found | `TASTYTRADE_CLIENT_ID`, `TASTYTRADE_CLIENT_SECRET`, `REDIS_URL` | Brokerage account, free | Per-call try/catch; many fields fall back to missing |
| **Yahoo Finance chart (unofficial)** | `query1.finance.yahoo.com/v8/finance/chart/{sym}` (6mo daily OHLC, 1-10y closes, 6y closes, monthly closes) | `app/api/chart/route.ts:14`, `app/api/chart-history/route.ts:28`, `app/api/market/route.ts:26`, `app/api/historical-growth/route.ts:18`, `lib/fundamentals/handler.ts:82` | OHLC bars, daily closes (split-adjusted, dividend-unadjusted), index levels (VIX, ES), price CAGR | Server-side | `cache: 'no-store'` everywhere; memo only in `lib/scans/dailyBarsMemo.ts` | None | Unofficial and unlimited in theory; throttling and blocking possible | `/api/chart` returns error and callers map to `unknown`; closes failure becomes `PRICE_FETCH_FAILED` |
| **Yahoo search (news)** | `/v1/finance/search?q=&newsCount=8` | `app/screener/page.tsx:5297`, `app/rinse-repeat/page.tsx:555` | news headlines fed to AI prompts | **Browser-direct** (CORS-dependent) | None | None | Unofficial | Wrapped in try; failure leaves headlines empty (verify) |
| **Yahoo chart meta (sector)** | chart `meta.sector` | `app/rinse-repeat/page.tsx:98-101` | sector for non-mapped tickers | Browser-direct | None | None | Unofficial | Returns `'Unknown'`; `meta.sector` is not a documented field, so likely always Unknown (not tested) |
| **SEC EDGAR (free)** | `www.sec.gov/files/company_tickers.json`, `data.sec.gov/api/xbrl/companyfacts/CIK{n}.json`, `data.sec.gov/submissions/CIK{n}.json` | `lib/fundamentals/sec/client.ts:17-23,193-262`, `lib/fundamentals/secFundamentals.ts`, `app/api/fundamentals/route.ts`, `app/api/qv-feasibility/route.ts` | statements, TTM, ratios, 5y history, SIC code | Server-side, signed-in only | In-memory per serverless instance: facts 6h, directory and submissions 24h, negative 1h, 200 entries max | `SEC_USER_AGENT` (name plus email, mandatory) | Free; SEC limit 10 req/s per IP; client spaces at about 6/s per instance | Typed errors, 502 on provider failure, "not covered" is a normal 200 with all metrics UNAVAILABLE |
| **FMP** | legacy `financialmodelingprep.com/api/v3/earning_calendar`, `stock_dividend_calendar`, `stock_split_calendar` with `from`/`to` | `lib/scans/eventCalendar.ts:19-50`, `app/api/event-risk/route.ts` | earnings date, ex-dividend date, split date for one symbol | Server-side, signed-in only | `cache: 'no-store'`, no caching | `FMP_API_KEY` | Plan unknown from the repo. Free tier is 250 calls/day | Any error or non-array payload gives `complete: false`, treated as unavailable (fail-closed, good) |
| **OpenAI** | `/v1/chat/completions`, `/v1/responses` (web search path) | `app/api/analyze/route.ts:10-11,126`, `app/api/advisor/route.ts:99`, `app/api/leaps-advisor/route.ts:102`, `app/api/leaps-analysis/route.ts:23`, `app/api/ocr/route.ts:28`, `lib/ai-policy/providerClient.ts:10` | AI analysis, OCR of Finviz screenshots | Server-side | Gateway has snapshots/artifacts in Redis | `OPENAI_API_KEY`, `AI_*_MODEL`, `LEAPS_ANALYSIS_MODEL` | Paid per use | Gateway enforces budgets and forbids tools |
| **Anthropic** | `api.anthropic.com/v1/messages` | `app/long-book/page.tsx:484` | AI ranking of LEAP candidates | **Browser-direct, no API key header sent**, hard-coded model `claude-sonnet-4-20250514` | None | none | n/a | As written it cannot authenticate; confirm whether the page is live |
| **Screener provider** | `MARKET_DATA_API_URL` (default `api.tastyworks.com`) with bearer `MARKET_DATA_API_TOKEN` | `lib/screener/provider.ts:23-26`, `app/api/screener/[strategy]/route.ts` | option chain data for the server screener | Server-side | None found | `MARKET_DATA_API_URL`, `MARKET_DATA_API_TOKEN` | n/a | Prior audit lists silent substitutions here (`rsi || 50`, fabricated SMAs); not re-verified |
| **Finviz** | none (static link, OCR of screenshots) | `app/screener/page.tsx:11535-11561` | tickers only, via OCR | n/a | n/a | none | n/a | n/a |
| **Redis** | user data | `app/api/position-intent`, `position-notes`, entry snapshots, etc. | position intent, notes, snapshots, wheel config | Server-side | n/a | `REDIS_URL`, `KV_URL` | n/a | n/a |

Link-only references (no data pulled): TradingView, OCC, Google Calendar.

## 2. Field map

Status key: HAVE (reliable) / HAVE (fragile, unofficial) / PARTIAL / MISSING.

| Field | Status | Source today and note |
|---|---|---|
| Price / quote | HAVE (reliable) | TastyTrade quotes. Yahoo closes as fallback |
| Daily RSI, current and previous | HAVE (fragile) | Computed from Yahoo daily bars: `lib/indicators/rsi.ts`, `rsiTurn.ts`, `lib/scans/rsiEntryForSymbol.ts`. Not used by the portfolio recommendation path |
| Trend / moving averages / relative strength / 52-week distance | HAVE (fragile) | Portfolio trend: MA60/MA90 plus 60-day momentum (`lib/portfolio/trendClassification.ts:46`). QV technicals: SMA50/200, weekly/monthly RSI, relative return vs SPY (`/api/fundamentals`) |
| IV, IV rank, HV30 | HAVE (reliable) | TastyTrade `/market-metrics`. IVR is the provider's rank |
| Historical IV series | MISSING | No stored series; internal IV rank/percentile UNAVAILABLE by design |
| Earnings date | HAVE (reliable) | TastyTrade `expected-report-date` with estimated flag (`acquisition.ts:1458-1466`) |
| Ex-dividend date | PARTIAL | Only from the FMP calendar (entitlement unverified). No dividend field is read from TastyTrade today |
| Valuation, trailing (P/E, EV/EBITDA, FCF yield, price/FCF) | PARTIAL | SEC, US-GAAP filers only. ETFs not covered. Open mapping defects for UBER, META, NFLX (ROADMAP:3) |
| Valuation vs own history (3y/5y percentile, discount to median) | PARTIAL | SEC plus Yahoo closes. Needs enough history; new listings (SNDK) will not qualify |
| Forward P/E, PEG | MISSING | Needs analyst estimates |
| Growth, margins, FCF, ROIC, debt (history) | HAVE (reliable) | SEC `SECMAP-v1.1`, with provenance per metric. SEC-covered issuers only |
| Forward growth, estimates, revisions, guidance | MISSING | No source. Catalog marks all UNAVAILABLE |
| Analyst consensus and price targets | MISSING | FMP version removed as "opinion not metric" (`eventCalendar.ts:9-18`) |
| Short interest | MISSING | No source anywhere in the repo |
| Sector / industry | PARTIAL | SEC SIC code (`sector_classification`), static sector table in `lib/market/universe.ts` (about 500 names), static map in rinse-repeat |
| Beta | HAVE (reliable, caveat) | TastyTrade `beta`, falling back to `beta-60-day` (mixes two windows; `acquisition.ts:1454`) |
| News / catalysts | HAVE (fragile) | Yahoo headlines, browser-direct, unstructured. Corporate event flags UNAVAILABLE |
| Cost basis | HAVE (reliable) | TastyTrade `average-open-price` on positions (`lib/market/holdings.ts:47`, `acquisition.ts`) |
| Position intent | HAVE (reliable, vocabulary gap) | `/api/position-intent` store. Values: income, acquisition, neutral, wheel, hold, pmcc, undecided, directional, hedge. Stock choices are only hold / wheel / undecided |
| Balances, net liq, buying power, cash | HAVE (reliable) | TastyTrade `/balances`; `balancesNormalization.ts` |
| Concentration | HAVE (reliable) | `derivePositionConcentration` (max risk / net liq) |
| Opportunity set (screener candidates) | PARTIAL | Scans run in the browser (`ranked-scan-runner.ts`). I did not verify that results are stored anywhere the Advisor could read |
| ETF look-through (TQQQ, SOXL, MULL, METU) | MISSING | No SEC coverage. `LINKED_UNDERLYINGS` maps NVDL, MULL, METU to a stock for the map only |

Counts (23 fields): HAVE reliable 9, HAVE fragile 3, PARTIAL 5, MISSING 6.

## 3. FMP free-tier reality check

- **Endpoints called today:** 3 per `/api/event-risk` request: `earning_calendar`, `stock_dividend_calendar`, `stock_split_calendar`, all on the legacy `/api/v3` path.
- **Callers:** `app/screener/page.tsx:4767` (per result) and `features/portfolio/positions-workspace/PositionsWorkspace.tsx:261` (per LEAPS opportunity). Neither caches.
- **Current usage:** cannot be determined from the repo (no counters). Dean must read it from the FMP dashboard.
- **Headroom:** at 3 calls per symbol, 250 calls/day allows about 83 lookups. Expanding 30 screener results uses 90 calls. For the Advisor (about 12 held plus about 20 candidates = 32 symbols) the current pattern costs 96 calls, 38% of the day, before any screener use.
- **Better pattern:** the three calls take a date range and return the whole market, so one fetch per day for a 90-day window would serve every symbol. That is 3 calls a day if the plan allows it, cached in Redis.
- **Entitlement is unconfirmed.** FMP's site lists "Corporate Calendars" as a Premium-tier feature, and its docs now point new users to `/stable/` endpoints rather than `/api/v3/`. The code comments describe past "free-tier access problems" and treat any unexpected payload as unavailable. Not tested here: this environment has no `FMP_API_KEY`.
- **Free replacement for earnings:** TastyTrade `/market-metrics` already supplies the next earnings date in production.
- **Ex-dividend is the only FMP-only field.** Whether `/market-metrics` carries a dividend date is untested; capture one raw payload to find out.

## 4. Reliability risks

1. **Unofficial Yahoo is the single source for all price history** (RSI, trend, closes, VIX). Breakage, blocking or terms enforcement would take out RSI, trend and the technicals at once. All routes use `cache: 'no-store'`, so every page load refetches.
2. **Unauthenticated Yahoo proxies:** `/api/chart`, `/api/market`, `/api/historical-growth` have no session check (the `chart-history` header comment already notes the `/api/chart` gap). Anyone can use the app's server as a Yahoo proxy and burn its IP reputation.
3. **Browser-direct third-party calls** (Yahoo search, `long-book` to Anthropic) depend on CORS and send no credentials; the Anthropic call cannot authenticate as written.
4. **SEC limits are per serverless instance only** (Gate 2b Limitations). Aggregate traffic could exceed SEC's 10 req/s under concurrent runs. A Redis cache is the documented follow-up.
5. **Silent substitutions** recorded in the prior audit (`lib/screener/provider.ts`: `rsi || 50`, fabricated SMA values; `acquisition.ts:1454` beta window mixing). Not re-verified in this audit.
6. **Fail-closed behavior is good where it exists:** FMP incomplete payloads, SEC typed errors, trend `unknown`. The Advisor must carry that through: an unknown value must be shown as unknown, never as a neutral value.
7. **TastyTrade token expires about every 15 minutes and calls are browser-side only**, so a server-side daily snapshot job cannot call TastyTrade today; position-dependent facts must be gathered in the browser at report time.

## 5. Gaps and zero-cost options

| Gap | Zero-cost option | Risk |
|---|---|---|
| Earnings date | Already have it (TastyTrade) | none |
| Ex-dividend date | Check `/market-metrics` raw payload for a dividend field; else one cached daily FMP calendar call if entitled; else omit and say so | Needs a test; FMP entitlement |
| Forward estimates, consensus, price targets, revisions, guidance | No reliable free structured source. Claude with web search could summarize analyst commentary in words, labeled "web-sourced, unverified". Do not put it in numeric fields | Gateway forbids web search today; accuracy |
| Short interest | Not evaluated here | n/a |
| ETF look-through | Use the underlying stock or index data plus trend and RSI; label fundamentals "not applicable" | Leverage decay is not captured |
| News and catalysts | Claude web search at report time for held tickers only (about a dozen) | Cost per search; policy decision |
| Sector | SEC SIC code plus static table | Coarse |
| Historical IV | Start storing the daily IV/IVR per held ticker from `/market-metrics` in Redis now; a usable series builds over time | Needs weeks to be useful |
| Intent for stocks | Add "hold and sell covered calls" and "cut and redeploy" to the STOCK vocabulary (and equivalents for options) | UI change, needs Diane |
| Price history single-source risk | Cache bars in Redis; add auth to the open routes | Small change |
| Opportunity set | Persist the latest ranked-scan results per user so the Advisor can read them | Not verified; may exist |

## 6. Recommendation

**v1 input snapshot (free sources only), per held ticker:**
- Position: legs, quantities, cost basis, capital tied up, intent, note and its date.
- Account: net liq, buying power, concentration tier.
- Market: last price, 1-day change, IV, IVR, HV30, beta, next earnings date plus estimated flag.
- Technicals: daily RSI current and previous with turn state, MA60/MA90 trend, SMA50/200, relative strength vs SPY, distance from 52-week high.
- Fundamentals (SEC, covered issuers): operating margin, FCF margin, revenue and EPS growth, net debt/EBITDA, ROIC, P/E and EV/EBITDA with 3y/5y percentile. Every metric carries its UNAVAILABLE/INVALID reason; ETFs show "not applicable".
- Opportunities: top candidates from the latest scan, if persisted.
- Explicitly absent and labeled: consensus, price targets, forward P/E, short interest.

**Cache plan:** SEC facts 24h in Redis (filings change quarterly). Daily bars once per market day after the close, in Redis. Earnings and IV on each report run. Any calendar data 24h, one market-wide fetch.

**Smallest tickets, in order:**
1. **DATA-CACHE-0001:** shared Redis cache for SEC facts and Yahoo daily bars; add sign-in to `/api/chart`, `/api/market`, `/api/historical-growth` (close the open-proxy gap). Low risk.
2. **QV-COVERAGE-0001:** finish the open ROIC/NFLX mapping fixes already on the ROADMAP, then run `/api/qv-feasibility` for every held ticker and publish the coverage table (which holdings are covered, which are not). Needs Dean's live run.
3. **EVENTS-0002:** read earnings from `/market-metrics` only; capture the raw payload to see whether a dividend date exists; move FMP to one cached market-wide fetch or remove it if not entitled.
4. **HOLDING-FACTS-0001:** build the single facts snapshot above (this is what RECO-UNIFY-0001 needs), including RSI in the verdict inputs; Ian approves how RSI weights in.
5. **RESEARCH-0001:** decide how qualitative research enters: a separate web-search step outside the gateway feeding grounded text in, versus a gateway exception, plus the provider choice (AI-POLICY D3, Claude per Dean's 10/17 direction). Also INTENT-0002 for the missing stock intents (needs Diane's mock).

**When paying FMP would be justified:** only if Dean wants numeric consensus estimates or price targets inside the verdict and the free options above prove inadequate. FMP's site lists a plan with corporate calendars at about $49/month billed annually; Dean said paid feeds are not realistic, so the default is no.

## What only Dean can check

1. FMP dashboard: which plan the key is on, when it was created, and calls used today and this month.
2. Confirm `SEC_USER_AGENT` is still set in Vercel (it worked on 2026-10-03).
3. Run `/api/qv-feasibility?symbols=` for all current holdings (while signed in) and send the result.
4. In a signed-in browser session, capture one raw `/market-metrics` response for a held ticker (redact nothing sensitive; it contains no account data) to see whether dividend fields exist.
5. Say whether `app/long-book` is still used.
6. Confirm the Anthropic API key is available to put in Vercel if D3 is reopened (name only; do not paste it anywhere).

## Verification notes

- Sibling paths checked for the same data-handling issues: all four Yahoo routes, `fundamentals` and `qv-feasibility` routes, `event-risk`, `lib/portfolio/trendFetch.ts`, the browser-direct Yahoo and Anthropic calls, `lib/screener/provider.ts` (header only), the AI gateway request guard, and the position-intent store.
- Not checked: the full body of `app/screener/page.tsx` and `app/portfolio/page.tsx` (read by symbol only), whether scan results are persisted, live FMP behavior, live `/market-metrics` payload fields.
- No code, config or tests were changed. This file is the only change.
