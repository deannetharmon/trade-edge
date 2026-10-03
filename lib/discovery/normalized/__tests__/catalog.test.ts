// lib/discovery/normalized/__tests__/catalog.test.ts

import { describe, expect, it } from 'vitest';
import {
  ANALYST_REVISION_METRIC_IDS,
  CONTRACT_METRIC_IDS,
  FUNDAMENTAL_METRIC_IDS,
  HISTORICAL_VALUATION_METRIC_IDS,
  METRIC_CATALOG,
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

  it('covers exactly the metrics the adapters can emit (no orphan, no unmapped metric)', () => {
    expect(METRIC_CATALOG.map((e) => e.id).sort()).toEqual([...adapterIds].sort());
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
