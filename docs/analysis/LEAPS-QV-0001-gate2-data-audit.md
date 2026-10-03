# LEAPS-QV-0001 Gate 2 — Data Audit

Status: Gate 2 correction round (Quinn Gate 2 exit review: APPROVE WITH CHANGES, finding G2-B1). Awaiting Dane + Quinn re-review.
Machine-readable form: `lib/discovery/normalized/catalog.ts` (`METRIC_CATALOG`) and `specReconciliation.ts` (`SPEC_CONCEPTS`). Tests keep both consistent with the adapters and with each other.

Classification: **AVAILABLE** (provider field already fetched, used as-is) · **DERIVABLE** (computed from data already fetched) · **CONDITIONAL** (usable only if a stated condition holds) · **UNAVAILABLE** (no source in TradeEdge; reported UNAVAILABLE, never substituted). Counts today: 87 metrics — 5 AVAILABLE, 21 DERIVABLE, 12 CONDITIONAL, 49 UNAVAILABLE. A metric that is "not implemented" is catalog-only: no calculation exists and `catalogOnlyMetrics()` reports it UNAVAILABLE.

## 1. What TradeEdge can fetch today

| Source | Fields | Notes |
|---|---|---|
| Yahoo chart (`/api/chart`, `/api/chart-history`) | Daily OHLC (6 months) / daily closes (1–N years) | Split-adjusted, dividend-unadjusted. **No fundamentals modules are called anywhere.** |
| TastyTrade `/market-metrics` (`getMarketMetrics`) | IV index, IV 30d, HV 30d, provider IV Rank, liquidity rating, expected report date, per-expiration IVx | Browser-side only; tokens ~15 min. |
| Option chains (PMCC chain adapter, screener provider) | strike, expiration, bid, ask, delta, OI; theta/vega/IV/volume only in the generic provider shape | |
| FMP (`lib/scans/eventCalendar.ts`) | Earnings calendar, dividends, splits | Calendar only; entitlement of the existing key unverified (see 3). |
| `lib/scans/financials.ts` | PMCC/IC capital maths | **Not** company financials. |
| `/api/historical-growth` | Annualized **price** CAGR | **Not** revenue/EPS growth. Must never stand in for it. |

## 2. Ticket-to-catalog reconciliation (Sections 10–16, 18, 25, 26, 37)

Every data concept in the ticket maps to a catalog metric, or has a recorded reason it does not (ADAPTER_REQUIREMENT = a rule the future provider adapter must satisfy; GATE3_INTERPRETATION = a judgement made from metrics, not a data input; NOT_A_METRIC = deliberately not modelled; IAN_DECISION = methodology choice, no metric invented). Several concepts intentionally share one metric (e.g. EPS growth and EPS trajectory both use `eps_growth_yoy_ttm_pct`). A test fails if a catalog metric answers no ticket concept, if a concept points at a missing metric, or if the concepts Quinn named are unmapped.

