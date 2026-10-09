import { describe, expect, it } from 'vitest';
import { readMetricIvPercent } from '../metricIv';

describe('IV-FIELD-0001: readMetricIvPercent', () => {
  it('reads the documented implied-volatility-index fraction as a percent', () => {
    expect(readMetricIvPercent({ symbol: 'METU', 'implied-volatility-index': '0.6234' })).toBe(62);
  });
  it('legacy fields still win when present, so existing symbols do not change', () => {
    expect(readMetricIvPercent({ 'implied-volatility': '0.41', 'implied-volatility-index': '0.99' })).toBe(41);
  });
  it('falls through an unparseable field to the next one', () => {
    expect(readMetricIvPercent({ 'implied-volatility': 'n/a', 'implied-volatility-index': '0.5' })).toBe(50);
  });
  it('whole-number percent passes through; missing is null, never zero', () => {
    expect(readMetricIvPercent({ iv: '41.4' })).toBe(41);
    expect(readMetricIvPercent({ symbol: 'GGLL' })).toBeNull();
    expect(readMetricIvPercent(null)).toBeNull();
  });
});
