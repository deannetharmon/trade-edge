// lib/discovery/normalized/fundamentals.ts

// LEAPS-QV-0001 Gate 2 (Sections 10-15) -- fundamental / valuation METRIC derivations and canonical definitions.
//
// DATA STATUS (see the Gate 2 audit): TradeEdge has NO company-fundamentals provider today. Nothing in the
// application feeds these functions, so every fundamental metric is UNAVAILABLE in production until a provider is
// approved. The derivations exist so the definitions are fixed and tested BEFORE data arrives (Section 37:
// "canonical ROIC" needs validating), and they fail closed: a derived metric is VALID only when every input is.
// No proxy is ever substituted (e.g. price CAGR from /api/historical-growth is NOT revenue growth).
//
// ROIC-v1 (canonical, versioned -- a change to any term is ROIC-v2, never an edit):
//   ROIC = NOPAT_ttm / average(InvestedCapital_start, InvestedCapital_end)
//   NOPAT_ttm       = operatingIncome_ttm x (1 - effectiveTaxRate)
//   effectiveTaxRate = incomeTaxExpense_ttm / pretaxIncome_ttm; INVALID unless pretaxIncome > 0 and 0 <= rate < 1
//                     (no statutory-rate substitute)
//   InvestedCapital = totalDebt + totalEquity - cashAndEquivalents (as reported; short-term investments are NOT netted)
//   start / end     = balance sheets four quarters apart; INVALID when the average is <= 0
// Outputs are percent (12.5 = 12.5%).

import { invalidMetric, unavailableMetric, validMetric } from '../metrics';
import type { MetricSet, NormalizedMetric } from '../metrics';
import { isIsoTimestamp } from '../util';

export const ROIC_DEFINITION_VERSION = 'ROIC-v1';

export interface BalanceSheetPoint {
  readonly totalDebt?: number | null;
  readonly totalEquity?: number | null;
  readonly cashAndEquivalents?: number | null;
}

export interface AnnualRevenuePoint {
  readonly fiscalYearEnd: string;
  readonly revenue?: number | null;
}

/** Trailing-twelve-month statement figures plus balance sheets, all in one currency. Every field is optional. */
export interface FundamentalsInput {
  /** When the statements were filed / last updated (ISO-8601). */
  readonly asOf: string | null;
  readonly provider: string;
  readonly price?: number | null;
  readonly marketCap?: number | null;
  readonly ttm?: {
    readonly revenue?: number | null;
    readonly operatingIncome?: number | null;
    readonly pretaxIncome?: number | null;
    readonly incomeTaxExpense?: number | null;
    readonly operatingCashFlow?: number | null;
    readonly capitalExpenditure?: number | null;
    readonly ebitda?: number | null;
    readonly dilutedEps?: number | null;
  };
  readonly balanceSheetStart?: BalanceSheetPoint | null;
  readonly balanceSheetEnd?: BalanceSheetPoint | null;
  /** Oldest first; six consecutive fiscal years give a 5-year CAGR. */
  readonly annualRevenue?: readonly AnnualRevenuePoint[] | null;
}

/** A fundamentals statement is quarterly; 135 days covers a filing cycle plus slack (data rule). */
export const FUNDAMENTALS_MAX_AGE_MS = 135 * 24 * 60 * 60 * 1000;

export const FUNDAMENTAL_METRIC_IDS: readonly string[] = [
  'operating_margin_ttm_pct',
  'fcf_ttm',
  'fcf_margin_ttm_pct',
  'fcf_yield_pct',
  'roic_v1_pct',
  'net_debt_to_ebitda',
  'pe_ttm',
  'revenue_cagr_5y_pct',
];

export const ANALYST_REVISION_METRIC_IDS: readonly string[] = [
  'analyst_eps_revision_90d_pct',
  'analyst_revenue_revision_90d_pct',
  'analyst_revision_breadth_90d',
];

/**
 * Historical EV/EBITDA needs per-period share counts, debt and cash that are not split-safe in SEC data; the SEC
 * adapter (Gate 2b) supports P/E history only, so these stay UNAVAILABLE.
 */