| § | Ticket concept | Disposition | Catalog metric(s) | Note |
|---|---|---|---|---|
| 10 | 5Y revenue CAGR | MAPPED | `revenue_cagr_5y_pct` (UNAVAILABLE) |  |
| 10 | Revenue consistency | MAPPED | `revenue_growth_consistency_5y` (UNAVAILABLE, not implemented) | Consistency definition not fixed; Ian/Alan. |
| 10 | EPS growth | MAPPED | `eps_cagr_5y_pct` (UNAVAILABLE, not implemented)<br>`eps_growth_yoy_ttm_pct` (UNAVAILABLE, not implemented) |  |
| 10 | EPS consistency | MAPPED | `eps_growth_consistency_5y` (UNAVAILABLE, not implemented) | Consistency definition not fixed; Ian/Alan. |
| 10 | Operating margin | MAPPED | `operating_margin_ttm_pct` (UNAVAILABLE) |  |
| 10 | Operating margin trend | MAPPED | `operating_margin_trend_5y_pp` (UNAVAILABLE, not implemented) |  |
| 10 | FCF | MAPPED | `fcf_ttm` (UNAVAILABLE) |  |
| 10 | FCF margin | MAPPED | `fcf_margin_ttm_pct` (UNAVAILABLE) |  |
| 10 | ROIC / appropriate return measures | MAPPED | `roic_v1_pct` (UNAVAILABLE) | ROIC-v1 is the only return measure; adding others (e.g. ROE) is an Ian decision. ROIC-v1 itself needs Ian approval. |
| 10 | Earnings stability | MAPPED | `earnings_stability_5y` (UNAVAILABLE, not implemented) | Stability definition not fixed; Ian/Alan. |
| 10 | Margin stability | MAPPED | `operating_margin_stability_5y` (UNAVAILABLE, not implemented) | Stability definition not fixed; Ian/Alan. |
| 10 | FCF stability / trajectory | MAPPED | `fcf_stability_5y` (UNAVAILABLE, not implemented)<br>`fcf_trend_5y` (UNAVAILABLE, not implemented) | Definitions not fixed; Ian/Alan. |
| 10 | Debt | MAPPED | `total_debt` (UNAVAILABLE, not implemented) |  |
| 10 | Net debt | MAPPED | `net_debt` (UNAVAILABLE, not implemented) |  |
| 10 | Net debt / EBITDA | MAPPED | `net_debt_to_ebitda` (UNAVAILABLE) |  |
| 10 | Liquidity | MAPPED | `current_ratio` (UNAVAILABLE, not implemented) |  |
| 10 | Interest burden | MAPPED | `interest_coverage` (UNAVAILABLE, not implemented) |  |
| 10 | Balance-sheet strength / leverage | MAPPED | `total_debt` (UNAVAILABLE, not implemented)<br>`net_debt` (UNAVAILABLE, not implemented)<br>`net_debt_to_ebitda` (UNAVAILABLE)<br>`current_ratio` (UNAVAILABLE, not implemented)<br>`interest_coverage` (UNAVAILABLE, not implemented) | Composed by Gate 3 from these inputs; no composite metric here. |
| 10 | Defensible quantitative durability proxies | MAPPED | `roic_v1_pct` (UNAVAILABLE)<br>`earnings_stability_5y` (UNAVAILABLE, not implemented)<br>`operating_margin_stability_5y` (UNAVAILABLE, not implemented)<br>`fcf_stability_5y` (UNAVAILABLE, not implemented) | Which proxies QV-v1.0 relies on is an Ian decision. |
| 10 | Moat | NOT_A_METRIC | — | The ticket forbids claiming a measured moat without supporting data; none is modelled. |
| 11 | TTM P/E | MAPPED | `pe_ttm` (UNAVAILABLE) |  |
| 11 | Forward P/E | MAPPED | `pe_forward` (UNAVAILABLE, not implemented) | Needs analyst estimates; UNAVAILABLE even with an SEC adapter. |
| 11 | Historical P/E distribution; 3Y/5Y medians | MAPPED | `pe_ttm_median_3y` (UNAVAILABLE, not implemented)<br>`pe_ttm_median_5y` (UNAVAILABLE) |  |
| 11 | Historical valuation percentile | MAPPED | `pe_ttm_percentile_3y` (UNAVAILABLE, not implemented)<br>`pe_ttm_percentile_5y` (UNAVAILABLE)<br>`ev_to_ebitda_percentile_5y` (UNAVAILABLE) | Window (3Y vs 5Y) is an Ian decision. |
| 11 | Discount/premium to historical regime | MAPPED | `pe_ttm_discount_to_median_3y_pct` (UNAVAILABLE, not implemented)<br>`pe_ttm_discount_to_median_5y_pct` (UNAVAILABLE, not implemented)<br>`ev_to_ebitda_discount_to_median_5y_pct` (UNAVAILABLE, not implemented) |  |
| 11 | EV/EBITDA | MAPPED | `ev_to_ebitda_ttm` (UNAVAILABLE, not implemented) |  |
| 11 | Historical EV/EBITDA | MAPPED | `ev_to_ebitda_median_5y` (UNAVAILABLE, not implemented)<br>`ev_to_ebitda_percentile_5y` (UNAVAILABLE)<br>`ev_to_ebitda_discount_to_median_5y_pct` (UNAVAILABLE, not implemented) |  |
| 11 | FCF yield | MAPPED | `fcf_yield_pct` (UNAVAILABLE) |  |
| 11 | Price/FCF | MAPPED | `price_to_fcf` (UNAVAILABLE, not implemented) |  |
| 11 | PEG where meaningful | MAPPED | `peg_ratio` (UNAVAILABLE, not implemented) | Trailing vs forward growth basis, and what is "meaningful", are Ian decisions. |
| 11 | Sector/company-appropriate treatment | MAPPED | `sector_classification` (UNAVAILABLE, not implemented) | Which metrics apply to which sectors is an Ian decision. |
| 12 | Distributions from reliable historical prices and fundamentals | MAPPED | `pe_ttm_median_3y` (UNAVAILABLE, not implemented)<br>`pe_ttm_median_5y` (UNAVAILABLE)<br>`pe_ttm_percentile_3y` (UNAVAILABLE, not implemented)<br>`pe_ttm_percentile_5y` (UNAVAILABLE)<br>`ev_to_ebitda_median_5y` (UNAVAILABLE, not implemented)<br>`ev_to_ebitda_percentile_5y` (UNAVAILABLE) |  |
| 12 | Negative / near-zero earnings | ADAPTER_REQUIREMENT | `pe_ttm` (UNAVAILABLE) | pe_ttm already INVALID for non-positive EPS; "near-zero" cutoff is an Ian decision. |
| 12 | Abnormal observations, missing history, splits, material corporate events, fiscal-period changes, restatements | ADAPTER_REQUIREMENT | — | Fundamentals-adapter rules (Gate 2b): invalid observations must not enter a distribution. |
| 13 | Historical, current and forward growth | MAPPED | `revenue_cagr_5y_pct` (UNAVAILABLE)<br>`eps_cagr_5y_pct` (UNAVAILABLE, not implemented)<br>`eps_growth_yoy_ttm_pct` (UNAVAILABLE, not implemented)<br>`eps_growth_forward_pct` (UNAVAILABLE, not implemented) |  |
| 13 | Margin, EPS and FCF trajectory | MAPPED | `operating_margin_trend_5y_pp` (UNAVAILABLE, not implemented)<br>`operating_margin_change_yoy_pp` (UNAVAILABLE, not implemented)<br>`eps_growth_yoy_ttm_pct` (UNAVAILABLE, not implemented)<br>`fcf_trend_5y` (UNAVAILABLE, not implemented) |  |
| 13 | Growth-adjusted measures such as PEG | MAPPED | `peg_ratio` (UNAVAILABLE, not implemented) |  |
| 13 | Temporary compression vs rational repricing | GATE3_INTERPRETATION | — | A judgement made from the metrics above. |
| 14 | Price momentum (kept separate) | MAPPED | `price_last_close` (DERIVABLE)<br>`sma_50` (DERIVABLE)<br>`sma_200` (DERIVABLE)<br>`rsi_weekly_14` (DERIVABLE)<br>`relative_return_126d_vs_benchmark_pct` (DERIVABLE) |  |
| 14 | Revenue trajectory | MAPPED | `revenue_growth_yoy_ttm_pct` (UNAVAILABLE, not implemented)<br>`revenue_cagr_5y_pct` (UNAVAILABLE) |  |
| 14 | EPS trajectory | MAPPED | `eps_growth_yoy_ttm_pct` (UNAVAILABLE, not implemented) |  |
| 14 | FCF trajectory | MAPPED | `fcf_trend_5y` (UNAVAILABLE, not implemented) |  |
| 14 | Margin trajectory | MAPPED | `operating_margin_change_yoy_pp` (UNAVAILABLE, not implemented)<br>`operating_margin_trend_5y_pp` (UNAVAILABLE, not implemented) |  |
| 14 | Company guidance | MAPPED | `company_guidance` (UNAVAILABLE, not implemented) | No source. |
| 14 | Analyst revisions | MAPPED | `analyst_eps_revision_90d_pct` (UNAVAILABLE)<br>`analyst_revenue_revision_90d_pct` (UNAVAILABLE)<br>`analyst_revision_breadth_90d` (UNAVAILABLE) |  |
| 14 | Fundamental state classification (Section 14 three-state model) | GATE3_INTERPRETATION | — | Classification is Gate 3. |
| 15 | EPS and revenue revisions over useful horizons | MAPPED | `analyst_eps_revision_90d_pct` (UNAVAILABLE)<br>`analyst_revenue_revision_90d_pct` (UNAVAILABLE) | Only a 90-day horizon is catalogued; other horizons are an Ian decision once a source exists. |
| 15 | Current-year / next-year changes and expectations | MAPPED | `consensus_eps_current_year` (UNAVAILABLE, not implemented)<br>`consensus_eps_next_year` (UNAVAILABLE, not implemented)<br>`consensus_revenue_current_year` (UNAVAILABLE, not implemented)<br>`consensus_revenue_next_year` (UNAVAILABLE, not implemented) |  |
| 15 | Revision breadth | MAPPED | `analyst_revision_breadth_90d` (UNAVAILABLE) |  |
| 15 | Analyst Revision Data: UNAVAILABLE reporting | MAPPED | `analyst_eps_revision_90d_pct` (UNAVAILABLE)<br>`analyst_revenue_revision_90d_pct` (UNAVAILABLE)<br>`analyst_revision_breadth_90d` (UNAVAILABLE) | Reported UNAVAILABLE, never neutral/stable/positive. |
| 16 | Weekly RSI | MAPPED | `rsi_weekly_14` (DERIVABLE) |  |
| 16 | RSI slope | MAPPED | `rsi_weekly_change_4w` (DERIVABLE) |  |
| 16 | Monthly RSI | MAPPED | `rsi_monthly_14` (DERIVABLE) |  |
| 16 | Distance from 52-week high | MAPPED | `distance_from_52w_high_pct` (DERIVABLE) | Close-based; labelled as such. |
| 16 | Moving-average relationships / trends | MAPPED | `price_last_close` (DERIVABLE)<br>`sma_50` (DERIVABLE)<br>`sma_200` (DERIVABLE)<br>`sma_200_change_20d_pct` (DERIVABLE) | The relationships themselves are computed by Gate 3 from these inputs. |
| 16 | Relative strength | MAPPED | `relative_return_126d_vs_benchmark_pct` (DERIVABLE) | Benchmark choice is an Ian decision; lookback window is fixed at 126 bars pending Ian. |
| 16 | Base formation | IAN_DECISION | — | No definition exists. Derivable from daily bars once Ian/Alan define it; not invented here. |
| 16 | Momentum inflection | GATE3_INTERPRETATION | `rsi_weekly_change_4w` (DERIVABLE)<br>`sma_200_change_20d_pct` (DERIVABLE) | Interpreted from the slope metrics in Gate 3. |
| 16 | Technical state classification (Section 16 four-state model) | GATE3_INTERPRETATION | — | Classification is Gate 3. |
| 18 | Earnings | MAPPED | `next_earnings_date` (CONDITIONAL)<br>`days_to_next_earnings` (CONDITIONAL) |  |
| 18 | Guidance changes | MAPPED | `company_guidance` (UNAVAILABLE, not implemented) |  |
| 18 | Regulatory events, litigation, binary and company-specific events | MAPPED | `corporate_event_flags` (UNAVAILABLE, not implemented) | No source today. |
| 18 | Corporate actions | MAPPED | `corporate_actions_upcoming` (CONDITIONAL, not implemented) |  |
| 18 | Balance-sheet stress | MAPPED | `net_debt_to_ebitda` (UNAVAILABLE)<br>`interest_coverage` (UNAVAILABLE, not implemented)<br>`current_ratio` (UNAVAILABLE, not implemented) |  |
| 18 | Abnormal volatility | MAPPED | `implied_volatility_index` (CONDITIONAL)<br>`implied_volatility_30d` (CONDITIONAL)<br>`historical_volatility_30d` (CONDITIONAL) | IV minus HV is computed by Gate 3 from these. |
| 18 | Liquidity | MAPPED | `underlying_liquidity_rating` (CONDITIONAL)<br>`contract_open_interest` (AVAILABLE)<br>`contract_volume` (CONDITIONAL)<br>`contract_spread_pct_of_mid` (DERIVABLE) |  |
| 25 | DTE, strike, delta, dollar delta, debit, effective leverage, theta, extrinsic value, IV, vega, bid/ask, OI, volume, breakeven | MAPPED | `contract_dte` (DERIVABLE)<br>`contract_strike` (AVAILABLE)<br>`contract_delta` (AVAILABLE)<br>`contract_dollar_delta` (DERIVABLE)<br>`contract_debit_per_contract` (DERIVABLE)<br>`contract_effective_leverage` (DERIVABLE)<br>`contract_theta` (CONDITIONAL)<br>`contract_intrinsic_value` (DERIVABLE)<br>`contract_extrinsic_value` (DERIVABLE)<br>`contract_extrinsic_pct_of_mid` (DERIVABLE)<br>`contract_implied_volatility` (CONDITIONAL)<br>`contract_vega` (CONDITIONAL)<br>`contract_bid` (AVAILABLE)<br>`contract_ask` (AVAILABLE)<br>`contract_mid` (DERIVABLE)<br>`contract_open_interest` (AVAILABLE)<br>`contract_volume` (CONDITIONAL)<br>`contract_breakeven_price` (DERIVABLE)<br>`contract_breakeven_move_pct` (DERIVABLE) | Pricing basis (bid / mid / ask) is unresolved and goes to Ian by Gate 4; all three prices are retained. |
| 26 | Current IV | MAPPED | `contract_implied_volatility` (CONDITIONAL)<br>`implied_volatility_index` (CONDITIONAL)<br>`implied_volatility_30d` (CONDITIONAL) |  |
| 26 | IV Rank / IV Percentile | MAPPED | `iv_rank_internal` (UNAVAILABLE)<br>`iv_percentile_internal` (UNAVAILABLE)<br>`iv_rank_provider` (CONDITIONAL) | Internal metrics UNAVAILABLE (no historical IV series); provider rank is source-labelled evidence only. |
| 37 | Canonical ROIC | MAPPED | `roic_v1_pct` (UNAVAILABLE) | ROIC-v1 defined; Ian approval required before use as evidence. |
| 37 | Historical valuation distributions | MAPPED | `pe_ttm_median_5y` (UNAVAILABLE)<br>`pe_ttm_percentile_5y` (UNAVAILABLE)<br>`ev_to_ebitda_percentile_5y` (UNAVAILABLE) |  |
| 37 | Historical analyst estimate / revision data | MAPPED | `analyst_eps_revision_90d_pct` (UNAVAILABLE)<br>`analyst_revenue_revision_90d_pct` (UNAVAILABLE)<br>`analyst_revision_breadth_90d` (UNAVAILABLE) |  |
| 37 | Historical IV series | MAPPED | `iv_rank_internal` (UNAVAILABLE)<br>`iv_percentile_internal` (UNAVAILABLE) |  |
| 37 | Revenue / EPS / margin / cash-flow / balance-sheet history | MAPPED | `revenue_cagr_5y_pct` (UNAVAILABLE)<br>`eps_cagr_5y_pct` (UNAVAILABLE, not implemented)<br>`operating_margin_trend_5y_pp` (UNAVAILABLE, not implemented)<br>`fcf_trend_5y` (UNAVAILABLE, not implemented)<br>`total_debt` (UNAVAILABLE, not implemented) |  |
| 37 | Daily technicals, weekly/monthly RSI, moving averages, relative strength | MAPPED | `rsi_daily_14` (DERIVABLE)<br>`rsi_weekly_14` (DERIVABLE)<br>`rsi_monthly_14` (DERIVABLE)<br>`sma_50` (DERIVABLE)<br>`sma_200` (DERIVABLE)<br>`relative_return_126d_vs_benchmark_pct` (DERIVABLE) |  |
| 37 | Current option chains, Greeks, OI, volume, bid-ask, LEAPS expirations, current IV | MAPPED | `contract_delta` (AVAILABLE)<br>`contract_open_interest` (AVAILABLE)<br>`contract_volume` (CONDITIONAL)<br>`contract_bid` (AVAILABLE)<br>`contract_ask` (AVAILABLE)<br>`contract_dte` (DERIVABLE)<br>`contract_implied_volatility` (CONDITIONAL) |  |

