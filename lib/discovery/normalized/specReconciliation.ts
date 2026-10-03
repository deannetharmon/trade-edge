// lib/discovery/normalized/specReconciliation.ts

// LEAPS-QV-0001 Gate 2 correction (Quinn G2-B1) -- every data concept named in Sections 10-16, 18, 25, 26 and 37 of the
// approved ticket, mapped to the catalog metric(s) that carry it. Nothing is silently omitted:
//   MAPPED             one or more catalog metrics carry the concept (several concepts may share one metric)
//   ADAPTER_REQUIREMENT a data-handling rule the (future) provider adapter must satisfy; not a metric
//   GATE3_INTERPRETATION  a judgement made from metrics by the strategy, not a data input
//   NOT_A_METRIC       deliberately not modelled (reason recorded)
//   IAN_DECISION       methodology choice that blocks a definition; routed to Ian, no metric invented
// The status of each mapped metric (AVAILABLE/DERIVABLE/CONDITIONAL/UNAVAILABLE) lives in METRIC_CATALOG.

export type SpecDisposition = 'MAPPED' | 'ADAPTER_REQUIREMENT' | 'GATE3_INTERPRETATION' | 'NOT_A_METRIC' | 'IAN_DECISION';

export interface SpecConcept {
  readonly section: number;
  readonly concept: string;
  readonly disposition: SpecDisposition;
  readonly metricIds: readonly string[];
  readonly note: string;
}

function c(section: number, concept: string, disposition: SpecDisposition, metricIds: string[], note = ''): SpecConcept {
  return Object.freeze({ section, concept, disposition, metricIds: Object.freeze(metricIds), note });
}

