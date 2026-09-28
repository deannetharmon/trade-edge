// lib/wheel/__tests__/historyData.test.ts

import { describe, expect, it, vi } from 'vitest';
import { fetchPriceHistory } from '../historyData';

describe('fetchPriceHistory', () => {
  const respond = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;

  it('returns the closes from the chart-history route, defaulting to 5 years', async () => {
    const f = respond({ closes: [{ t: 1, c: 10 }, { t: 2, c: 11 }] });
    expect(await fetchPriceHistory('XLF', undefined, f)).toEqual([10, 11]);
    expect(f).toHaveBeenCalledWith('/api/chart-history?symbol=XLF&years=5');
  });
  it('passes a custom years value through', async () => {
    const f = respond({ closes: [{ t: 1, c: 10 }] });
    await fetchPriceHistory('XLF', 3, f);
    expect(f).toHaveBeenCalledWith('/api/chart-history?symbol=XLF&years=3');
  });
  it('drops entries with no close', async () => {
    expect(await fetchPriceHistory('XLF', 5, respond({ closes: [{ c: 10 }, { c: null }, {}, { c: 12 }] }))).toEqual([10, 12]);
  });
  it('null for an error payload, a bad status, a thrown fetch, or no closes', async () => {
    expect(await fetchPriceHistory('XLF', 5, respond({ error: 'x' }))).toBeNull();
    expect(await fetchPriceHistory('XLF', 5, respond({ closes: [] }, false))).toBeNull();
    expect(await fetchPriceHistory('XLF', 5, vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch)).toBeNull();
  });
});