## 3. Fundamentals data source

**No fundamentals provider exists today.** Quality, valuation, fundamental momentum and historical valuation are UNAVAILABLE, so QV cannot meaningfully run its Quality and Valuation gates until one is approved.

**Preferred no-subscription path: SEC EDGAR XBRL / companyfacts (approved by Quinn as primary; adapter NOT implemented, not authorized).** Official API; no key; published limit 10 requests/second per IP (target below it); a declared User-Agent (name + contact email) is mandatory; ticker→CIK mapping is published by the SEC.

Adapter requirements (Gate 2b): behind the normalized-data boundary; cache aggressively; map ticker→CIK; preserve filing/fiscal-period provenance; resolve XBRL concepts deterministically; detect ambiguous concepts and fail closed rather than guess; build TTM from appropriate quarterly/annual facts; handle fiscal-year differences; handle amended filings/restatements; avoid double-counting year-to-date facts as quarterly facts; keep filing date and period end separate; version the tag-resolution methodology; retain provenance explaining where each fundamental metric came from. The strategy must never know which XBRL tag supplied a number.

Limitations: SEC is not a universal provider. A security without SEC XBRL coverage (non-US issuers, ETFs, some instruments) reports its fundamentals **UNAVAILABLE**, never as company failure. XBRL carries no forward estimates, revisions or structured guidance, so forward P/E, forward growth, consensus expectations, revisions and company guidance remain UNAVAILABLE even with the adapter. The catalog records the *expected* classification with an SEC adapter per metric; it is an expectation to verify in Gate 2b, not a result.

