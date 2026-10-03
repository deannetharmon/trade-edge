// lib/discovery/normalized/catalog.ts

// LEAPS-QV-0001 Gate 2 -- the data audit as data: every metric a QV strategy may read, where it comes from today,
// and how reliable that source is. Classification (Quinn Gate 1 ruling):
//   AVAILABLE   a provider field TradeEdge already fetches, verified in code, used without computation
//   DERIVABLE   computed by this layer from data TradeEdge already fetches
//   CONDITIONAL usable only if a stated condition holds (field presence not verifiable here, or a source whose
//               suitability for the Section 26 / 15 rules is unproven); the condition is recorded
//   UNAVAILABLE no source exists in TradeEdge today; the metric is reported UNAVAILABLE, never substituted
// `investmentSignificant` marks gaps that must go to Ian before Gate 3 (Section 37).

import { unavailableMetric } from '../metrics';
import type { MetricSet } from '../metrics';
import { ANALYST_REVISION_METRIC_IDS, FUNDAMENTAL_METRIC_IDS, HISTORICAL_VALUATION_METRIC_IDS } from './fundamentals';
import { SEC_METRIC_IDS } from './sec/secFundamentals';
import { CONTRACT_METRIC_IDS, VOLATILITY_EVENT_METRIC_IDS } from './optionMetrics';
import { TECHNICAL_METRIC_IDS } from './technicals';

export type DataClassification = 'AVAILABLE' | 'DERIVABLE' | 'CONDITIONAL' | 'UNAVAILABLE';
export type MetricCategory = 'QUALITY' | 'VALUATION' | 'FUNDAMENTAL' | 'TECHNICAL' | 'RISK' | 'LEAPS';

/** What the SEC EDGAR adapter was expected to make of a metric (Gate 2 expectation, verified in Gate 2b). */
export type SecExpectation = 'DERIVABLE' | 'CONDITIONAL' | 'UNAVAILABLE' | null;

export interface CatalogEntry {
  readonly id: string;
  readonly category: MetricCategory;
  readonly classification: DataClassification;
  readonly source: string;
  readonly investmentSignificant: boolean;
  readonly note: string;
  /** True when an adapter in this layer can emit the metric today. False = catalog-only: reported UNAVAILABLE, no calculation exists. */
  readonly implemented: boolean;
  readonly expectedWithSecAdapter: SecExpectation;
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
): Omit<CatalogEntry, 'implemented' | 'expectedWithSecAdapter'> {
  return Object.freeze({ id, category, classification, source, investmentSignificant, note });
}

