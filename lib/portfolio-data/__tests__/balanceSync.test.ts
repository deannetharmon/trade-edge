// lib/portfolio-data/__tests__/balanceSync.test.ts

// SPARKLINES-0001A: the shared balance-snapshot sync (moved out of the Balances tab, behavior unchanged).

import { describe, expect, it, vi } from 'vitest';
import { syncBalanceSnapshots } from '../balanceSync';

const NOW = Date.parse('2026-11-24T18:00:00Z'); // a Tuesday afternoon in New York
const item = (date: string, nlv: string) => ({ 'snapshot-date': date, 'net-liquidating-value': nlv, 'cash-balance': '100', 'long-derivative-value': '50', 'short-derivative-value': '20' });

describe('syncBalanceSnapshots', () => {
  it('saves completed days only (today and zero days are dropped) and returns null', async () => {
    const save = vi.fn(async () => ({ ok: true, status: 200 }));
    const ttFetch = vi.fn(async () => ({ data: { items: [item('2026-11-21', '26000'), item('2026-11-23', '26290'), item('2026-11-24', '26452'), item('2026-11-22', '0')] } }));
    const out = await syncBalanceSnapshots({ ttFetch, token: 't', accountNumber: 'ACCT1', save, nowMs: NOW });
    expect(out).toBeNull();
    expect(ttFetch).toHaveBeenCalledWith('/accounts/ACCT1/balance-snapshots', 't');
    expect(save).toHaveBeenCalledWith([
      { date: '2026-11-21', netLiquidatingValue: 26000, cashBalance: 100, netOptionsValue: 30 },
      { date: '2026-11-23', netLiquidatingValue: 26290, cashBalance: 100, netOptionsValue: 30 },
    ]);
  });

  it('names the reason when the broker returns no completed days, when saving fails, and when the broker call throws', async () => {
    const save = vi.fn(async () => ({ ok: false, status: 500 }));
    expect(await syncBalanceSnapshots({ ttFetch: async () => ({ data: { items: [] } }), token: 't', accountNumber: 'A', save, nowMs: NOW })).toBe('The broker returned no completed balance days.');
    expect(await syncBalanceSnapshots({ ttFetch: async () => ({ data: { items: [item('2026-11-23', '26290')] } }), token: 't', accountNumber: 'A', save, nowMs: NOW })).toBe('Saving balance history failed (500).');
    expect(await syncBalanceSnapshots({ ttFetch: async () => { throw new Error('boom'); }, token: 't', accountNumber: 'A', save, nowMs: NOW })).toBe('Balance history sync failed: boom');
  });
});