**FMP fundamentals: CONDITIONAL — actual account/endpoint entitlement must be verified before reliance.** FMP's FAQ says the free plan allows 250 requests/day and up to 5 years of annual statements for US companies, but FMP's current pricing page places Annual Fundamentals and Ratios under the paid Starter plan. The documentation is internally inconsistent, so FMP is **not** a dependable free fallback and QV-v1.0 must not be designed around it. The existing `FMP_API_KEY` (earnings calendar, dividends, splits) should also be checked for entitlement.

Not recommended: Finnhub free (free endpoints unverifiable), Yahoo fundamentals (unofficial, fragile, against terms).

## 4. Explicit investigations

**Analyst estimates / revisions (Section 15): UNAVAILABLE.** No data in the repo; no reliable free source verified. Reported as `Analyst Revision Data: UNAVAILABLE`; the metrics are never neutral/stable/positive. Per the ticket they are CONDITIONAL for QV-v1.0.

**Historical IV (Section 26): no series exists.** Internal `iv_rank_internal` / `iv_percentile_internal` are UNAVAILABLE and must not be synthesized from current IV. `iv_rank_provider` is source-labelled CONDITIONAL evidence only (Quinn ruling), never exposed as `iv_rank` / `iv_percentile` unless TradeEdge holds enough historical observations to compute them.

