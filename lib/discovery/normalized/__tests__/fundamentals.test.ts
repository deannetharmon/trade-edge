// lib/discovery/normalized/__tests__/fundamentals.test.ts

import { describe, expect, it } from 'vitest';
import {
  ANALYST_REVISION_DATA_STATUS,
  ANALYST_REVISION_METRIC_IDS,
  FUNDAMENTAL_METRIC_IDS,
  HISTORICAL_VALUATION_METRIC_IDS,
  ROIC_DEFINITION_VERSION,
  analystRevisionMetrics,
  buildFundamentalMetrics,
  historicalValuationMetrics,
} from '..';
import type { FundamentalsInput } from '..';

const NOW = '2026-10-03T14:00:00.000Z';

const good: FundamentalsInput = {
  asOf: '2026-08-05T00:00:00.000Z',
  provider: 'test-fixture',
  price: 100,
  marketCap: 50000,
  ttm: {
    revenue: 10000,
    operatingIncome: 1000,
    pretaxIncome: 900,
    incomeTaxExpense: 180,
    operatingCashFlow: 1500,
    capitalExpenditure: 500,
    ebitda: 1400,
    dilutedEps: 4,
  },
  balanceSheetStart: { totalDebt: 500, totalEquity: 3000, cashAndEquivalents: 500 },
  balanceSheetEnd: { totalDebt: 600, totalEquity: 3400, cashAndEquivalents: 400 },
  annualRevenue: [
    { fiscalYearEnd: '2021-12-31', revenue: 100 },
    { fiscalYearEnd: '2022-12-31', revenue: 110 },
    { fiscalYearEnd: '2023-12-31', revenue: 121 },
    { fiscalYearEnd: '2024-12-31', revenue: 133.1 },
    { fiscalYearEnd: '2025-12-31', revenue: 146.41 },
    { fiscalYearEnd: '2026-12-31', revenue: 161.051 },
  ],
};

function v(set: Record<string, any>, id: string): number {
  expect(set[id].validity, `${id}: ${JSON.stringify(set[id])}`).toBe('VALID');
  return set[id].value;
}
const reasonOf = (set: Record<string, any>, id: string): string => set[id].reason;

