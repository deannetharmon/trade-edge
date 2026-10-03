// lib/discovery/normalized/catalog.ts

// LEAPS-QV-0001 Gate 2 -- the data audit as data: every metric a QV strategy may read, where it comes from today,
// and how reliable that source is. Classification (Quinn Gate 1 ruling):
//   AVAILABLE   a provider field TradeEdge already fetches, verified in code, used without computation
//   DERIVABLE   computed by this layer from data TradeEdge already fetches
//   CONDITIONAL usable only if a stated condition holds (field presence not verifiable here, or a source whose
//               suitability for the Section 26 / 15 rules is unproven); the condition is recorded
//   UNAVAILABLE no source exists in TradeEdge today; the metric is reported UNAVAILABLE, never substituted
// `investmentSignificant` marks gaps that must go to Ian before Gate 3 (Section 37).

export type DataClassification = 'AVAILABLE' | 'DERIVABLE' | 'CONDITIONAL' | 'UNAVAILABLE';
export type MetricCategory = 'QUALITY' | 'VALUATION' | 'FUNDAMENTAL' | 'TECHNICAL' | 'RISK' | 'LEAPS';

export interface CatalogEntry {
  readonly id: string;
  readonly category: MetricCategory;
  readonly classification: DataClassification;
  readonly source: string;
  readonly investmentSignificant: boolean;
  readonly note: string;
}

const YAHOO = 'Yahoo daily closes via /api/chart-history (split-adjusted, dividend-unadjusted)';
const TT_MM = 'TastyTrade /market-metrics (lib/scans/tastytrade-client.ts getMarketMetrics)';
const CHAIN = 'option chain row (PMCC chain adapter / screener provider)';
const NONE = 'none in TradeEdge';

function entry(
  id: string,
  category: MetricCategory,
  classification: DataClassification,
  source: string,
  investmentSignificant: boolean,
  note: string,
): CatalogEntry {
  return Object.freeze({ id, category, classification, source, investmentSignificant, note });
}