**Canonical ROIC (Section 37): `ROIC-v1` defined, not yet approved for use.** NOPAT_ttm / average(invested capital at start and end of the TTM window); NOPAT = operating income × (1 − effective tax rate); effective rate = tax expense / pretax income, INVALID unless pretax > 0 and 0 ≤ rate < 1; invested capital = total debt + total equity − cash & equivalents; INVALID if the average ≤ 0. A definition change is ROIC-v2. **Ian must approve ROIC-v1 before Gate 3 uses it as evidence.**

**Historical valuation distributions (Section 12):** infeasible today; with an SEC adapter they become CONDITIONAL (need validation, per Section 37).

**Technicals:** the 52-week high is **close-based** (labelled `distance_from_52w_high_pct`; never presented as an intraday high).

## 5. Investment-significant questions routed to Ian (before Gate 3)

1. Approve or amend the **ROIC-v1** definition (and whether other return measures are wanted).
2. **Relative-strength benchmark**: SPY, sector, broad market, or another methodology. Not hard-coded; the 126-bar lookback also needs confirmation.
3. **Provider-computed IV Rank**: confirm it stays informational/source-labelled only (Quinn ruled it may remain CONDITIONAL).
4. **Analyst-revision unavailability**: confirm QV-v1.0 treats revisions as CONDITIONAL/UNAVAILABLE and how much weight missing revisions carry when other fundamentals deteriorate.
5. **Close-based 52-week high** acceptable as the evidence.
6. Which fundamental metrics are **REQUIRED vs OPTIONAL for ACTIONABLE**.
7. Any QV-v1.0 metrics **intentionally removed or deferred** from the approved framework (every one is currently carried in the catalog; the following need Ian/Alan definitions before they can be calculated: revenue/EPS consistency, earnings/margin/FCF stability, FCF trend, base formation, "near-zero" earnings cutoff, 3Y vs 5Y valuation window, PEG basis, sector-appropriate treatment).
8. **Unresolved, due no later than Gate 4:** contract entry pricing basis (bid / mid / ask). Gate 2 only provides descriptive bid, ask and mid; it does not assert mid is the economic entry price.

