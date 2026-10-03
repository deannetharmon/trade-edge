# LEAPS-QV-0001 Gate 2 — Data Audit

Status: Gate 2 deliverable, awaiting Dane + Quinn exit review. Investment-significant limitations (section 4) go to Ian before Gate 3.
Machine-readable form: `lib/discovery/normalized/catalog.ts` (`METRIC_CATALOG`; a test keeps it identical to what the adapters emit).

Classification: **AVAILABLE** (provider field already fetched, used as-is) · **DERIVABLE** (computed from data already fetched) · **CONDITIONAL** (usable only if a stated condition holds) · **UNAVAILABLE** (no source in TradeEdge; reported UNAVAILABLE, never substituted).

## 1. What TradeEdge can fetch today

| Source | Fields | Notes |
|---|---|---|
| Yahoo chart (`/api/chart`, `/api/chart-history`) | Daily OHLC (6 months) / daily closes (1–N years) | Split-adjusted, dividend-unadjusted. **No fundamentals modules are called anywhere** (no `quoteSummary`, financials, estimates). |
| TastyTrade `/market-metrics` (`getMarketMetrics`) | IV index, IV 30d, HV 30d, provider IV Rank, liquidity rating, expected report date, per-expiration IVx, beta | Browser-side only; tokens ~15 min. |
| Option chains (PMCC chain adapter, screener provider) | strike, expiration, bid, ask, delta, OI; theta/vega/IV/volume only in the generic provider shape | |
| FMP (`lib/scans/eventCalendar.ts`) | Earnings calendar, dividends, splits | Calendar only. |
| `lib/scans/financials.ts` | PMCC/IC capital maths | **Not** company financials. |
| `/api/historical-growth` | Annualized **price** CAGR | **Not** revenue/EPS growth. Must never stand in for it. |

## 2. Classification by metric

**Technical (Section 16) — all DERIVABLE** from Yahoo daily closes: last close, SMA 50/200, SMA200 20-day change, RSI daily/weekly/monthly (Wilder 14, completed periods only), weekly-RSI 4-week change, close-based distance from 52-week high, 126-day return relative to a benchmark series. Constraints: monthly RSI needs ~16 months of bars; the 52-week high is close-based (no intraday highs in `/api/chart-history`); the benchmark choice is a Gate 3 / Ian decision.

**LEAPS contract (Section 25)** — AVAILABLE: strike, bid, ask, delta, OI. DERIVABLE: DTE, mid, spread %, dollar delta, intrinsic, extrinsic, extrinsic %, debit, effective leverage, breakeven, breakeven move. CONDITIONAL: theta, vega, IV, volume (present only in the generic provider shape; verify against the chain source used for LEAPS; IV unit must be confirmed per source). Pricing basis is the mid (Ian to confirm vs ask).

**Risk / event (Section 18)** — CONDITIONAL (field mapped in code, live payload not verifiable here): IV index, IV 30d, HV 30d, liquidity rating, beta (`beta` only), next earnings date and days-to-earnings (may be an estimate; FMP is a second, unreconciled source).

**Quality, valuation, fundamental momentum (Sections 10–14) — UNAVAILABLE.** No provider supplies revenue, EPS, margins, FCF, balance sheet, EBITDA, market cap, forward estimates or history. Affected: operating margin, FCF, FCF margin, FCF yield, ROIC, net debt/EBITDA, P/E, 5-year revenue CAGR, historical P/E and EV/EBITDA distributions and percentiles. Derivations and fail-closed rules are implemented and tested (`fundamentals.ts`) so definitions are fixed before data arrives, but nothing feeds them.

## 3. Explicit investigations

**Analyst estimates / revisions (Section 15): UNAVAILABLE.** No estimate or revision data exists in the repo (searched fetchers, routes, types, fixtures). Reported as `Analyst Revision Data: UNAVAILABLE`; the three revision metrics are UNAVAILABLE and are never neutral/stable/positive.

**Historical IV (Section 26): no series exists.** No stored IV history in Redis, localStorage or code. Therefore an internal IV Rank / IV Percentile is **UNAVAILABLE**. The provider-computed IV Rank is exposed only as `iv_rank_provider` (CONDITIONAL, labelled with its source, range-checked to 0–1) and never as `iv_rank`. Whether a provider rank satisfies "sufficient historical observations" cannot be verified by TradeEdge — **Ian/Quinn ruling needed.**

**Canonical ROIC (Section 37): defined, versioned `ROIC-v1`.** NOPAT_ttm / average(invested capital start, end); NOPAT = operating income × (1 − effective tax rate); effective rate = tax expense / pretax income, INVALID unless 0 ≤ rate < 1 and pretax > 0 (no statutory-rate substitute); invested capital = total debt + total equity − cash & equivalents; INVALID if the average ≤ 0. Any change is ROIC-v2. Ian to confirm the definition before a provider is chosen.

**Historical valuation distributions (Section 12): not feasible today** — they need reliable historical fundamentals. UNAVAILABLE.

## 4. Investment-significant limitations for Ian (before Gate 3)

1. No fundamentals provider: the whole Quality gate and Valuation dislocation are UNAVAILABLE. A QV-v1.0 that needs them cannot classify any candidate beyond INSUFFICIENT_DATA until a provider is approved (new external dependency; Paul/Ian decision).
2. Analyst revisions UNAVAILABLE (Section 15 explicitly conditional; the strategy must treat it as such and weigh it more when other fundamentals deteriorate).
3. No internal IV Rank/Percentile; provider IV Rank is CONDITIONAL.
4. Historical valuation percentile impossible without historical fundamentals.
5. Decisions for Ian: ROIC-v1 definition; mid vs ask pricing basis; benchmark for relative strength; close-based 52-week high acceptable?

## 5. Silent-substitution patterns found in existing code (not reused, not modified)

- `lib/screener/provider.ts`: `rsi || 50`, `sma20 = price × 0.99`, `sma50 = price × 0.97`, `sma200 = price × 0.92`, `open_interest || 0`, `bid || 0` fabricate values when a field is missing.
- `lib/portfolio-data/acquisition.ts`: `beta ?? 'beta-60-day'` mixes two different windows.
- `/api/historical-growth` is price growth, not business growth.
These do not affect Gate 2 (the discovery layer is isolated) but must not leak into QV; recorded for a separate ticket.
