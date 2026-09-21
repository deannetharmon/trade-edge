// lib/leaps-position-intelligence/__tests__/cycleHistory.test.ts
//
// LEAPS-CYCLES-0001 -- the income history of a held LEAPS from the Trade Log's closed short calls.

import { describe, expect, it } from 'vitest';
import { buildCycleHistory, type CycleTrade } from '../cycleHistory';

const trade = (over: Partial<CycleTrade> = {}): CycleTrade => ({
  id: 't1', symbol: 'GOOGL', strategy: 'SHORT_CALL', openDate: '2026-08-20', closeDate: '2026-09-12', expiry: '2026-10-16', holdDays: 23, strikes: '375C',
  creditReceived: 640, closePrice: 243, pnl: 395.5, pnlPct: 61.8, outcome: 'WIN', fees: 1.5, closureMechanism: 'CLOSED', openedQuantity: 1, closedQuantity: 1, ...over,
});
const build = (trades: CycleTrade[], over: Partial<Parameters<typeof buildCycleHistory>[0]> = {}) => buildCycleHistory({
  trades, unmatchedClosures: [], underlying: 'GOOGL', longEntryDate: '2026-08-14', windowFrom: '2025-09-21', ...over,
});

describe('which trades count', () => {
  it('takes short calls on the same stock opened on or after the LEAPS open date', () => {
    const h = build([
      trade({ id: 'in', openDate: '2026-08-14' }),                    // same day as the LEAPS: included
      trade({ id: 'before', openDate: '2026-08-13' }),                // before the LEAPS was owned
      trade({ id: 'other-stock', symbol: 'AAPL' }),
      trade({ id: 'csp', strategy: 'CSP' }), trade({ id: 'spread', strategy: 'BCS' }),
      trade({ id: 'excluded', excluded: true }),
    ]);
    expect(h.rows.map(r => r.id)).toEqual(['in']);
  });

  it('matches the stock symbol case-insensitively and ignores spaces', () => {
    expect(build([trade({ symbol: 'googl ' })]).rows).toHaveLength(1);
    expect(build([trade()], { underlying: ' googl' }).rows).toHaveLength(1);
  });

  it('with no LEAPS open date it shows nothing and says why (no guessing)', () => {
    for (const longEntryDate of [null, '', '08/14/2026']) {
      expect(build([trade()], { longEntryDate })).toMatchObject({ rows: [], reason: 'no-entry-date', totals: { count: 0 } });
    }
  });
});

describe('rows', () => {
  it('carries the reconstructed numbers and uses the closed contract count', () => {
    const [row] = build([trade({ closedQuantity: 2, openedQuantity: 3 })]).rows;
    expect(row).toEqual({ id: 't1', openDate: '2026-08-20', closeDate: '2026-09-12', holdDays: 23, expiry: '2026-10-16', strike: '375C', contracts: 2, credit: 640, costToClose: 243, pnl: 395.5, pnlPct: 61.8, outcome: 'WIN', result: 'closed' });
  });

  it('falls back to the opened quantity when nothing is recorded as closed', () => {
    expect(build([trade({ closedQuantity: 0, openedQuantity: 3 })]).rows[0].contracts).toBe(3);
  });

  it.each([['EXPIRED', 'expired'], ['ASSIGNED', 'assigned'], ['EXERCISED', 'assigned'], ['PARTIAL_CLOSE', 'partial'], ['CLOSED', 'closed']] as const)('%s -> %s', (closureMechanism, result) => {
    expect(build([trade({ closureMechanism })]).rows[0].result).toBe(result);
  });

  it('a close followed by a new short call opened the same day is a roll (and only for a plain close)', () => {
    const h = build([
      trade({ id: 'old', openDate: '2026-08-20', closeDate: '2026-09-12' }),
      trade({ id: 'new', openDate: '2026-09-12', closeDate: '2026-10-10' }),
    ]);
    expect(h.rows.find(r => r.id === 'old')!.result).toBe('rolled');
    expect(h.rows.find(r => r.id === 'new')!.result).toBe('closed');
    const expired = build([trade({ id: 'old', closureMechanism: 'EXPIRED' }), trade({ id: 'new', openDate: '2026-09-12' })]);
    expect(expired.rows.find(r => r.id === 'old')!.result).toBe('expired');
  });

  it('sorts newest close first, then newest open', () => {
    const h = build([trade({ id: 'a', closeDate: '2026-09-01' }), trade({ id: 'b', closeDate: '2026-09-20' }), trade({ id: 'c', closeDate: '2026-09-20', openDate: '2026-09-01' })]);
    expect(h.rows.map(r => r.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('totals', () => {
  it('sums income net of fees, counts wins, and averages days held', () => {
    const h = build([trade({ id: 'a', pnl: 395.5, creditReceived: 640, holdDays: 23 }), trade({ id: 'b', openDate: '2026-09-15', closeDate: '2026-10-01', pnl: -120.25, creditReceived: 400, holdDays: 16, outcome: 'LOSS' })]);
    expect(h.totals).toEqual({ count: 2, credit: 1040, pnl: 275.25, wins: 1, avgHoldDays: 20 });
  });

  it('is all zeros with no trades, and avoids floating point drift', () => {
    expect(build([]).totals).toEqual({ count: 0, credit: 0, pnl: 0, wins: 0, avgHoldDays: 0 });
    expect(build([trade({ pnl: 0.1 }), trade({ id: 'x', pnl: 0.2 })]).totals.pnl).toBe(0.3);
  });
});

describe('what the history cannot see', () => {
  it('is complete only when the LEAPS was opened inside the Trade Log window', () => {
    expect(build([trade()], { windowFrom: '2026-08-14' }).coversFullHistory).toBe(true);
    expect(build([trade()], { windowFrom: '2026-08-15' }).coversFullHistory).toBe(false);
    expect(build([trade()], { longEntryDate: '2024-01-10' }).coversFullHistory).toBe(false);
  });

  it('counts closings on this stock, since the LEAPS opened, whose opening could not be found', () => {
    const h = build([trade()], { unmatchedClosures: [
      { underlying: 'GOOGL', executedAt: '2026-09-01T14:00:00.000Z' },   // counts
      { underlying: 'googl', executedAt: '2026-08-14T14:00:00.000Z' },   // same day as the LEAPS: counts
      { underlying: 'GOOGL', executedAt: '2026-08-01T14:00:00.000Z' },   // before the LEAPS
      { underlying: 'AAPL', executedAt: '2026-09-01T14:00:00.000Z' },    // other stock
    ] });
    expect(h.unmatchedCount).toBe(2);
  });

  it('never mutates its input', () => {
    const trades = [trade()];
    const before = JSON.stringify(trades);
    build(trades);
    expect(JSON.stringify(trades)).toBe(before);
  });
});