Plus the dependency decision for Paul/Ian: **Gate 2b — SEC Fundamentals Adapter** (recommended by Quinn, not authorized).

## 6. Silent-substitution patterns in existing code (not reused, not modified)

- `lib/screener/provider.ts`: `rsi || 50`, `sma20 = price × 0.99`, `sma50 = price × 0.97`, `sma200 = price × 0.92`, `open_interest || 0`, `bid || 0` fabricate values when a field is missing.
- `lib/portfolio-data/acquisition.ts`: `beta ?? 'beta-60-day'` mixes two different windows.
- `/api/historical-growth` is price growth, not business growth.
These do not affect the discovery layer (isolated) but must not leak into QV; recorded for a separate ticket.

## Appendix — full catalog

| Metric | Category | Today | Implemented | With SEC adapter (2b, to verify) | For Ian |
|---|---|---|---|---|---|
| `price_last_close` | TECHNICAL | DERIVABLE | yes | — |  |
| `sma_50` | TECHNICAL | DERIVABLE | yes | — |  |
| `sma_200` | TECHNICAL | DERIVABLE | yes | — |  |
| `sma_200_change_20d_pct` | TECHNICAL | DERIVABLE | yes | — |  |
| `rsi_daily_14` | TECHNICAL | DERIVABLE | yes | — |  |
| `rsi_weekly_14` | TECHNICAL | DERIVABLE | yes | — |  |
| `rsi_weekly_change_4w` | TECHNICAL | DERIVABLE | yes | — |  |
| `rsi_monthly_14` | TECHNICAL | DERIVABLE | yes | — |  |
| `distance_from_52w_high_pct` | TECHNICAL | DERIVABLE | yes | — |  |
| `relative_return_126d_vs_benchmark_pct` | TECHNICAL | DERIVABLE | yes | — |  |
| `implied_volatility_index` | RISK | CONDITIONAL | yes | — |  |
| `implied_volatility_30d` | RISK | CONDITIONAL | yes | — |  |
| `historical_volatility_30d` | RISK | CONDITIONAL | yes | — |  |
| `iv_rank_provider` | RISK | CONDITIONAL | yes | — | yes |
| `iv_rank_internal` | RISK | UNAVAILABLE | yes | — | yes |
| `iv_percentile_internal` | RISK | UNAVAILABLE | yes | — | yes |
| `underlying_liquidity_rating` | RISK | CONDITIONAL | yes | — |  |
| `next_earnings_date` | RISK | CONDITIONAL | yes | — |  |
| `days_to_next_earnings` | RISK | CONDITIONAL | yes | — |  |
| `analyst_eps_revision_90d_pct` | FUNDAMENTAL | UNAVAILABLE | yes | UNAVAILABLE | yes |
| `analyst_revenue_revision_90d_pct` | FUNDAMENTAL | UNAVAILABLE | yes | UNAVAILABLE | yes |
| `analyst_revision_breadth_90d` | FUNDAMENTAL | UNAVAILABLE | yes | UNAVAILABLE | yes |
| `operating_margin_ttm_pct` | QUALITY | UNAVAILABLE | yes | DERIVABLE | yes |
| `fcf_ttm` | QUALITY | UNAVAILABLE | yes | DERIVABLE | yes |
| `fcf_margin_ttm_pct` | QUALITY | UNAVAILABLE | yes | DERIVABLE | yes |
| `fcf_yield_pct` | VALUATION | UNAVAILABLE | yes | DERIVABLE | yes |
| `roic_v1_pct` | QUALITY | UNAVAILABLE | yes | CONDITIONAL | yes |
| `net_debt_to_ebitda` | QUALITY | UNAVAILABLE | yes | CONDITIONAL | yes |
| `pe_ttm` | VALUATION | UNAVAILABLE | yes | DERIVABLE | yes |
| `revenue_cagr_5y_pct` | QUALITY | UNAVAILABLE | yes | DERIVABLE | yes |
| `pe_ttm_percentile_5y` | VALUATION | UNAVAILABLE | yes | CONDITIONAL | yes |
| `pe_ttm_median_5y` | VALUATION | UNAVAILABLE | yes | CONDITIONAL | yes |
| `ev_to_ebitda_percentile_5y` | VALUATION | UNAVAILABLE | yes | CONDITIONAL | yes |
| `contract_dte` | LEAPS | DERIVABLE | yes | — |  |
| `contract_strike` | LEAPS | AVAILABLE | yes | — |  |
| `contract_bid` | LEAPS | AVAILABLE | yes | — |  |
| `contract_ask` | LEAPS | AVAILABLE | yes | — |  |
| `contract_mid` | LEAPS | DERIVABLE | yes | — |  |
| `contract_spread_pct_of_mid` | LEAPS | DERIVABLE | yes | — |  |
| `contract_delta` | LEAPS | AVAILABLE | yes | — |  |
| `contract_dollar_delta` | LEAPS | DERIVABLE | yes | — |  |
| `contract_theta` | LEAPS | CONDITIONAL | yes | — |  |
| `contract_vega` | LEAPS | CONDITIONAL | yes | — |  |
| `contract_implied_volatility` | LEAPS | CONDITIONAL | yes | — |  |
| `contract_intrinsic_value` | LEAPS | DERIVABLE | yes | — |  |
| `contract_extrinsic_value` | LEAPS | DERIVABLE | yes | — |  |
| `contract_extrinsic_pct_of_mid` | LEAPS | DERIVABLE | yes | — |  |
| `contract_debit_per_contract` | LEAPS | DERIVABLE | yes | — |  |
| `contract_effective_leverage` | LEAPS | DERIVABLE | yes | — |  |
| `contract_breakeven_price` | LEAPS | DERIVABLE | yes | — |  |
| `contract_breakeven_move_pct` | LEAPS | DERIVABLE | yes | — |  |
| `contract_open_interest` | LEAPS | AVAILABLE | yes | — |  |
| `contract_volume` | LEAPS | CONDITIONAL | yes | — |  |
| `revenue_growth_consistency_5y` | QUALITY | UNAVAILABLE | no | CONDITIONAL | yes |
| `eps_cagr_5y_pct` | QUALITY | UNAVAILABLE | no | DERIVABLE | yes |
| `eps_growth_yoy_ttm_pct` | QUALITY | UNAVAILABLE | no | DERIVABLE | yes |
| `eps_growth_consistency_5y` | QUALITY | UNAVAILABLE | no | CONDITIONAL | yes |
| `operating_margin_trend_5y_pp` | QUALITY | UNAVAILABLE | no | DERIVABLE | yes |
| `operating_margin_change_yoy_pp` | FUNDAMENTAL | UNAVAILABLE | no | DERIVABLE | yes |
| `fcf_trend_5y` | QUALITY | UNAVAILABLE | no | CONDITIONAL | yes |
| `earnings_stability_5y` | QUALITY | UNAVAILABLE | no | CONDITIONAL | yes |
| `operating_margin_stability_5y` | QUALITY | UNAVAILABLE | no | CONDITIONAL | yes |
| `fcf_stability_5y` | QUALITY | UNAVAILABLE | no | CONDITIONAL | yes |
| `total_debt` | QUALITY | UNAVAILABLE | no | CONDITIONAL | yes |
| `net_debt` | QUALITY | UNAVAILABLE | no | CONDITIONAL | yes |
| `current_ratio` | QUALITY | UNAVAILABLE | no | DERIVABLE | yes |
| `interest_coverage` | QUALITY | UNAVAILABLE | no | CONDITIONAL | yes |
| `revenue_growth_yoy_ttm_pct` | FUNDAMENTAL | UNAVAILABLE | no | DERIVABLE | yes |
| `eps_growth_forward_pct` | VALUATION | UNAVAILABLE | no | UNAVAILABLE | yes |
| `consensus_eps_current_year` | FUNDAMENTAL | UNAVAILABLE | no | UNAVAILABLE | yes |
| `consensus_eps_next_year` | FUNDAMENTAL | UNAVAILABLE | no | UNAVAILABLE | yes |
| `consensus_revenue_current_year` | FUNDAMENTAL | UNAVAILABLE | no | UNAVAILABLE | yes |
| `consensus_revenue_next_year` | FUNDAMENTAL | UNAVAILABLE | no | UNAVAILABLE | yes |
| `company_guidance` | FUNDAMENTAL | UNAVAILABLE | no | UNAVAILABLE | yes |
| `pe_forward` | VALUATION | UNAVAILABLE | no | UNAVAILABLE | yes |
| `ev_to_ebitda_ttm` | VALUATION | UNAVAILABLE | no | CONDITIONAL | yes |
| `price_to_fcf` | VALUATION | UNAVAILABLE | no | DERIVABLE | yes |
| `peg_ratio` | VALUATION | UNAVAILABLE | no | CONDITIONAL | yes |
| `pe_ttm_median_3y` | VALUATION | UNAVAILABLE | no | CONDITIONAL | yes |
| `pe_ttm_percentile_3y` | VALUATION | UNAVAILABLE | no | CONDITIONAL | yes |
| `pe_ttm_discount_to_median_3y_pct` | VALUATION | UNAVAILABLE | no | CONDITIONAL | yes |
| `pe_ttm_discount_to_median_5y_pct` | VALUATION | UNAVAILABLE | no | CONDITIONAL | yes |
| `ev_to_ebitda_median_5y` | VALUATION | UNAVAILABLE | no | CONDITIONAL | yes |
| `ev_to_ebitda_discount_to_median_5y_pct` | VALUATION | UNAVAILABLE | no | CONDITIONAL | yes |
| `sector_classification` | VALUATION | UNAVAILABLE | no | CONDITIONAL | yes |
| `corporate_event_flags` | RISK | UNAVAILABLE | no | CONDITIONAL | yes |
| `corporate_actions_upcoming` | RISK | CONDITIONAL | no | — |  |
