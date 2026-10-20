// lib/__tests__/ivUnits.test.ts

import { describe, expect, it } from 'vitest';
import { ivToPercent } from '../ivUnits';
import { readMetricIvPercent } from '../portfolio-data/metricIv';

describe('IV-BLANK-0001: ivToPercent', () => {
  it('fractions below 100% convert to percent', () => {
    expect(ivToPercent('0.6234')).toBeCloseTo(62.34, 5);
  });
  it('IV of 100% or more is not read as 1% (leveraged single-stock ETFs)', () => {
    expect(ivToPercent('1.0')).toBe(100);
    expect(ivToPercent('1.35')).toBeCloseTo(135, 5);
    expect(ivToPercent(2.1)).toBeCloseTo(210, 5);
  });
  it('values already in percent pass through', () => {
    expect(ivToPercent('41.4')).toBe(41.4);
    expect(ivToPercent(135)).toBe(135);
  });
  it('missing, unparseable, zero or negative is null, never zero', () => {
    for (const v of [null, undefined, '', 'n/a', 0, '0', -0.2, NaN]) expect(ivToPercent(v)).toBeNull();
  });
});

describe('IV-BLANK-0001: readMetricIvPercent with IV >= 100%', () => {
  it('reads 1.35 from the index field as 135, so an IV >= 50% filter keeps it', () => {
    expect(readMetricIvPercent({ symbol: 'METU', 'implied-volatility-index': '1.35' })).toBe(135);
  });
  it('exactly 1.0 is 100, not 1', () => {
    expect(readMetricIvPercent({ 'implied-volatility-index': '1.0' })).toBe(100);
  });
  it('a symbol with no IV field stays null (shown as a dash, not 0)', () => {
    expect(readMetricIvPercent({ symbol: 'GGLL' })).toBeNull();
  });
});
