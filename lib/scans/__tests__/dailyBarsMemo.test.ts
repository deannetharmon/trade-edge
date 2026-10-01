// lib/scans/__tests__/dailyBarsMemo.test.ts

// RSI-ENTRY-0001 slice A1b: one request per symbol, failures never kept, expiry after 60 s.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAILY_BARS_TTL_MS, clearDailyBarsMemo, fetchDailyBars } from '../dailyBarsMemo';

const ok = (bars: unknown) => ({ ok: true, status: 200, json: async () => ({ bars }) });
const bad = (status: number) => ({ ok: false, status, json: async () => ({}) });

beforeEach(() => { clearDailyBarsMemo(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T15:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('fetchDailyBars', () => {
  it('two concurrent callers share one request', async () => {
    const fn = vi.fn(async () => ok([{ t: 1, c: 2 }]));
    vi.stubGlobal('fetch', fn);
    const [a, b] = await Promise.all([fetchDailyBars('AAPL'), fetchDailyBars('AAPL')]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(a).toEqual([{ t: 1, c: 2 }]);
    expect(b).toBe(a);
  });
  it('a later call inside the window reuses; one at the window edge refetches', async () => {
    const fn = vi.fn(async () => ok([]));
    vi.stubGlobal('fetch', fn);
    await fetchDailyBars('AAPL');
    vi.setSystemTime(Date.now() + DAILY_BARS_TTL_MS - 1);
    await fetchDailyBars('AAPL');
    expect(fn).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1);
    await fetchDailyBars('AAPL');
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('different symbols do not share', async () => {
    const fn = vi.fn(async () => ok([]));
    vi.stubGlobal('fetch', fn);
    await fetchDailyBars('AAPL');
    await fetchDailyBars('MSFT');
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('requests the exact URL with no-store and encodes the symbol', async () => {
    const fn = vi.fn(async () => ok([]));
    vi.stubGlobal('fetch', fn);
    await fetchDailyBars('^GSPC');
    expect(fn).toHaveBeenCalledWith('/api/chart?symbol=%5EGSPC', { cache: 'no-store' });
  });
  it('a non-OK response throws the getTrend error text and is not kept', async () => {
    const fn = vi.fn().mockResolvedValueOnce(bad(502)).mockResolvedValueOnce(ok([{ t: 1, c: 2 }]));
    vi.stubGlobal('fetch', fn);
    await expect(fetchDailyBars('AAPL', 'AAPL')).rejects.toThrow('Yahoo chart fetch failed for AAPL (502)');
    await expect(fetchDailyBars('AAPL')).resolves.toEqual([{ t: 1, c: 2 }]);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('the error names the caller label, not the chart symbol', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => bad(500)));
    await expect(fetchDailyBars('^GSPC', 'SPX')).rejects.toThrow('Yahoo chart fetch failed for SPX (500)');
  });
  it('a network error is not kept', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ok([]));
    vi.stubGlobal('fetch', fn);
    await expect(fetchDailyBars('AAPL')).rejects.toThrow('offline');
    await expect(fetchDailyBars('AAPL')).resolves.toEqual([]);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('bad JSON is not kept', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })
      .mockResolvedValueOnce(ok([]));
    vi.stubGlobal('fetch', fn);
    await expect(fetchDailyBars('AAPL')).rejects.toThrow('bad json');
    await expect(fetchDailyBars('AAPL')).resolves.toEqual([]);
  });
  it('missing bars resolve to an empty array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    await expect(fetchDailyBars('AAPL')).resolves.toEqual([]);
  });
  it('concurrent callers all see the same failure, then a retry works', async () => {
    const fn = vi.fn().mockResolvedValueOnce(bad(503)).mockResolvedValueOnce(ok([]));
    vi.stubGlobal('fetch', fn);
    const results = await Promise.allSettled([fetchDailyBars('AAPL'), fetchDailyBars('AAPL')]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(fn).toHaveBeenCalledTimes(1);
    await expect(fetchDailyBars('AAPL')).resolves.toEqual([]);
  });
});
