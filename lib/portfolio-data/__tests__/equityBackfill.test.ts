import { describe, expect, it } from 'vitest';
import { backfillStockPnl, stockFills } from '../equityBackfill';

const closes = (o: Record<string, number>) => new Map(Object.entries(o));

describe('stockFills', () => {
  it('keeps priced buys and sells, drops splits and other symbols', () => {
    const fills = stockFills([
      { 'instrument-type': 'Equity', symbol: 'TQQQ', action: 'Buy to Open', quantity: '100', price: '82', 'executed-at': '2026-10-29T14:00:00Z' },
      { 'instrument-type': 'Equity', symbol: 'SNDK', 'transaction-sub-type': 'Forward Split', action: 'Buy to Open', quantity: '16', 'executed-at': '2026-11-20T14:00:00Z' },
      { 'instrument-type': 'Equity', symbol: 'MULL', action: 'Buy to Open', quantity: '100', price: '21', 'executed-at': '2026-11-20T14:00:00Z' },
    ], 'TQQQ');
    expect(fills).toEqual([{ date: '2026-10-29', qty: 100, price: 82 }]);
  });
});

describe('backfillStockPnl', () => {
  const from = '2026-10-28';
  const today = '2026-11-05';
  it('replays two lots at average cost and starts on the first buy', () => {
    const out = backfillStockPnl({
      fills: [{ date: '2026-10-29', qty: 100, price: 82 }, { date: '2026-11-04', qty: 100, price: 75.5 }],
      closes: closes({ '2026-10-28': 80, '2026-10-29': 80, '2026-10-30': 78, '2026-11-02': 76, '2026-11-03': 74, '2026-11-04': 70 }),
      sharesNow: 200, pnlNow: -1, from, todayNy: today,
    });
    expect(out[0]).toEqual({ date: '2026-10-29', pnl: 100 * 80 - 8200 });
    expect(out.map(d => d.date)).toEqual(['2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04']);
    expect(out[4].pnl).toBeCloseTo(200 * 70 - (8200 + 7550));
  });
  it('anchors a stock held all window to today\'s P/L and never writes today', () => {
    const out = backfillStockPnl({ fills: [], closes: closes({ '2026-11-02': 100, '2026-11-03': 110, '2026-11-05': 120 }), sharesNow: 10, pnlNow: 200, from, todayNy: today });
    expect(out).toEqual([{ date: '2026-11-02', pnl: 0 }, { date: '2026-11-03', pnl: 100 }]);
  });
  it('skips a stock whose fills do not add up to today\'s shares', () => {
    const out = backfillStockPnl({ fills: [{ date: '2026-11-02', qty: 100, price: 50 }], closes: closes({ '2026-11-03': 60 }), sharesNow: 300, pnlNow: 0, from, todayNy: today });
    expect(out).toEqual([]);
  });
});