export const HISTORICAL_VALUATION_METRIC_IDS: readonly string[] = [
  'ev_to_ebitda_median_5y',
  'ev_to_ebitda_percentile_5y',
  'ev_to_ebitda_discount_to_median_5y_pct',
];

/** Section 15: reported explicitly as "Analyst Revision Data: UNAVAILABLE". Never neutral / stable / positive. */
export const ANALYST_REVISION_DATA_STATUS = 'UNAVAILABLE';

export function analystRevisionMetrics(): MetricSet {
  const out: Record<string, NormalizedMetric> = {};
  ANALYST_REVISION_METRIC_IDS.forEach((id) => {
    out[id] = unavailableMetric(id, 'ANALYST_REVISION_DATA_UNAVAILABLE');
  });
  return out;
}

/** Section 12 (EV/EBITDA history): not supported by the SEC adapter, so UNAVAILABLE. P/E history lives in the SEC layer. */
export function historicalValuationMetrics(): MetricSet {
  const out: Record<string, NormalizedMetric> = {};
  HISTORICAL_VALUATION_METRIC_IDS.forEach((id) => {
    out[id] = unavailableMetric(id, 'HISTORICAL_EV_INPUTS_NOT_SUPPORTED');
  });
  return out;
}

type Maybe = number | null | undefined;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Section 8 freshness semantics for a derived fundamental figure: `value` null -> UNAVAILABLE(`missing`); a non-empty
 * `invalid` reason -> INVALID; an untimed / future statement -> INVALID; older than FUNDAMENTALS_MAX_AGE_MS -> STALE.
 */
export function createFundamentalResult(
  provider: string,
  asOf: string | null,
  now: string,
): (id: string, value: number | null, missing: string, invalid?: string) => NormalizedMetric {
  const provenance = { provider };
  const nowMs = Date.parse(now);
  const asOfMs = asOf !== null && isIsoTimestamp(asOf) ? Date.parse(asOf) : NaN;
  return (id, value, missing, invalid) => {
    if (invalid) return invalidMetric(id, value ?? 'n/a', invalid, provenance);
    if (value === null) return unavailableMetric(id, missing, provenance);
    if (!Number.isFinite(asOfMs) || !Number.isFinite(nowMs)) return invalidMetric(id, String(asOf), 'FUNDAMENTALS_AS_OF_INVALID', provenance);
    if (asOfMs > nowMs) return invalidMetric(id, String(asOf), 'FUNDAMENTALS_AS_OF_IN_THE_FUTURE', provenance);
    const age = nowMs - asOfMs;
    if (age > FUNDAMENTALS_MAX_AGE_MS) {
      return Object.freeze({ id, validity: 'STALE' as const, staleValue: value, asOf: asOf as string, ageMs: age, maxAgeMs: FUNDAMENTALS_MAX_AGE_MS, provenance });
    }
    return validMetric(id, value, asOf as string, provenance);
  };
}

