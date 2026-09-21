// features/portfolio/positions-workspace/__tests__/cycleTradesLoader.test.ts
//
// LEAPS-CYCLES-0001 -- one shared, short-lived load of the Trade Log for all held LEAPS on the screen; errors are never cached.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchAndReconstructTrades = vi.fn();
vi.mock('@/lib/tradeLog/reconstructTrades', () => ({
  fetchAndReconstructTrades: (...args: unknown[]) => fetchAndReconstructTrades(...args),
  rangeStartDate: (range: string) => (range === '12m' ? '2025-09-21' : 'bad'),
}));

import { CYCLE_TRADES_TTL_MS, loadClosedTrades, resetCycleTradesCache } from '../cycleTradesLoader';

const result = (over: Record<string, unknown> = {}) => ({ trades: [{ id: 't1' }], unmatchedClosures: [{ underlying: 'GOOGL' }], transactions: [{ 'account-number': 'ACCT-1' }, { 'account-number': 'ACCT-1' }], ...over });

beforeEach(() => { resetCycleTradesCache(); fetchAndReconstructTrades.mockReset().mockResolvedValue(result()); });

describe('loadClosedTrades', () => {
  it('loads the 12-month Trade Log and reports the window start and the account the transactions belong to', async () => {
    const loaded = await loadClosedTrades();
    expect(fetchAndReconstructTrades).toHaveBeenCalledWith('12m');
    expect(loaded).toEqual({ trades: [{ id: 't1' }], unmatchedClosures: [{ underlying: 'GOOGL' }], windowFrom: '2025-09-21', accountNumber: 'ACCT-1' });
  });

  it('several cards asking at once share a single fetch', async () => {
    const [a, b, c] = await Promise.all([loadClosedTrades(), loadClosedTrades(), loadClosedTrades()]);
    expect(fetchAndReconstructTrades).toHaveBeenCalledTimes(1);
    expect(a).toBe(b); expect(b).toBe(c);
  });

  it('reuses the result for ten minutes, then loads again', async () => {
    let now = 1_000_000;
    await loadClosedTrades(() => now);
    now += CYCLE_TRADES_TTL_MS - 1;
    await loadClosedTrades(() => now);
    expect(fetchAndReconstructTrades).toHaveBeenCalledTimes(1);
    now += 2;
    await loadClosedTrades(() => now);
    expect(fetchAndReconstructTrades).toHaveBeenCalledTimes(2);
  });

  it('a failure is passed on and is not cached, so a retry works', async () => {
    fetchAndReconstructTrades.mockRejectedValueOnce(new Error('network'));
    await expect(loadClosedTrades()).rejects.toThrow('network');
    await expect(loadClosedTrades()).resolves.toMatchObject({ accountNumber: 'ACCT-1' });
    expect(fetchAndReconstructTrades).toHaveBeenCalledTimes(2);
  });

  it('with no transactions the account is unknown (null), not guessed', async () => {
    fetchAndReconstructTrades.mockResolvedValue(result({ transactions: [], trades: [], unmatchedClosures: [] }));
    expect(await loadClosedTrades()).toMatchObject({ accountNumber: null, trades: [] });
  });

  it('a transaction without a usable account number is skipped', async () => {
    fetchAndReconstructTrades.mockResolvedValue(result({ transactions: [{ 'account-number': 42 }, { 'account-number': 'ACCT-9' }] }));
    expect((await loadClosedTrades()).accountNumber).toBe('ACCT-9');
  });
});