export const METRIC_CATALOG: readonly CatalogEntry[] = Object.freeze([
  // --- Technical (Section 16) ---
  entry('price_last_close', 'TECHNICAL', 'DERIVABLE', YAHOO, false, 'Last completed daily close.'),
  entry('sma_50', 'TECHNICAL', 'DERIVABLE', YAHOO, false, 'Simple average of the last 50 closes.'),
  entry('sma_200', 'TECHNICAL', 'DERIVABLE', YAHOO, false, 'Needs 200 closes. lib/screener/provider.ts fabricates SMAs (price x 0.99/0.97/0.92); that code is not reused.'),
  entry('sma_200_change_20d_pct', 'TECHNICAL', 'DERIVABLE', YAHOO, false, 'SMA200 now vs 20 bars ago; the moving-average trend input.'),
  entry('rsi_daily_14', 'TECHNICAL', 'DERIVABLE', YAHOO, false, 'Wilder RSI(14) on completed bars; same maths as lib/indicators/rsi.ts.'),
  entry('rsi_weekly_14', 'TECHNICAL', 'DERIVABLE', YAHOO, false, 'Resampled from daily; only completed weeks. Needs 15 weekly closes.'),
  entry('rsi_weekly_change_4w', 'TECHNICAL', 'DERIVABLE', YAHOO, false, 'RSI slope input: weekly RSI now minus 4 weeks ago.'),
  entry('rsi_monthly_14', 'TECHNICAL', 'DERIVABLE', YAHOO, false, 'Resampled from daily; only completed months. Needs 15 monthly closes (>= ~16 months of bars).'),
  entry('distance_from_52w_high_pct', 'TECHNICAL', 'DERIVABLE', YAHOO, false, 'Close-based 52-week high (intraday highs are not in /api/chart-history). Needs ~1 year of bars.'),
  entry('relative_return_126d_vs_benchmark_pct', 'TECHNICAL', 'DERIVABLE', YAHOO, false, 'Six-month return minus benchmark return; benchmark choice (e.g. SPY) is a Gate 3 / Ian decision. UNAVAILABLE without a benchmark series.'),

  // --- Risk / event / volatility (Sections 18, 26) ---
  entry('implied_volatility_index', 'RISK', 'CONDITIONAL', TT_MM, false, 'Field mapped in existing code (implied-volatility-index); live payload presence not verifiable in this environment.'),
  entry('implied_volatility_30d', 'RISK', 'CONDITIONAL', TT_MM, false, 'As above (implied-volatility-30-day).'),
  entry('historical_volatility_30d', 'RISK', 'CONDITIONAL', TT_MM, false, 'As above (historical-volatility-30-day).'),
  entry('iv_rank_provider', 'RISK', 'CONDITIONAL', TT_MM, true, 'Provider-computed IV Rank. TradeEdge cannot verify the provider has enough history for Section 26. Labelled provider; never presented as iv_rank. Ian/Quinn to rule.'),
  entry('iv_rank_internal', 'RISK', 'UNAVAILABLE', NONE, true, 'Section 26: no historical IV series is stored anywhere in TradeEdge, so no internal IV Rank can be computed correctly.'),
  entry('iv_percentile_internal', 'RISK', 'UNAVAILABLE', NONE, true, 'Same as iv_rank_internal.'),
  entry('underlying_liquidity_rating', 'RISK', 'CONDITIONAL', TT_MM, false, 'liquidity-rating; present in existing mapping.'),
  entry('underlying_beta', 'RISK', 'CONDITIONAL', TT_MM, false, "Only the 'beta' field. Existing acquisition code falls back to 'beta-60-day' (different window); not replicated here."),
  entry('next_earnings_date', 'RISK', 'CONDITIONAL', TT_MM, false, 'earnings.expected-report-date; may be an estimate. FMP earning_calendar (lib/scans/eventCalendar.ts) is a second source, not yet reconciled.'),
  entry('days_to_next_earnings', 'RISK', 'CONDITIONAL', TT_MM, false, 'Derived from next_earnings_date and the evaluation date.'),
  entry('analyst_eps_revision_90d_pct', 'FUNDAMENTAL', 'UNAVAILABLE', NONE, true, 'Section 15: no analyst estimate or revision data in TradeEdge. Reported as Analyst Revision Data: UNAVAILABLE.'),
  entry('analyst_revenue_revision_90d_pct', 'FUNDAMENTAL', 'UNAVAILABLE', NONE, true, 'As above.'),
  entry('analyst_revision_breadth_90d', 'FUNDAMENTAL', 'UNAVAILABLE', NONE, true, 'As above.'),

  // --- Quality / fundamentals / valuation (Sections 10-14) ---
  entry('operating_margin_ttm_pct', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Derivation defined; no fundamentals provider feeds it.'),
  entry('fcf_ttm', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Operating cash flow minus capital expenditure; no provider.'),
  entry('fcf_margin_ttm_pct', 'QUALITY', 'UNAVAILABLE', NONE, true, 'No provider.'),
  entry('fcf_yield_pct', 'VALUATION', 'UNAVAILABLE', NONE, true, 'No provider.'),
  entry('roic_v1_pct', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Canonical ROIC-v1 fixed in fundamentals.ts; no provider. Do not approximate from any other field.'),
  entry('net_debt_to_ebitda', 'QUALITY', 'UNAVAILABLE', NONE, true, 'No provider.'),
  entry('pe_ttm', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Price is available but diluted EPS is not; no provider. Negative earnings are INVALID, not a multiple.'),
  entry('revenue_cagr_5y_pct', 'QUALITY', 'UNAVAILABLE', NONE, true, '/api/historical-growth is PRICE CAGR, not revenue growth; it must not stand in for this.'),
  entry('pe_ttm_percentile_5y', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Section 12: needs historical fundamentals, which do not exist here.'),
  entry('pe_ttm_median_5y', 'VALUATION', 'UNAVAILABLE', NONE, true, 'As above.'),
  entry('ev_to_ebitda_percentile_5y', 'VALUATION', 'UNAVAILABLE', NONE, true, 'As above.'),

  // --- LEAPS contract (Section 25) ---
  entry('contract_dte', 'LEAPS', 'DERIVABLE', CHAIN, false, 'Calendar days from the evaluation date to expiration.'),
  entry('contract_strike', 'LEAPS', 'AVAILABLE', CHAIN, false, 'strikePrice / strike_price.'),
  entry('contract_bid', 'LEAPS', 'AVAILABLE', CHAIN, false, 'bid; a missing bid is UNAVAILABLE, not 0.'),
  entry('contract_ask', 'LEAPS', 'AVAILABLE', CHAIN, false, 'ask; a missing ask is UNAVAILABLE, not 0.'),
  entry('contract_mid', 'LEAPS', 'DERIVABLE', CHAIN, false, 'Pricing basis is the mid (Ian to confirm vs ask). Crossed market is INVALID.'),
  entry('contract_spread_pct_of_mid', 'LEAPS', 'DERIVABLE', CHAIN, false, '(ask - bid) / mid.'),
  entry('contract_delta', 'LEAPS', 'AVAILABLE', CHAIN, false, 'Present in the PMCC chain adapter and screener provider.'),
  entry('contract_dollar_delta', 'LEAPS', 'DERIVABLE', CHAIN, false, 'delta x underlying x 100.'),
  entry('contract_theta', 'LEAPS', 'CONDITIONAL', CHAIN, false, 'Present in the generic screener provider shape; not in the PMCC chain adapter. Verify on the chain source used for LEAPS.'),
  entry('contract_vega', 'LEAPS', 'CONDITIONAL', CHAIN, false, 'As theta.'),
  entry('contract_implied_volatility', 'LEAPS', 'CONDITIONAL', CHAIN, false, 'implied_volatility in the generic provider shape; unit (fraction vs percent) must be confirmed per source.'),
  entry('contract_intrinsic_value', 'LEAPS', 'DERIVABLE', CHAIN, false, 'max(0, underlying - strike) for a call.'),
  entry('contract_extrinsic_value', 'LEAPS', 'DERIVABLE', CHAIN, false, 'mid - intrinsic; mid below intrinsic is INVALID.'),
  entry('contract_extrinsic_pct_of_mid', 'LEAPS', 'DERIVABLE', CHAIN, false, 'Matches the existing extrinsic-% concept in leapsScore.'),
  entry('contract_debit_per_contract', 'LEAPS', 'DERIVABLE', CHAIN, false, 'mid x 100.'),
  entry('contract_effective_leverage', 'LEAPS', 'DERIVABLE', CHAIN, false, 'delta x underlying / mid.'),
  entry('contract_breakeven_price', 'LEAPS', 'DERIVABLE', CHAIN, false, 'strike + mid.'),
  entry('contract_breakeven_move_pct', 'LEAPS', 'DERIVABLE', CHAIN, false, 'breakeven / underlying - 1.'),
  entry('contract_open_interest', 'LEAPS', 'AVAILABLE', CHAIN, false, 'Missing is UNAVAILABLE; screener provider coerces missing to 0 (not reused).'),
  entry('contract_volume', 'LEAPS', 'CONDITIONAL', CHAIN, false, 'In the generic provider shape; not in the PMCC chain adapter.'),
]);

export function catalogEntry(id: string): CatalogEntry | undefined {
  return METRIC_CATALOG.find((e) => e.id === id);
}

export function investmentSignificantGaps(): CatalogEntry[] {
  return METRIC_CATALOG.filter((e) => e.investmentSignificant && (e.classification === 'UNAVAILABLE' || e.classification === 'CONDITIONAL'));
}