export const SPEC_CONCEPTS: readonly SpecConcept[] = Object.freeze([
  // Section 10 -- Quality
  c(10, '5Y revenue CAGR', 'MAPPED', ['revenue_cagr_5y_pct']),
  c(10, 'Revenue consistency', 'MAPPED', ['revenue_growth_consistency_5y'], 'Consistency definition not fixed; Ian.'),
  c(10, 'EPS growth', 'MAPPED', ['eps_cagr_5y_pct', 'eps_growth_yoy_ttm_pct']),
  c(10, 'EPS consistency', 'MAPPED', ['eps_growth_consistency_5y'], 'Consistency definition not fixed; Ian.'),
  c(10, 'Operating margin', 'MAPPED', ['operating_margin_ttm_pct']),
  c(10, 'Operating margin trend', 'MAPPED', ['operating_margin_trend_5y_pp']),
  c(10, 'FCF', 'MAPPED', ['fcf_ttm']),
  c(10, 'FCF margin', 'MAPPED', ['fcf_margin_ttm_pct']),
  c(10, 'ROIC / appropriate return measures', 'MAPPED', ['roic_v1_pct'], 'ROIC-v1 is the only return measure; adding others (e.g. ROE) is an Ian decision. ROIC-v1 itself needs Ian approval.'),
  c(10, 'Earnings stability', 'MAPPED', ['earnings_stability_5y'], 'Stability definition not fixed; Ian.'),
  c(10, 'Margin stability', 'MAPPED', ['operating_margin_stability_5y'], 'Stability definition not fixed; Ian.'),
  c(10, 'FCF stability / trajectory', 'MAPPED', ['fcf_stability_5y', 'fcf_trend_5y'], 'Definitions not fixed; Ian.'),
  c(10, 'Debt', 'MAPPED', ['total_debt']),
  c(10, 'Net debt', 'MAPPED', ['net_debt']),
  c(10, 'Net debt / EBITDA', 'MAPPED', ['net_debt_to_ebitda']),
  c(10, 'Liquidity', 'MAPPED', ['current_ratio']),
  c(10, 'Interest burden', 'MAPPED', ['interest_coverage']),
  c(10, 'Balance-sheet strength / leverage', 'MAPPED', ['total_debt', 'net_debt', 'net_debt_to_ebitda', 'current_ratio', 'interest_coverage'], 'Composed by Gate 3 from these inputs; no composite metric here.'),
  c(10, 'Defensible quantitative durability proxies', 'MAPPED', ['roic_v1_pct', 'earnings_stability_5y', 'operating_margin_stability_5y', 'fcf_stability_5y'], 'Which proxies QV-v1.0 relies on is an Ian decision.'),
  c(10, 'Moat', 'NOT_A_METRIC', [], 'The ticket forbids claiming a measured moat without supporting data; none is modelled.'),
  // Section 11 -- Valuation
  c(11, 'TTM P/E', 'MAPPED', ['pe_ttm']),
  c(11, 'Forward P/E', 'MAPPED', ['pe_forward'], 'Needs analyst estimates; UNAVAILABLE even with an SEC adapter.'),
  c(11, 'Historical P/E distribution; 3Y/5Y medians', 'MAPPED', ['pe_ttm_median_3y', 'pe_ttm_median_5y']),
  c(11, 'Historical valuation percentile', 'MAPPED', ['pe_ttm_percentile_3y', 'pe_ttm_percentile_5y', 'ev_to_ebitda_percentile_5y'], 'Window (3Y vs 5Y) is an Ian decision.'),
  c(11, 'Discount/premium to historical regime', 'MAPPED', ['pe_ttm_discount_to_median_3y_pct', 'pe_ttm_discount_to_median_5y_pct', 'ev_to_ebitda_discount_to_median_5y_pct']),
  c(11, 'EV/EBITDA', 'MAPPED', ['ev_to_ebitda_ttm']),
  c(11, 'Historical EV/EBITDA', 'MAPPED', ['ev_to_ebitda_median_5y', 'ev_to_ebitda_percentile_5y', 'ev_to_ebitda_discount_to_median_5y_pct']),
  c(11, 'FCF yield', 'MAPPED', ['fcf_yield_pct']),
  c(11, 'Price/FCF', 'MAPPED', ['price_to_fcf']),
  c(11, 'PEG where meaningful', 'MAPPED', ['peg_ratio'], 'Trailing vs forward growth basis, and what is "meaningful", are Ian decisions.'),
  c(11, 'Sector/company-appropriate treatment', 'MAPPED', ['sector_classification'], 'Which metrics apply to which sectors is an Ian decision.'),
  // Section 12 -- Historical valuation
  c(12, 'Distributions from reliable historical prices and fundamentals', 'MAPPED', ['pe_ttm_median_3y', 'pe_ttm_median_5y', 'pe_ttm_percentile_3y', 'pe_ttm_percentile_5y', 'ev_to_ebitda_median_5y', 'ev_to_ebitda_percentile_5y']),
  c(12, 'Negative / near-zero earnings', 'ADAPTER_REQUIREMENT', ['pe_ttm'], 'pe_ttm already INVALID for non-positive EPS; "near-zero" cutoff is an Ian decision.'),
  c(12, 'Abnormal observations, missing history, splits, material corporate events, fiscal-period changes, restatements', 'ADAPTER_REQUIREMENT', [], 'Fundamentals-adapter rules (Gate 2b): invalid observations must not enter a distribution.'),
  // Section 13 -- Growth-adjusted valuation
  c(13, 'Historical, current and forward growth', 'MAPPED', ['revenue_cagr_5y_pct', 'eps_cagr_5y_pct', 'eps_growth_yoy_ttm_pct', 'eps_growth_forward_pct']),
  c(13, 'Margin, EPS and FCF trajectory', 'MAPPED', ['operating_margin_trend_5y_pp', 'operating_margin_change_yoy_pp', 'eps_growth_yoy_ttm_pct', 'fcf_trend_5y']),
  c(13, 'Growth-adjusted measures such as PEG', 'MAPPED', ['peg_ratio']),
  c(13, 'Temporary compression vs rational repricing', 'GATE3_INTERPRETATION', [], 'A judgement made from the metrics above.'),
  // Section 14 -- Fundamental integrity and momentum
  c(14, 'Price momentum (kept separate)', 'MAPPED', ['price_last_close', 'sma_50', 'sma_200', 'rsi_weekly_14', 'relative_return_126d_vs_benchmark_pct']),
  c(14, 'Revenue trajectory', 'MAPPED', ['revenue_growth_yoy_ttm_pct', 'revenue_cagr_5y_pct']),
  c(14, 'EPS trajectory', 'MAPPED', ['eps_growth_yoy_ttm_pct']),
  c(14, 'FCF trajectory', 'MAPPED', ['fcf_trend_5y']),
  c(14, 'Margin trajectory', 'MAPPED', ['operating_margin_change_yoy_pp', 'operating_margin_trend_5y_pp']),
  c(14, 'Company guidance', 'MAPPED', ['company_guidance'], 'No source.'),
  c(14, 'Analyst revisions', 'MAPPED', ['analyst_eps_revision_90d_pct', 'analyst_revenue_revision_90d_pct', 'analyst_revision_breadth_90d']),
  c(14, 'Fundamental state classification (Section 14 three-state model)', 'GATE3_INTERPRETATION', [], 'Classification is Gate 3.'),
  // Section 15 -- Analyst estimates and revisions
  c(15, 'EPS and revenue revisions over useful horizons', 'MAPPED', ['analyst_eps_revision_90d_pct', 'analyst_revenue_revision_90d_pct'], 'Only a 90-day horizon is catalogued; other horizons are an Ian decision once a source exists.'),
  c(15, 'Current-year / next-year changes and expectations', 'MAPPED', ['consensus_eps_current_year', 'consensus_eps_next_year', 'consensus_revenue_current_year', 'consensus_revenue_next_year']),
  c(15, 'Revision breadth', 'MAPPED', ['analyst_revision_breadth_90d']),
  c(15, 'Analyst Revision Data: UNAVAILABLE reporting', 'MAPPED', ['analyst_eps_revision_90d_pct', 'analyst_revenue_revision_90d_pct', 'analyst_revision_breadth_90d'], 'Reported UNAVAILABLE, never neutral/stable/positive.'),
  // Section 16 -- Technical state
  c(16, 'Weekly RSI', 'MAPPED', ['rsi_weekly_14']),
  c(16, 'RSI slope', 'MAPPED', ['rsi_weekly_change_4w']),
  c(16, 'Monthly RSI', 'MAPPED', ['rsi_monthly_14']),
  c(16, 'Distance from 52-week high', 'MAPPED', ['distance_from_52w_high_pct'], 'Close-based; labelled as such.'),
  c(16, 'Moving-average relationships / trends', 'MAPPED', ['price_last_close', 'sma_50', 'sma_200', 'sma_200_change_20d_pct'], 'The relationships themselves are computed by Gate 3 from these inputs.'),
  c(16, 'Relative strength', 'MAPPED', ['relative_return_126d_vs_benchmark_pct'], 'Benchmark choice is an Ian decision; lookback window is fixed at 126 bars pending Ian.'),
  c(16, 'Base formation', 'IAN_DECISION', [], 'No definition exists. Derivable from daily bars once Ian define it; not invented here.'),
  c(16, 'Momentum inflection', 'GATE3_INTERPRETATION', ['rsi_weekly_change_4w', 'sma_200_change_20d_pct'], 'Interpreted from the slope metrics in Gate 3.'),
  c(16, 'Technical state classification (Section 16 four-state model)', 'GATE3_INTERPRETATION', [], 'Classification is Gate 3.'),
  // Section 18 -- Risk / event
  c(18, 'Earnings', 'MAPPED', ['next_earnings_date', 'days_to_next_earnings']),
  c(18, 'Guidance changes', 'MAPPED', ['company_guidance']),
  c(18, 'Regulatory events, litigation, binary and company-specific events', 'MAPPED', ['corporate_event_flags'], 'No source today.'),
  c(18, 'Corporate actions', 'MAPPED', ['corporate_actions_upcoming']),
  c(18, 'Balance-sheet stress', 'MAPPED', ['net_debt_to_ebitda', 'interest_coverage', 'current_ratio']),
  c(18, 'Abnormal volatility', 'MAPPED', ['implied_volatility_index', 'implied_volatility_30d', 'historical_volatility_30d'], 'IV minus HV is computed by Gate 3 from these.'),
  c(18, 'Liquidity', 'MAPPED', ['underlying_liquidity_rating', 'contract_open_interest', 'contract_volume', 'contract_spread_pct_of_mid']),
  // Section 25 -- LEAPS suitability inputs
  c(25, 'DTE, strike, delta, dollar delta, debit, effective leverage, theta, extrinsic value, IV, vega, bid/ask, OI, volume, breakeven', 'MAPPED', [
    'contract_dte', 'contract_strike', 'contract_delta', 'contract_dollar_delta', 'contract_debit_per_contract', 'contract_effective_leverage',
    'contract_theta', 'contract_intrinsic_value', 'contract_extrinsic_value', 'contract_extrinsic_pct_of_mid', 'contract_implied_volatility', 'contract_vega',
    'contract_bid', 'contract_ask', 'contract_mid', 'contract_open_interest', 'contract_volume', 'contract_breakeven_price', 'contract_breakeven_move_pct',
  ], 'Pricing basis (bid / mid / ask) is unresolved and goes to Ian by Gate 4; all three prices are retained.'),
  // Section 26 -- Historical IV
  c(26, 'Current IV', 'MAPPED', ['contract_implied_volatility', 'implied_volatility_index', 'implied_volatility_30d']),
  c(26, 'IV Rank / IV Percentile', 'MAPPED', ['iv_rank_internal', 'iv_percentile_internal', 'iv_rank_provider'], 'Internal metrics UNAVAILABLE (no historical IV series); provider rank is source-labelled evidence only.'),
  // Section 37 -- Data feasibility
  c(37, 'Canonical ROIC', 'MAPPED', ['roic_v1_pct'], 'ROIC-v1 defined; Ian approval required before use as evidence.'),
  c(37, 'Historical valuation distributions', 'MAPPED', ['pe_ttm_median_5y', 'pe_ttm_percentile_5y', 'ev_to_ebitda_percentile_5y']),
  c(37, 'Historical analyst estimate / revision data', 'MAPPED', ['analyst_eps_revision_90d_pct', 'analyst_revenue_revision_90d_pct', 'analyst_revision_breadth_90d']),
  c(37, 'Historical IV series', 'MAPPED', ['iv_rank_internal', 'iv_percentile_internal']),
  c(37, 'Revenue / EPS / margin / cash-flow / balance-sheet history', 'MAPPED', ['revenue_cagr_5y_pct', 'eps_cagr_5y_pct', 'operating_margin_trend_5y_pp', 'fcf_trend_5y', 'total_debt']),
  c(37, 'Daily technicals, weekly/monthly RSI, moving averages, relative strength', 'MAPPED', ['rsi_daily_14', 'rsi_weekly_14', 'rsi_monthly_14', 'sma_50', 'sma_200', 'relative_return_126d_vs_benchmark_pct']),
  c(37, 'Current option chains, Greeks, OI, volume, bid-ask, LEAPS expirations, current IV', 'MAPPED', ['contract_delta', 'contract_open_interest', 'contract_volume', 'contract_bid', 'contract_ask', 'contract_dte', 'contract_implied_volatility']),
]);

/** Catalog metrics that no ticket concept points at (an orphan would mean the catalog drifted from the spec). */
export function metricsWithoutSpecConcept(catalogIds: readonly string[]): string[] {
  const referenced = new Set<string>();
  SPEC_CONCEPTS.forEach((concept) => concept.metricIds.forEach((id) => referenced.add(id)));
  return catalogIds.filter((id) => !referenced.has(id)).sort();
}