describe('buildFundamentalMetrics (definitions fixed ahead of a data provider)', () => {
  it('computes the canonical derivations', () => {
    const set = buildFundamentalMetrics(good, NOW);
    expect(Object.keys(set).sort()).toEqual([...FUNDAMENTAL_METRIC_IDS].sort());
    expect(v(set, 'operating_margin_ttm_pct')).toBeCloseTo(10, 10);
    expect(v(set, 'fcf_ttm')).toBe(1000);
    expect(v(set, 'fcf_margin_ttm_pct')).toBeCloseTo(10, 10);
    expect(v(set, 'fcf_yield_pct')).toBeCloseTo(2, 10);
    expect(v(set, 'net_debt_to_ebitda')).toBeCloseTo(200 / 1400, 10);
    expect(v(set, 'pe_ttm')).toBe(25);
    expect(v(set, 'revenue_cagr_5y_pct')).toBeCloseTo(10, 8);
  });

  it(`${ROIC_DEFINITION_VERSION}: NOPAT / average invested capital`, () => {
    expect(ROIC_DEFINITION_VERSION).toBe('ROIC-v1');
    // rate 0.2, NOPAT 800; capital 3000 -> 3600, average 3300
    expect(v(buildFundamentalMetrics(good, NOW), 'roic_v1_pct')).toBeCloseTo((800 / 3300) * 100, 10);
  });

  it('ROIC-v1 refuses to substitute a statutory tax rate or repair invested capital', () => {
    const t = good.ttm!;
    expect(reasonOf(buildFundamentalMetrics({ ...good, ttm: { ...t, pretaxIncome: -50 } }, NOW), 'roic_v1_pct')).toBe('NON_POSITIVE_PRETAX_INCOME');
    expect(reasonOf(buildFundamentalMetrics({ ...good, ttm: { ...t, incomeTaxExpense: -10 } }, NOW), 'roic_v1_pct')).toBe('EFFECTIVE_TAX_RATE_OUT_OF_RANGE');
    expect(reasonOf(buildFundamentalMetrics({ ...good, ttm: { ...t, incomeTaxExpense: 900 } }, NOW), 'roic_v1_pct')).toBe('EFFECTIVE_TAX_RATE_OUT_OF_RANGE');
    const thin = { totalDebt: 0, totalEquity: 100, cashAndEquivalents: 500 };
    expect(reasonOf(buildFundamentalMetrics({ ...good, balanceSheetStart: thin, balanceSheetEnd: thin }, NOW), 'roic_v1_pct')).toBe('NON_POSITIVE_INVESTED_CAPITAL');
    const set = buildFundamentalMetrics({ ...good, balanceSheetStart: null }, NOW);
    expect(set.roic_v1_pct.validity).toBe('UNAVAILABLE');
  });

  it('is UNAVAILABLE for every metric with no provider', () => {
    [null, undefined].forEach((input) => {
      const set = buildFundamentalMetrics(input, NOW);
      FUNDAMENTAL_METRIC_IDS.forEach((id) => {
        expect(set[id].validity).toBe('UNAVAILABLE');
        expect(reasonOf(set, id)).toBe('NO_FUNDAMENTALS_PROVIDER');
      });
    });
  });

  it('treats absent inputs as UNAVAILABLE, never zero', () => {
    const set = buildFundamentalMetrics({ asOf: good.asOf, provider: 'x', price: 100 }, NOW);
    FUNDAMENTAL_METRIC_IDS.forEach((id) => expect(set[id].validity).toBe('UNAVAILABLE'));
  });

  it('marks negative or zero earnings, EBITDA, revenue and market cap INVALID (Section 12)', () => {
    const t = good.ttm!;
    expect(reasonOf(buildFundamentalMetrics({ ...good, ttm: { ...t, dilutedEps: -1 } }, NOW), 'pe_ttm')).toBe('NON_POSITIVE_EARNINGS');
    expect(reasonOf(buildFundamentalMetrics({ ...good, ttm: { ...t, dilutedEps: 0 } }, NOW), 'pe_ttm')).toBe('NON_POSITIVE_EARNINGS');
    expect(reasonOf(buildFundamentalMetrics({ ...good, ttm: { ...t, ebitda: 0 } }, NOW), 'net_debt_to_ebitda')).toBe('NON_POSITIVE_EBITDA');
    expect(reasonOf(buildFundamentalMetrics({ ...good, ttm: { ...t, revenue: 0 } }, NOW), 'operating_margin_ttm_pct')).toBe('NON_POSITIVE_REVENUE');
    expect(reasonOf(buildFundamentalMetrics({ ...good, marketCap: 0 }, NOW), 'fcf_yield_pct')).toBe('NON_POSITIVE_MARKET_CAP');
  });

  it('keeps negative free cash flow as a real (VALID) value but rejects a mis-signed capex input', () => {
    const t = good.ttm!;
    expect(v(buildFundamentalMetrics({ ...good, ttm: { ...t, operatingCashFlow: 100, capitalExpenditure: 500 } }, NOW), 'fcf_ttm')).toBe(-400);
    const bad = buildFundamentalMetrics({ ...good, ttm: { ...t, capitalExpenditure: -500 } }, NOW);
    expect(reasonOf(bad, 'fcf_ttm')).toBe('CAPEX_MUST_BE_A_POSITIVE_OUTFLOW');
    expect(bad.fcf_margin_ttm_pct.validity).toBe('INVALID');
  });

  it('rejects non-numeric inputs rather than coercing them', () => {
    const t = good.ttm!;
    const set = buildFundamentalMetrics({ ...good, ttm: { ...t, dilutedEps: '4' as any } }, NOW);
    expect(reasonOf(set, 'pe_ttm')).toBe('INPUT_NOT_A_FINITE_NUMBER');
  });

  it('needs six consecutive ascending fiscal years of positive revenue for a 5-year CAGR', () => {
    const rows = good.annualRevenue!;
    expect(reasonOf(buildFundamentalMetrics({ ...good, annualRevenue: rows.slice(2) }, NOW), 'revenue_cagr_5y_pct')).toBe('INSUFFICIENT_HISTORY');
    expect(buildFundamentalMetrics({ ...good, annualRevenue: [] }, NOW).revenue_cagr_5y_pct.validity).toBe('UNAVAILABLE');
    expect(reasonOf(buildFundamentalMetrics({ ...good, annualRevenue: [...rows].reverse() }, NOW), 'revenue_cagr_5y_pct')).toBe('FISCAL_YEARS_NOT_ASCENDING');
    const hole = rows.map((r, i) => (i === 2 ? { ...r, revenue: null } : r));
    expect(buildFundamentalMetrics({ ...good, annualRevenue: hole }, NOW).revenue_cagr_5y_pct.validity).toBe('UNAVAILABLE');
    const neg = rows.map((r, i) => (i === 0 ? { ...r, revenue: -5 } : r));
    expect(reasonOf(buildFundamentalMetrics({ ...good, annualRevenue: neg }, NOW), 'revenue_cagr_5y_pct')).toBe('NON_POSITIVE_REVENUE');
  });

  it('applies STALE / INVALID freshness to old, future or untimed statements', () => {
    const stale = buildFundamentalMetrics({ ...good, asOf: '2026-02-01T00:00:00.000Z' }, NOW);
    expect(stale.pe_ttm.validity).toBe('STALE');
    expect('value' in stale.pe_ttm).toBe(false);
    expect(buildFundamentalMetrics({ ...good, asOf: '2026-12-01T00:00:00.000Z' }, NOW).pe_ttm.validity).toBe('INVALID');
    expect(buildFundamentalMetrics({ ...good, asOf: null }, NOW).pe_ttm.validity).toBe('INVALID');
  });
});

describe('metrics with no data source', () => {
  it('reports analyst revisions as UNAVAILABLE, never neutral (Section 15)', () => {
    expect(ANALYST_REVISION_DATA_STATUS).toBe('UNAVAILABLE');
    const set = analystRevisionMetrics();
    expect(Object.keys(set).sort()).toEqual([...ANALYST_REVISION_METRIC_IDS].sort());
    Object.values(set).forEach((m) => {
      expect(m.validity).toBe('UNAVAILABLE');
      expect((m as any).reason).toBe('ANALYST_REVISION_DATA_UNAVAILABLE');
    });
  });

  it('reports historical valuation distributions as UNAVAILABLE (Section 12)', () => {
    const set = historicalValuationMetrics();
    expect(Object.keys(set).sort()).toEqual([...HISTORICAL_VALUATION_METRIC_IDS].sort());
    Object.values(set).forEach((m) => expect(m.validity).toBe('UNAVAILABLE'));
  });
});
