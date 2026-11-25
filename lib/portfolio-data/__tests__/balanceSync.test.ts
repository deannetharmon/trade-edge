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
    expect(ttFetch).toHaveBeenCalledWith('/accounts/ACCT1/balance-snapshots?time-of-day=EOD&start-date=2025-10-20&end-date=2026-11-24&per-page=250&page-offset=0', 't');
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

  it('asks for a dated range of end-of-day snapshots, pages through them, and honors lookbackDays', async () => {
    const save = vi.fn(async () => ({ ok: true, status: 200 }));
    const ttFetch = vi.fn(async (path: string) => path.includes('page-offset=0')
      ? { data: { items: [item('2026-11-20', '26000')] }, pagination: { 'total-pages': 2 } }
      : { data: { items: [item('2026-11-23', '26290')] }, pagination: { 'total-pages': 2 } });
    const out = await syncBalanceSnapshots({ ttFetch, token: 't', accountNumber: 'A', save, nowMs: NOW, lookbackDays: 45 });
    expect(out).toBeNull();
    expect(ttFetch).toHaveBeenCalledTimes(2);
    expect(ttFetch.mock.calls[0][0]).toContain('time-of-day=EOD&start-date=2026-10-10&end-date=2026-11-24&per-page=250&page-offset=0');
    expect(ttFetch.mock.calls[1][0]).toContain('page-offset=1');
    expect(save).toHaveBeenCalledWith([
      { date: '2026-11-20', netLiquidatingValue: 26000, cashBalance: 100, netOptionsValue: 30 },
      { date: '2026-11-23', netLiquidatingValue: 26290, cashBalance: 100, netOptionsValue: 30 },
    ]);
  });

  it('falls back to the plain call when the ranged call is rejected or returns nothing', async () => {
    const save = vi.fn(async () => ({ ok: true, status: 200 }));
    const rejected = vi.fn(async (path: string) => { if (path.includes('start-date')) throw new Error('400'); return { data: { items: [item('2026-11-23', '26290')] } }; });
    expect(await syncBalanceSnapshots({ ttFetch: rejected, token: 't', accountNumber: 'A', save, nowMs: NOW })).toBeNull();
    expect(rejected).toHaveBeenLastCalledWith('/accounts/A/balance-snapshots', 't');
    const empty = vi.fn(async (path: string) => (path.includes('start-date') ? { data: { items: [] } } : { data: { items: [item('2026-11-23', '26290')] } }));
    expect(await syncBalanceSnapshots({ ttFetch: empty, token: 't', accountNumber: 'A', save, nowMs: NOW })).toBeNull();
    expect(empty).toHaveBeenLastCalledWith('/accounts/A/balance-snapshots', 't');
  });
});