const METRIC_CATALOG_BASE: ReadonlyArray<Omit<CatalogEntry, 'implemented' | 'expectedWithSecAdapter'>> = [
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

  // --- Gate 2 correction (Quinn G2-B1): ticket concepts with no data source today. Catalog-only: no calculation exists. ---
  // Quality (Section 10)
  entry('revenue_growth_consistency_5y', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Section 10 "5Y revenue CAGR and consistency". Consistency definition not yet fixed (Ian).'),
  entry('eps_cagr_5y_pct', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Section 10 "EPS growth". Negative-base handling must be INVALID, not a rate.'),
  entry('eps_growth_yoy_ttm_pct', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Section 10/13/14 current EPS growth and EPS trajectory (one metric serves both concepts).'),
  entry('eps_growth_consistency_5y', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Section 10 "EPS growth and consistency". Definition not yet fixed (Ian).'),
  entry('operating_margin_trend_5y_pp', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Section 10 "operating margin trend" / Section 13-14 margin trajectory (long horizon).'),
  entry('operating_margin_change_yoy_pp', 'FUNDAMENTAL', 'UNAVAILABLE', NONE, true, 'Section 14 margin trajectory (recent horizon): TTM operating margin minus the prior-year TTM.'),
  entry('fcf_trend_5y', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Section 10 FCF trajectory/stability, Section 13-14 FCF trajectory. Trend definition not yet fixed (Ian).'),
  entry('earnings_stability_5y', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Section 10 "earnings stability". Definition not yet fixed (Ian).'),
  entry('operating_margin_stability_5y', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Section 10 "margin stability". Definition not yet fixed (Ian).'),
  entry('fcf_stability_5y', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Section 10 "FCF stability". Definition not yet fixed (Ian).'),
  entry('total_debt', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Section 10 "debt" / balance-sheet strength.'),
  entry('net_debt', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Section 10 "net debt": total debt minus cash and equivalents.'),
  entry('current_ratio', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Section 10 "liquidity" / balance-sheet strength.'),
  entry('interest_coverage', 'QUALITY', 'UNAVAILABLE', NONE, true, 'Section 10 "interest burden" / Section 18 balance-sheet stress.'),
  // Fundamental momentum (Section 14) and expectations (Sections 13, 15)
  entry('revenue_growth_yoy_ttm_pct', 'FUNDAMENTAL', 'UNAVAILABLE', NONE, true, 'Section 14 revenue trajectory (TTM vs prior-year TTM).'),
  entry('eps_growth_forward_pct', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Section 13 forward growth; needs analyst estimates (none).'),
  entry('consensus_eps_current_year', 'FUNDAMENTAL', 'UNAVAILABLE', NONE, true, 'Section 15 current-year expectation; needs analyst estimates (none).'),
  entry('consensus_eps_next_year', 'FUNDAMENTAL', 'UNAVAILABLE', NONE, true, 'Section 15 next-year expectation; needs analyst estimates (none).'),
  entry('consensus_revenue_current_year', 'FUNDAMENTAL', 'UNAVAILABLE', NONE, true, 'Section 15; needs analyst estimates (none).'),
  entry('consensus_revenue_next_year', 'FUNDAMENTAL', 'UNAVAILABLE', NONE, true, 'Section 15; needs analyst estimates (none).'),
  entry('company_guidance', 'FUNDAMENTAL', 'UNAVAILABLE', NONE, true, 'Section 14/18 "company guidance where available". No source; guidance is not structured XBRL data.'),
  // Valuation (Sections 11-12)
  entry('pe_forward', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Section 11 forward P/E; needs forward EPS estimates (none).'),
  entry('ev_to_ebitda_ttm', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Section 11 current EV/EBITDA. EV = market cap + total debt - cash; definition to be fixed.'),
  entry('price_to_fcf', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Section 11 Price/FCF (market cap / TTM FCF; INVALID for non-positive FCF).'),
  entry('peg_ratio', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Section 11/13 PEG "where meaningful". Trailing vs forward growth basis is an Ian decision.'),
  entry('pe_ttm_median_3y', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Section 11 3Y median; needs historical fundamentals and prices.'),
  entry('pe_ttm_percentile_3y', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Section 11-12 historical percentile (3Y window); window choice is an Ian decision.'),
  entry('pe_ttm_discount_to_median_3y_pct', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Section 11 discount/premium to the historical regime (3Y).'),
  entry('pe_ttm_discount_to_median_5y_pct', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Section 11 discount/premium to the historical regime (5Y).'),
  entry('ev_to_ebitda_median_5y', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Section 11 historical EV/EBITDA median.'),
  entry('ev_to_ebitda_discount_to_median_5y_pct', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Section 11 discount/premium to historical EV/EBITDA.'),
  entry('sector_classification', 'VALUATION', 'UNAVAILABLE', NONE, true, 'Section 11 "sector/company-appropriate treatment": no sector or industry data in TradeEdge.'),
  // Risk / event (Section 18)
  entry('corporate_event_flags', 'RISK', 'UNAVAILABLE', NONE, true, 'Section 18 regulatory events, litigation, binary and company-specific events: no source.'),
  entry('corporate_actions_upcoming', 'RISK', 'CONDITIONAL', 'FMP dividends/splits calendar (lib/scans/eventCalendar.ts, FMP_API_KEY)', false, 'Section 18 corporate actions. Entitlement of the existing FMP key must be verified (FMP lists some calendar endpoints as paid).'),
];

/** SEC adapter expectation (to be verified in Gate 2b). Anything absent here is null: not a fundamentals metric. */
const SEC_EXPECTATION: Readonly<Record<string, SecExpectation>> = Object.freeze({
  operating_margin_ttm_pct: 'DERIVABLE',
  fcf_ttm: 'DERIVABLE',
  fcf_margin_ttm_pct: 'DERIVABLE',
  fcf_yield_pct: 'DERIVABLE',
  roic_v1_pct: 'CONDITIONAL',
  net_debt_to_ebitda: 'CONDITIONAL',
  pe_ttm: 'DERIVABLE',
  revenue_cagr_5y_pct: 'DERIVABLE',
  revenue_growth_consistency_5y: 'CONDITIONAL',
  eps_cagr_5y_pct: 'DERIVABLE',
  eps_growth_yoy_ttm_pct: 'DERIVABLE',
  eps_growth_consistency_5y: 'CONDITIONAL',
  operating_margin_trend_5y_pp: 'DERIVABLE',
  operating_margin_change_yoy_pp: 'DERIVABLE',
  fcf_trend_5y: 'CONDITIONAL',
  earnings_stability_5y: 'CONDITIONAL',
  operating_margin_stability_5y: 'CONDITIONAL',
  fcf_stability_5y: 'CONDITIONAL',
  total_debt: 'CONDITIONAL',
  net_debt: 'CONDITIONAL',
  current_ratio: 'DERIVABLE',
  interest_coverage: 'CONDITIONAL',
  revenue_growth_yoy_ttm_pct: 'DERIVABLE',
  ev_to_ebitda_ttm: 'CONDITIONAL',
  price_to_fcf: 'DERIVABLE',
  peg_ratio: 'CONDITIONAL',
  pe_ttm_median_3y: 'CONDITIONAL',
  pe_ttm_median_5y: 'CONDITIONAL',
  pe_ttm_percentile_3y: 'CONDITIONAL',
  pe_ttm_percentile_5y: 'CONDITIONAL',
  pe_ttm_discount_to_median_3y_pct: 'CONDITIONAL',
  pe_ttm_discount_to_median_5y_pct: 'CONDITIONAL',
  ev_to_ebitda_median_5y: 'CONDITIONAL',
  ev_to_ebitda_percentile_5y: 'CONDITIONAL',
  ev_to_ebitda_discount_to_median_5y_pct: 'CONDITIONAL',
  sector_classification: 'CONDITIONAL',
  corporate_event_flags: 'CONDITIONAL',
  // SEC XBRL carries no forward estimates, revisions or structured guidance.
  pe_forward: 'UNAVAILABLE',
  eps_growth_forward_pct: 'UNAVAILABLE',
  consensus_eps_current_year: 'UNAVAILABLE',
  consensus_eps_next_year: 'UNAVAILABLE',
  consensus_revenue_current_year: 'UNAVAILABLE',
  consensus_revenue_next_year: 'UNAVAILABLE',
  company_guidance: 'UNAVAILABLE',
  analyst_eps_revision_90d_pct: 'UNAVAILABLE',
  analyst_revenue_revision_90d_pct: 'UNAVAILABLE',
  analyst_revision_breadth_90d: 'UNAVAILABLE',
});

const IMPLEMENTED_IDS: ReadonlySet<string> = new Set([
  ...TECHNICAL_METRIC_IDS,
  ...CONTRACT_METRIC_IDS,
  ...VOLATILITY_EVENT_METRIC_IDS,
  ...FUNDAMENTAL_METRIC_IDS,
  ...ANALYST_REVISION_METRIC_IDS,
  ...HISTORICAL_VALUATION_METRIC_IDS,
  ...SEC_METRIC_IDS,
]);

const SEC_BACKED_IDS: ReadonlySet<string> = new Set([...FUNDAMENTAL_METRIC_IDS, ...SEC_METRIC_IDS]);
const SEC_SOURCE = 'SEC EDGAR companyfacts via /api/fundamentals (free; SECMAP-v1.1)';
const SEC_CONDITION =
  'Gate 2b: SEC-backed. CONDITIONAL on the issuer being covered (US-GAAP XBRL filer in the SEC directory), the needed concepts resolving unambiguously, and a usable price history where price is an input; otherwise UNAVAILABLE or INVALID with a reason.';

/** Gate 2b: metrics the SEC adapter feeds move from UNAVAILABLE to CONDITIONAL (never AVAILABLE: coverage is per issuer). */
function withSecBacking(base: Omit<CatalogEntry, 'implemented' | 'expectedWithSecAdapter'>): Omit<CatalogEntry, 'implemented' | 'expectedWithSecAdapter'> {
  if (!SEC_BACKED_IDS.has(base.id)) return base;
  return Object.freeze({ ...base, classification: 'CONDITIONAL' as DataClassification, source: SEC_SOURCE, note: `${SEC_CONDITION} ${base.note}` });
}

/** Ids an adapter in this layer can emit (the catalog's implemented subset is asserted equal to this by a test). */
export const IMPLEMENTED_METRIC_IDS: readonly string[] = Object.freeze(Array.from(IMPLEMENTED_IDS).sort());

export const METRIC_CATALOG: readonly CatalogEntry[] = Object.freeze(
  METRIC_CATALOG_BASE.map(withSecBacking).map((base) =>
    Object.freeze({
      ...base,
      implemented: IMPLEMENTED_IDS.has(base.id),
      expectedWithSecAdapter: SEC_EXPECTATION[base.id] ?? null,
    }),
  ),
);

export function catalogEntry(id: string): CatalogEntry | undefined {
  return METRIC_CATALOG.find((e) => e.id === id);
}

export function investmentSignificantGaps(): CatalogEntry[] {
  return METRIC_CATALOG.filter((e) => e.investmentSignificant && (e.classification === 'UNAVAILABLE' || e.classification === 'CONDITIONAL'));
}

/**
 * UNAVAILABLE for every catalog metric no adapter implements, so a strategy's data-completeness count names them
 * explicitly instead of relying on an absent key (an absent key is UNAVAILABLE too, by getMetric).
 */
export function catalogOnlyMetrics(): MetricSet {
  const out: Record<string, ReturnType<typeof unavailableMetric>> = {};
  METRIC_CATALOG.filter((e) => !e.implemented).forEach((e) => {
    out[e.id] = unavailableMetric(e.id, 'NO_DATA_SOURCE');
  });
  return out;
}