export function buildFundamentalMetrics(input: FundamentalsInput | null | undefined, now: string): MetricSet {
  const out: Record<string, NormalizedMetric> = {};
  if (!input) {
    FUNDAMENTAL_METRIC_IDS.forEach((id) => {
      out[id] = unavailableMetric(id, 'NO_FUNDAMENTALS_PROVIDER');
    });
    return out;
  }
  const asOf = input.asOf;
  const result = createFundamentalResult(input.provider, asOf, now);
  const bad = (...values: Maybe[]): string | null => {
    for (const v of values) if (v !== null && v !== undefined && !isNum(v)) return 'INPUT_NOT_A_FINITE_NUMBER';
    return null;
  };
  const present = (...values: Maybe[]): boolean => values.every(isNum);

  const t = input.ttm ?? {};
  const bsS = input.balanceSheetStart ?? null;
  const bsE = input.balanceSheetEnd ?? null;

  // Operating margin
  {
    const invalid = bad(t.operatingIncome, t.revenue);
    if (invalid) out.operating_margin_ttm_pct = result('operating_margin_ttm_pct', null, '', invalid);
    else if (!present(t.operatingIncome, t.revenue)) out.operating_margin_ttm_pct = result('operating_margin_ttm_pct', null, 'INPUT_MISSING');
    else if ((t.revenue as number) <= 0) out.operating_margin_ttm_pct = result('operating_margin_ttm_pct', null, '', 'NON_POSITIVE_REVENUE');
    else out.operating_margin_ttm_pct = result('operating_margin_ttm_pct', ((t.operatingIncome as number) / (t.revenue as number)) * 100, '');
  }

  // Free cash flow (capex supplied as a positive outflow)
  const fcfInvalid = bad(t.operatingCashFlow, t.capitalExpenditure) ?? (isNum(t.capitalExpenditure) && t.capitalExpenditure < 0 ? 'CAPEX_MUST_BE_A_POSITIVE_OUTFLOW' : null);
  const fcf = present(t.operatingCashFlow, t.capitalExpenditure) && !fcfInvalid ? (t.operatingCashFlow as number) - (t.capitalExpenditure as number) : null;
  out.fcf_ttm = fcfInvalid ? result('fcf_ttm', null, '', fcfInvalid) : result('fcf_ttm', fcf, 'INPUT_MISSING');
  {
    const invalid = fcfInvalid ?? bad(t.revenue);
    if (invalid) out.fcf_margin_ttm_pct = result('fcf_margin_ttm_pct', null, '', invalid);
    else if (fcf === null || !isNum(t.revenue)) out.fcf_margin_ttm_pct = result('fcf_margin_ttm_pct', null, 'INPUT_MISSING');
    else if (t.revenue <= 0) out.fcf_margin_ttm_pct = result('fcf_margin_ttm_pct', null, '', 'NON_POSITIVE_REVENUE');
    else out.fcf_margin_ttm_pct = result('fcf_margin_ttm_pct', (fcf / t.revenue) * 100, '');
  }
  {
    const invalid = fcfInvalid ?? bad(input.marketCap);
    if (invalid) out.fcf_yield_pct = result('fcf_yield_pct', null, '', invalid);
    else if (fcf === null || !isNum(input.marketCap)) out.fcf_yield_pct = result('fcf_yield_pct', null, 'INPUT_MISSING');
    else if (input.marketCap <= 0) out.fcf_yield_pct = result('fcf_yield_pct', null, '', 'NON_POSITIVE_MARKET_CAP');
    else out.fcf_yield_pct = result('fcf_yield_pct', (fcf / input.marketCap) * 100, '');
  }

  // ROIC-v1
  {
    const invalidInput = bad(t.operatingIncome, t.pretaxIncome, t.incomeTaxExpense, bsS?.totalDebt, bsS?.totalEquity, bsS?.cashAndEquivalents, bsE?.totalDebt, bsE?.totalEquity, bsE?.cashAndEquivalents);
    const complete = present(t.operatingIncome, t.pretaxIncome, t.incomeTaxExpense, bsS?.totalDebt, bsS?.totalEquity, bsS?.cashAndEquivalents, bsE?.totalDebt, bsE?.totalEquity, bsE?.cashAndEquivalents);
    if (invalidInput) out.roic_v1_pct = result('roic_v1_pct', null, '', invalidInput);
    else if (!complete) out.roic_v1_pct = result('roic_v1_pct', null, 'INPUT_MISSING');
    else {
      const rate = (t.incomeTaxExpense as number) / (t.pretaxIncome as number);
      const capStart = (bsS!.totalDebt as number) + (bsS!.totalEquity as number) - (bsS!.cashAndEquivalents as number);
      const capEnd = (bsE!.totalDebt as number) + (bsE!.totalEquity as number) - (bsE!.cashAndEquivalents as number);
      const avg = (capStart + capEnd) / 2;
      if ((t.pretaxIncome as number) <= 0) out.roic_v1_pct = result('roic_v1_pct', null, '', 'NON_POSITIVE_PRETAX_INCOME');
      else if (!(rate >= 0 && rate < 1)) out.roic_v1_pct = result('roic_v1_pct', null, '', 'EFFECTIVE_TAX_RATE_OUT_OF_RANGE');
      else if (avg <= 0) out.roic_v1_pct = result('roic_v1_pct', null, '', 'NON_POSITIVE_INVESTED_CAPITAL');
      else out.roic_v1_pct = result('roic_v1_pct', (((t.operatingIncome as number) * (1 - rate)) / avg) * 100, '');
    }
  }

  // Net debt / EBITDA
  {
    const invalid = bad(t.ebitda, bsE?.totalDebt, bsE?.cashAndEquivalents);
    if (invalid) out.net_debt_to_ebitda = result('net_debt_to_ebitda', null, '', invalid);
    else if (!present(t.ebitda, bsE?.totalDebt, bsE?.cashAndEquivalents)) out.net_debt_to_ebitda = result('net_debt_to_ebitda', null, 'INPUT_MISSING');
    else if ((t.ebitda as number) <= 0) out.net_debt_to_ebitda = result('net_debt_to_ebitda', null, '', 'NON_POSITIVE_EBITDA');
    else out.net_debt_to_ebitda = result('net_debt_to_ebitda', ((bsE!.totalDebt as number) - (bsE!.cashAndEquivalents as number)) / (t.ebitda as number), '');
  }

  // Trailing P/E (negative / zero earnings are INVALID, never a large or negative multiple)
  {
    const invalid = bad(input.price, t.dilutedEps);
    if (invalid) out.pe_ttm = result('pe_ttm', null, '', invalid);
    else if (!present(input.price, t.dilutedEps)) out.pe_ttm = result('pe_ttm', null, 'INPUT_MISSING');
    else if ((input.price as number) <= 0) out.pe_ttm = result('pe_ttm', null, '', 'NON_POSITIVE_PRICE');
    else if ((t.dilutedEps as number) <= 0) out.pe_ttm = result('pe_ttm', null, '', 'NON_POSITIVE_EARNINGS');
    else out.pe_ttm = result('pe_ttm', (input.price as number) / (t.dilutedEps as number), '');
  }

  // 5-year revenue CAGR from six consecutive fiscal years
  {
    const rows = input.annualRevenue ?? null;
    if (!rows || rows.length === 0) out.revenue_cagr_5y_pct = result('revenue_cagr_5y_pct', null, 'INPUT_MISSING');
    else if (rows.length < 6) out.revenue_cagr_5y_pct = result('revenue_cagr_5y_pct', null, 'INSUFFICIENT_HISTORY');
    else {
      const window = rows.slice(rows.length - 6);
      const first = window[0].revenue;
      const last = window[5].revenue;
      const ordered = window.every((row, i) => i === 0 || row.fiscalYearEnd > window[i - 1].fiscalYearEnd);
      if (!ordered) out.revenue_cagr_5y_pct = result('revenue_cagr_5y_pct', null, '', 'FISCAL_YEARS_NOT_ASCENDING');
      else if (window.some((row) => row.revenue !== null && row.revenue !== undefined && !isNum(row.revenue))) {
        out.revenue_cagr_5y_pct = result('revenue_cagr_5y_pct', null, '', 'INPUT_NOT_A_FINITE_NUMBER');
      } else if (window.some((row) => !isNum(row.revenue))) out.revenue_cagr_5y_pct = result('revenue_cagr_5y_pct', null, 'INPUT_MISSING');
      else if ((first as number) <= 0 || (last as number) <= 0) out.revenue_cagr_5y_pct = result('revenue_cagr_5y_pct', null, '', 'NON_POSITIVE_REVENUE');
      else out.revenue_cagr_5y_pct = result('revenue_cagr_5y_pct', (Math.pow((last as number) / (first as number), 1 / 5) - 1) * 100, '');
    }
  }
  return out;
}
