// lib/tradeLog/__tests__/fetchAndReconstructTrades.pagination.test.ts
//
// Tastytrade's `page-offset` is a PAGE NUMBER (0-indexed), not a running item
// count. A prior version of fetchAndReconstructTrades sent `(page - 1) * 250`
// (an item-offset value) instead of `page - 1`, so every request past page 1
// asked for a page far beyond the account's real total-pages and got back an
// empty page -- silently truncating history at 250 transactions with no
// error, no warning. Confirmed live: page-offset=250 returned 0 items,
// page-offset=1 returned real data, for the same account/range.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetchAndReconstructTrades } from '../reconstructTrades';

vi.mock('@/lib/auth/tastytradeToken', () => ({ getAccessToken: vi.fn().mockResolvedValue('tok') }));
vi.mock('@/lib/tastytrade/accountSelection', () => ({ requireActiveBrokerAccount: vi.fn().mockResolvedValue('5WI51392') }));

function page(items: unknown[], pageOffset: number, totalItems: number) {
  return { data: { items }, pagination: { 'per-page': 250, 'page-offset': pageOffset, 'total-items': totalItems } };
}
const tx = (id: number) => ({ id, symbol: 'AAPL', action: 'Sell to Open' });

beforeEach(() => { vi.restoreAllMocks(); });

describe('fetchAndReconstructTrades pagination', () => {
  it('requests page-offset as a page NUMBER (0, 1, 2...), not an item count', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page(Array.from({ length: 250 }, (_, i) => tx(i)), 0, 285) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page(Array.from({ length: 35 }, (_, i) => tx(250 + i)), 1, 285) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAndReconstructTrades('12M' as never);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('page-offset=0');
    expect(fetchMock.mock.calls[1][0]).toContain('page-offset=1');
    // Would fail before the fix: the old code sent page-offset=250 on call 2.
    expect(fetchMock.mock.calls[1][0]).not.toContain('page-offset=250');
    expect(result.transactions).toHaveLength(285);
  });

  it('does not silently stop early: a real account with >250 transactions returns all of them, not just the first 250', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page(Array.from({ length: 250 }, (_, i) => tx(i)), 0, 510) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page(Array.from({ length: 250 }, (_, i) => tx(250 + i)), 1, 510) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page(Array.from({ length: 10 }, (_, i) => tx(500 + i)), 2, 510) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAndReconstructTrades('12M' as never);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain('page-offset=2');
    expect(result.transactions).toHaveLength(510);
  });

  it('stops correctly on a single-page account (no regression for the common case)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => page([tx(1), tx(2), tx(3)], 0, 3) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAndReconstructTrades('12M' as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.transactions).toHaveLength(3);
  });
});
