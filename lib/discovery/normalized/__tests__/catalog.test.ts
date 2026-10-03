// lib/discovery/normalized/__tests__/catalog.test.ts

import { describe, expect, it } from 'vitest';
import {
  ANALYST_REVISION_METRIC_IDS,
  CONTRACT_METRIC_IDS,
  FUNDAMENTAL_METRIC_IDS,
  HISTORICAL_VALUATION_METRIC_IDS,
  IMPLEMENTED_METRIC_IDS,
  METRIC_CATALOG,
  SPEC_CONCEPTS,
  catalogOnlyMetrics,
  metricsWithoutSpecConcept,
  TECHNICAL_METRIC_IDS,
  VOLATILITY_EVENT_METRIC_IDS,
  buildContractMetrics,
  buildFundamentalMetrics,
  buildMarketMetrics,
  buildTechnicalMetrics,
  catalogEntry,
  investmentSignificantGaps,
} from '..';
import { evaluateCriterion, getMetric, summarizeDataCompleteness } from '../../metrics';

const NOW = '2026-10-03T14:00:00.000Z';
const adapterIds = [
  ...TECHNICAL_METRIC_IDS,
  ...CONTRACT_METRIC_IDS,
  ...VOLATILITY_EVENT_METRIC_IDS,
  ...FUNDAMENTAL_METRIC_IDS,
  ...ANALYST_REVISION_METRIC_IDS,
  ...HISTORICAL_VALUATION_METRIC_IDS,
];

