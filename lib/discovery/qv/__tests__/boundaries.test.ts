// lib/discovery/qv/__tests__/boundaries.test.ts

// LEAPS-QV-0001 Gate 3 (Section 45.13) -- every boundary immediately below, exactly at, and immediately above.

import { describe, expect, it } from 'vitest';
import { assessQuality, assessValuation, discountClassOf, leverageBandOf, percentileClassOf, revenueBandOf, roicBandOf } from '..';
import { inputWith, metricsWith } from './qvFixtures';

describe('Section 45.13 boundaries', () => {
  it('P/E percentile 20 and 35 (lower is cheaper)', () => {
    expect([19.99, 20, 20.01].map(percentileClassOf)).toEqual(['STRONG', 'STRONG', 'MODERATE']);
    expect([34.99, 35, 35.01].map(percentileClassOf)).toEqual(['MODERATE', 'MODERATE', 'NONE']);
  });

  it('historical discount 10% and 20%', () => {
    expect([9.99, 10, 10.01].map(discountClassOf)).toEqual(['NONE', 'MODERATE', 'MODERATE']);
    expect([19.99, 20, 20.01].map(discountClassOf)).toEqual(['MODERATE', 'STRONG', 'STRONG']);
  });

  it('Net Debt/EBITDA 1x, 2x, 3x', () => {
    expect([0.99, 1, 1.01].map(leverageBandOf)).toEqual(['STRONG', 'STRONG', 'ACCEPTABLE']);
    expect([1.99, 2, 2.01].map(leverageBandOf)).toEqual(['ACCEPTABLE', 'ACCEPTABLE', 'ELEVATED']);
    expect([2.99, 3, 3.01].map(leverageBandOf)).toEqual(['ELEVATED', 'ELEVATED', 'HIGH']);
  });

  it('ROIC 10% and 15%', () => {
    expect([9.99, 10, 10.01].map(roicBandOf)).toEqual(['WEAK', 'ACCEPTABLE', 'ACCEPTABLE']);
    expect([14.99, 15, 15.01].map(roicBandOf)).toEqual(['ACCEPTABLE', 'STRONG', 'STRONG']);
  });

  it('revenue CAGR 0% and 5%', () => {
    expect([-0.01, 0, 0.01].map(revenueBandOf)).toEqual(['WEAK', 'ACCEPTABLE', 'ACCEPTABLE']);
    expect([4.99, 5, 5.01].map(revenueBandOf)).toEqual(['ACCEPTABLE', 'STRONG', 'STRONG']);
  });

  it('the boundaries drive the real assessments, not only the helper functions', () => {
    const valuationAt = (percentile: number, discount: number) => assessValuation(metricsWith({ percentile5y: percentile, discount5y: discount })).result;
    expect(valuationAt(20, 0)).toBe('STRONG');
    expect(valuationAt(20.01, 0)).toBe('MODERATE');
    expect(valuationAt(35.01, 9.99)).toBe('NONE');
    expect(valuationAt(99, 10)).toBe('MODERATE');
    expect(valuationAt(99, 20)).toBe('STRONG');
    const quality = (overrides: Parameters<typeof metricsWith>[0]) => assessQuality(metricsWith(overrides));
    expect(quality({ roic: 10 }).roicBand).toBe('ACCEPTABLE');
    expect(quality({ roic: 9.99 }).roicBand).toBe('WEAK');
    expect(quality({ leverage: 3 }).leverageBand).toBe('ELEVATED');
    expect(quality({ leverage: 3.01 }).leverageBand).toBe('HIGH');
    expect(quality({ revenueCagr: 0 }).revenueBand).toBe('ACCEPTABLE');
    expect(quality({ margin: 0 }).result).toBe('FAIL'); // operating margin must be strictly positive
    expect(quality({ margin: 0.01 }).result).toBe('PASS');
  });

  it('conflicting valuation signals: percentile 18 with a 5% discount is STRONG (independent criteria)', () => {
    const valuation = assessValuation(metricsWith({ percentile5y: 18, discount5y: 5 }));
    expect(valuation.result).toBe('STRONG');
    expect(valuation.percentileClass).toBe('STRONG');
    expect(valuation.discountClass).toBe('NONE');
    expect(valuation.conflict).toBe(true);
    expect(valuation.reasons.map((r) => r.code)).toContain('VALUATION_CONFLICT');
  });

  it('a missing criterion plus an unremarkable one is not "no dislocation" -- it is NOT_EVALUABLE', () => {
    expect(assessValuation(metricsWith({ percentile5y: 50, discount5y: null })).result).toBe('NOT_EVALUABLE');
    expect(assessValuation(metricsWith({ percentile5y: 18, discount5y: null })).result).toBe('STRONG');
  });

  it('falls back to the 3Y window at reduced confidence with the same thresholds', () => {
    const valuation = assessValuation(metricsWith({ percentile5y: null, percentile3y: 20, discount5y: 5 }));
    expect(valuation.result).toBe('STRONG');
    expect(valuation.confidence).toBe('REDUCED');
    expect(valuation.reasons.map((r) => r.code)).toContain('VALUATION_WINDOW_3Y_FALLBACK');
    expect(inputWith().symbol).toBe('ABC');
  });
});
