// lib/scans/__tests__/qvUniverseTransport.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest';
import { qvFetchFundamentals, qvFetchMarketMetrics } from '../qvUniverseTransport';

afterEach(() => { vi.unstubAllGlobals(); });
const reply = (status: number, body: unknown) => ({ status, json: async () => body });

describe('LEAPS-QV-0001: Gate 3 input builder transport', () => {
  it('fundamentals 200: metrics, technicals and every source issue (incl. SEC coverage) are returned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, { metrics: { a: 1 }, technicals: { b: 2 }, priceIssue: null, benchmarkIssue: 'BENCHMARK_PRICE_NO_DATA', calendarIssue: null, benchmarkCalendarIssue: null, coverage: 'NOT_COVERED' })));
    expect(await qvFetchFundamentals('ACME')).toEqual({ ok: true, metrics: { a: 1 }, technicals: { b: 2 }, issues: ['BENCHMARK_PRICE_NO_DATA', 'SEC_NOT_COVERED'] });
  });
  it('fundamentals non-200, network error and malformed body are named failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(502, {})));
    expect(await qvFetchFundamentals('ACME')).toEqual({ ok: false, reason: 'FUNDAMENTALS_HTTP_502' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await qvFetchFundamentals('ACME')).toEqual({ ok: false, reason: 'FUNDAMENTALS_NETWORK' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, { metrics: null })));
    expect(await qvFetchFundamentals('ACME')).toEqual({ ok: false, reason: 'FUNDAMENTALS_UNPARSEABLE' });
  });
  it('market metrics go through the same-origin proxy and are keyed by symbol', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { data: { items: [{ symbol: 'ACME', x: 1 }] } }));
    vi.stubGlobal('fetch', f);
    expect(await qvFetchMarketMetrics(['ACME', 'ZZZ'])).toEqual({ ACME: { ok: true, item: { symbol: 'ACME', x: 1 } } });
    expect(f.mock.calls[0][0]).toBe(`/api/tastytrade/proxy?path=${encodeURIComponent('/market-metrics?symbols=ACME,ZZZ')}`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(401, {})));
    expect(await qvFetchMarketMetrics(['ACME'])).toEqual({ ACME: { ok: false, reason: 'MARKET_METRICS_HTTP_401' } });
  });
});
