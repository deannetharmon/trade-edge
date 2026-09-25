// features/portfolio/positions-workspace/__tests__/stockEarnings.test.ts

import { describe, expect, it } from 'vitest';
import { marketMetricsPath, parseMarketMetricsEarnings } from '../model/stockEarnings';

describe('parseMarketMetricsEarnings', () => {
  it('reads the expected report date and the estimated flag per symbol', () => {
    const payload = { data: { items: [
      { symbol: 'META', earnings: { 'expected-report-date': '2026-10-29', estimated: true } },
      { symbol: 'sndk', earnings: { 'expected-report-date': '2026-11-06' } },
    ] } };
    expect(parseMarketMetricsEarnings(payload)).toEqual({ META: { date: '2026-10-29', estimated: true }, SNDK: { date: '2026-11-06', estimated: null } });
  });
  it('ignores symbols with no date, malformed dates, and malformed payloads', () => {
    expect(parseMarketMetricsEarnings({ data: { items: [{ symbol: 'SPY' }, { symbol: 'X', earnings: null }, { symbol: 'Y', earnings: { 'expected-report-date': 'soon' } }, { earnings: { 'expected-report-date': '2026-10-29' } }] } })).toEqual({});
    for (const bad of [null, undefined, {}, { data: {} }, { data: { items: 'no' } }, 7]) expect(parseMarketMetricsEarnings(bad)).toEqual({});
  });
  it('builds the proxy path with the symbols encoded once', () => {
    expect(marketMetricsPath(['META', 'SNDK'])).toBe('/api/tastytrade/proxy?path=%2Fmarket-metrics%3Fsymbols%3DMETA%2CSNDK');
  });
});
