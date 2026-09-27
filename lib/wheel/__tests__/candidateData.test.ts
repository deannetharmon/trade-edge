// lib/wheel/__tests__/candidateData.test.ts
//
// WHEEL-SYSTEM-0002 (W2) -- the metrics and closes adapters: batching, per-batch failure, matching by symbol, bad payloads.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/scans/tastytrade-client', () => ({ getMarketMetrics: vi.fn() }));

import { METRICS_BATCH_SIZE, fetchDailyCloses, fetchMetricsBatch } from '../candidateData';

describe('fetchMetricsBatch', () => {
  it('maps items by upper-cased symbol and keeps the IVR percent and the earnings date', async () => {
    const fetcher = vi.fn(async () => [
      { symbol: 'xlf', ivRank: 31.4, earningsExpectedDate: null },
      { symbol: 'NVDA ', ivRank: 44, earningsExpectedDate: '2026-10-28' },
    ]);
    const r = await fetchMetricsBatch(['XLF', 'NVDA'], 'token', fetcher);
    expect(r.items).toEqual({ XLF: { ivrPercent: 31.4, earningsDate: null }, NVDA: { ivrPercent: 44, earningsDate: '2026-10-28' } });
    expect(r.failed).toEqual([]);
    expect(fetcher).toHaveBeenCalledWith(['XLF', 'NVDA'], 'token');
  });

  it('a symbol the broker returns nothing for is simply absent (unavailable), not invented', async () => {
    const r = await fetchMetricsBatch(['XLF', 'ZZZZ'], 'token', async () => [{ symbol: 'XLF', ivRank: 20, earningsExpectedDate: null }]);
    expect(Object.keys(r.items)).toEqual(['XLF']);
  });

  it('batches the symbols, de-duplicates them, and a failed batch marks only its own symbols', async () => {
    const symbols = Array.from({ length: METRICS_BATCH_SIZE + 5 }, (_, i) => `S${i}`);
    const fetcher = vi.fn(async (chunk: string[]) => {
      if (chunk[0] === 'S0') throw new Error('nope');
      return chunk.map((symbol) => ({ symbol, ivRank: 25, earningsExpectedDate: null }));
    });
    const r = await fetchMetricsBatch([...symbols, 'S3'], 'token', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(r.failed).toHaveLength(METRICS_BATCH_SIZE);
    expect(Object.keys(r.items)).toHaveLength(5); // the second batch still landed
  });

  it('bad values become null, never NaN', async () => {
    const r = await fetchMetricsBatch(['XLF'], 'token', async () => [{ symbol: 'XLF', ivRank: Number.NaN, earningsExpectedDate: '' }]);
    expect(r.items.XLF).toEqual({ ivrPercent: null, earningsDate: null });
  });

  it('an empty list makes no call', async () => {
    const fetcher = vi.fn();
    expect(await fetchMetricsBatch([], 'token', fetcher)).toEqual({ items: {}, failed: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('fetchDailyCloses', () => {
  const respond = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;

  it('returns the closes from the chart route', async () => {
    const f = respond({ bars: [{ c: 10 }, { c: 11 }, { c: 12 }] });
    expect(await fetchDailyCloses('XLF', f)).toEqual([10, 11, 12]);
    expect(f).toHaveBeenCalledWith('/api/chart?symbol=XLF');
  });
  it('drops bars with no close', async () => {
    expect(await fetchDailyCloses('XLF', respond({ bars: [{ c: 10 }, { c: null }, {}, { c: 12 }] }))).toEqual([10, 12]);
  });
  it('null for an error payload, a bad status, a thrown fetch or no bars', async () => {
    expect(await fetchDailyCloses('XLF', respond({ error: 'x' }))).toBeNull();
    expect(await fetchDailyCloses('XLF', respond({ bars: [] }, false))).toBeNull();
    expect(await fetchDailyCloses('XLF', vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch)).toBeNull();
  });
});