describe('metric catalog', () => {
  it('has unique, well-formed ids and a classification for every entry', () => {
    const ids = METRIC_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    METRIC_CATALOG.forEach((e) => {
      expect(e.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(['AVAILABLE', 'DERIVABLE', 'CONDITIONAL', 'UNAVAILABLE']).toContain(e.classification);
      expect(e.source.length).toBeGreaterThan(0);
      expect(e.note.length).toBeGreaterThan(0);
    });
  });

  it('contains every metric the adapters can emit, and flags implemented vs catalog-only correctly', () => {
    const implemented = new Set(adapterIds);
    const catalogIds = new Set(METRIC_CATALOG.map((e) => e.id));
    adapterIds.forEach((id) => expect(catalogIds.has(id), id).toBe(true));
    METRIC_CATALOG.forEach((e) => expect(e.implemented, e.id).toBe(implemented.has(e.id)));
    expect([...IMPLEMENTED_METRIC_IDS]).toEqual([...adapterIds].sort());
  });

  it('catalog-only metrics are UNAVAILABLE (or CONDITIONAL with a named source), never AVAILABLE/DERIVABLE', () => {
    METRIC_CATALOG.filter((e) => !e.implemented).forEach((e) => {
      expect(['UNAVAILABLE', 'CONDITIONAL'], e.id).toContain(e.classification);
    });
  });

  it('catalogOnlyMetrics reports exactly the unimplemented ids as UNAVAILABLE', () => {
    const set = catalogOnlyMetrics();
    const expected = METRIC_CATALOG.filter((e) => !e.implemented).map((e) => e.id).sort();
    expect(Object.keys(set).sort()).toEqual(expected);
    Object.values(set).forEach((m) => {
      expect(m.validity).toBe('UNAVAILABLE');
      expect((m as any).reason).toBe('NO_DATA_SOURCE');
    });
  });

  it('every key an adapter returns is in the catalog', () => {
    const emitted = new Set<string>();
    [
      buildTechnicalMetrics(null, { now: NOW, provider: 'y' }),
      buildContractMetrics(null, 1, { now: NOW, quoteAsOf: NOW, provider: 'tt' }),
      buildContractMetrics({ optionType: 'P' }, 1, { now: NOW, quoteAsOf: NOW, provider: 'tt' }),
      buildMarketMetrics(null, { now: NOW, payloadAsOf: NOW }),
      buildMarketMetrics({ earnings: {} }, { now: NOW, payloadAsOf: NOW }),
      buildFundamentalMetrics(null, NOW),
    ].forEach((set) => Object.keys(set).forEach((id) => emitted.add(id)));
    emitted.forEach((id) => expect(catalogEntry(id), id).toBeDefined());
  });

  it('classifies the Section 37 constraints honestly', () => {
    ['analyst_eps_revision_90d_pct', 'analyst_revenue_revision_90d_pct', 'analyst_revision_breadth_90d', 'iv_rank_internal', 'iv_percentile_internal', 'roic_v1_pct', 'pe_ttm_percentile_5y'].forEach((id) => {
      expect(catalogEntry(id)!.classification).toBe('UNAVAILABLE');
      expect(catalogEntry(id)!.investmentSignificant).toBe(true);
    });
    expect(catalogEntry('iv_rank_provider')!.classification).toBe('CONDITIONAL');
    TECHNICAL_METRIC_IDS.forEach((id) => expect(catalogEntry(id)!.classification).toBe('DERIVABLE'));
  });

  it('lists the investment-significant gaps that must go to Ian', () => {
    const gaps = investmentSignificantGaps().map((e) => e.id);
    expect(gaps).toContain('iv_rank_provider');
    expect(gaps).toContain('revenue_cagr_5y_pct');
    expect(gaps).toContain('analyst_revision_breadth_90d');
    expect(gaps).not.toContain('sma_200');
  });
});

describe('normalized metrics plug into the Gate 1 contract', () => {
  it('an UNAVAILABLE fundamental is NOT_EVALUABLE, not a failure, and lowers data completeness', () => {
    const set = { ...buildFundamentalMetrics(null, NOW), ...buildTechnicalMetrics(null, { now: NOW, provider: 'y' }) };
    const outcome = evaluateCriterion('roic_floor', [getMetric(set, 'roic_v1_pct')], () => true);
    expect(outcome.result).toBe('NOT_EVALUABLE');
    expect(outcome.blockingMetrics).toEqual([{ id: 'roic_v1_pct', validity: 'UNAVAILABLE' }]);
    const completeness = summarizeDataCompleteness(set, ['roic_v1_pct', 'rsi_weekly_14'], ['roic_v1_pct']);
    expect(completeness.validCount).toBe(0);
    expect(completeness.criticalMissing).toEqual(['roic_v1_pct']);
    expect(completeness.complete).toBe(false);
  });
});

describe('ticket reconciliation (Quinn G2-B1)', () => {
  const catalogIds = METRIC_CATALOG.map((e) => e.id);
  const conceptNames = SPEC_CONCEPTS.map((c) => `${c.section}:${c.concept}`);

  it('maps every concept only to metrics that exist in the catalog', () => {
    SPEC_CONCEPTS.forEach((c) => c.metricIds.forEach((id) => expect(catalogIds, `${c.concept} -> ${id}`).toContain(id)));
  });

  it('has no orphan catalog metric: every metric answers a ticket concept', () => {
    expect(metricsWithoutSpecConcept(catalogIds)).toEqual([]);
  });

  it('gives every concept a metric, or a stated reason why not', () => {
    SPEC_CONCEPTS.forEach((c) => {
      if (c.disposition === 'MAPPED') expect(c.metricIds.length, c.concept).toBeGreaterThan(0);
      else expect(c.note.length, c.concept).toBeGreaterThan(0);
    });
    expect(new Set(conceptNames).size).toBe(conceptNames.length);
  });

  it('covers every ticket section that defines data inputs', () => {
    [10, 11, 12, 13, 14, 15, 16, 18, 25, 26, 37].forEach((section) => {
      expect(SPEC_CONCEPTS.some((c) => c.section === section), `Section ${section}`).toBe(true);
    });
  });

  it('accounts for each concept Quinn named as missing', () => {
    const mustMap: Record<string, string[]> = {
      'revenue consistency': ['revenue_growth_consistency_5y'],
      'EPS growth': ['eps_cagr_5y_pct', 'eps_growth_yoy_ttm_pct'],
      'EPS consistency': ['eps_growth_consistency_5y'],
      'operating-margin trend': ['operating_margin_trend_5y_pp'],
      'FCF trend/stability': ['fcf_trend_5y', 'fcf_stability_5y'],
      'EPS trajectory': ['eps_growth_yoy_ttm_pct'],
      'balance-sheet strength': ['total_debt', 'net_debt', 'current_ratio', 'interest_coverage'],
      'forward P/E': ['pe_forward'],
      'current EV/EBITDA': ['ev_to_ebitda_ttm'],
      'Price/FCF': ['price_to_fcf'],
      PEG: ['peg_ratio'],
      'historical valuation discount/premium': ['pe_ttm_discount_to_median_3y_pct', 'pe_ttm_discount_to_median_5y_pct', 'ev_to_ebitda_discount_to_median_5y_pct'],
      'forward growth expectations': ['eps_growth_forward_pct', 'consensus_eps_next_year'],
      'company guidance': ['company_guidance'],
      'earnings/margin/FCF stability': ['earnings_stability_5y', 'operating_margin_stability_5y', 'fcf_stability_5y'],
    };
    const mapped = new Set<string>();
    SPEC_CONCEPTS.forEach((c) => c.metricIds.forEach((id) => mapped.add(id)));
    Object.entries(mustMap).forEach(([name, ids]) => ids.forEach((id) => {
      expect(catalogIds, `${name}: ${id}`).toContain(id);
      expect(mapped.has(id), `${name}: ${id} unreferenced`).toBe(true);
    }));
  });

  it('records what an SEC adapter could make of each fundamentals metric, and that estimates stay UNAVAILABLE', () => {
    ['pe_forward', 'eps_growth_forward_pct', 'consensus_eps_current_year', 'consensus_eps_next_year', 'consensus_revenue_current_year', 'consensus_revenue_next_year', 'company_guidance', 'analyst_eps_revision_90d_pct', 'analyst_revenue_revision_90d_pct', 'analyst_revision_breadth_90d'].forEach((id) => {
      expect(catalogEntry(id)!.expectedWithSecAdapter, id).toBe('UNAVAILABLE');
    });
    METRIC_CATALOG.filter((e) => e.category === 'QUALITY').forEach((e) => expect(e.expectedWithSecAdapter, e.id).not.toBeNull());
    expect(catalogEntry('rsi_weekly_14')!.expectedWithSecAdapter).toBeNull();
  });
});
