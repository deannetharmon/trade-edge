// lib/tradeLog/__tests__/equityRealized.test.ts

import { describe, expect, it } from 'vitest';
import { reconstructEquityRealized } from '../equityRealized';

let seq = 0;
const share = (symbol: string, action: string, qty: number, price: number, at: string, over: Record<string, unknown> = {}) => ({
  id: `tx${seq += 1}`, 'instrument-type': 'Equity', 'transaction-type': 'Trade', 'transaction-sub-type': action, action,
  symbol, 'underlying-symbol': symbol, quantity: String(qty), price: String(price), 'executed-at': at, commission: '0.0', 'clearing-fees': '0.0', 'regulatory-fees': '0.0', ...over,
});

describe('reconstructEquityRealized', () => {
  it('realizes a long sale against its purchase, by close date, and nets fees', () => {
    const r = reconstructEquityRealized([
      share('META', 'Buy to Open', 10, 650, '2026-09-15T14:00:00.000+0000'),
      share('META', 'Sell to Close', 10, 725.34, '2026-10-09T15:08:00.000+0000', { 'regulatory-fees': '0.02', 'clearing-fees': '0.10' }),
    ]);
    expect(r.unmatched).toEqual([]);
    expect(r.lots).toHaveLength(1);
    expect(r.lots[0]).toMatchObject({ symbol: 'META', closeDate: '2026-10-09', openDate: '2026-09-15', shares: 10, side: 'LONG' });
    expect(r.lots[0].pnl).toBe(753.28); // (725.34 - 650) x 10 = 753.40, less 0.12 of fees
  });

  it('closes the oldest lots first and splits a sale across two purchases', () => {
    const r = reconstructEquityRealized([
      share('SOXL', 'Buy to Open', 100, 50, '2026-09-01T14:00:00.000+0000'),
      share('SOXL', 'Buy to Open', 100, 60, '2026-09-10T14:00:00.000+0000'),
      share('SOXL', 'Sell to Close', 150, 70, '2026-10-02T14:00:00.000+0000'),
    ]);
    expect(r.lots.map(l => [l.shares, l.openPrice, l.pnl])).toEqual([[100, 50, 2000], [50, 60, 500]]);
  });

  it('leaves the unsold remainder open and realizes nothing for it', () => {
    const r = reconstructEquityRealized([
      share('TQQQ', 'Buy to Open', 200, 40, '2026-09-01T14:00:00.000+0000'),
      share('TQQQ', 'Sell to Close', 50, 45, '2026-10-01T14:00:00.000+0000'),
    ]);
    expect(r.lots).toHaveLength(1);
    expect(r.lots[0].pnl).toBe(250);
  });

  it('realizes a loss', () => {
    const r = reconstructEquityRealized([
      share('GGLL', 'Buy to Open', 10, 80, '2026-09-01T14:00:00.000+0000'),
      share('GGLL', 'Sell to Close', 10, 75, '2026-10-05T14:00:00.000+0000'),
    ]);
    expect(r.lots[0].pnl).toBe(-50);
  });

  it('handles short stock in reverse', () => {
    const r = reconstructEquityRealized([
      share('XYZ', 'Sell to Open', 10, 100, '2026-09-01T14:00:00.000+0000'),
      share('XYZ', 'Buy to Close', 10, 90, '2026-10-01T14:00:00.000+0000'),
    ]);
    expect(r.lots[0]).toMatchObject({ side: 'SHORT', pnl: 100 });
  });

  it('counts shares received through a put assignment at the strike, then sold: the share leg adds only the move since the strike', () => {
    const r = reconstructEquityRealized([
      share('SOXL', 'Buy to Open', 100, 40, '2026-10-02T20:00:00.000+0000', { 'transaction-type': 'Receive Deliver', 'transaction-sub-type': 'Assignment', action: undefined, 'net-value-effect': 'Debit' }),
      share('SOXL', 'Sell to Close', 100, 43.5, '2026-10-08T15:00:00.000+0000'),
    ]);
    expect(r.unmatched).toEqual([]);
    expect(r.lots[0].pnl).toBe(350);
  });

  it('never guesses a cost basis: a close with no opening purchase in the window is unmatched and adds nothing', () => {
    const r = reconstructEquityRealized([share('META', 'Sell to Close', 10, 725.34, '2026-10-09T15:08:00.000+0000')]);
    expect(r.lots).toEqual([]);
    expect(r.unmatched).toHaveLength(1);
    expect(r.unmatched[0]).toMatchObject({ symbol: 'META', quantity: 10 });
    expect(r.unmatched[0].reason).toMatch(/cost basis is unknown/);
  });

  it('a partly matched sale realizes the matched shares and reports the rest as unmatched', () => {
    const r = reconstructEquityRealized([
      share('META', 'Buy to Open', 4, 700, '2026-09-20T14:00:00.000+0000'),
      share('META', 'Sell to Close', 10, 725, '2026-10-09T15:08:00.000+0000'),
    ]);
    expect(r.lots[0].pnl).toBe(100);
    expect(r.unmatched[0].quantity).toBe(6);
  });

  it('reads direction from the credit/debit effect when the action text is missing', () => {
    const r = reconstructEquityRealized([
      share('AAPL', '', 10, 100, '2026-09-01T14:00:00.000+0000', { action: undefined, 'transaction-sub-type': undefined, 'net-value-effect': 'Debit' }),
      share('AAPL', '', 10, 110, '2026-10-01T14:00:00.000+0000', { action: undefined, 'transaction-sub-type': undefined, 'net-value-effect': 'Credit' }),
    ]);
    expect(r.lots[0].pnl).toBe(100);
  });

  it('uses the traded value when a price is missing, and flags a transaction with no usable data', () => {
    const r = reconstructEquityRealized([
      share('AAPL', 'Buy to Open', 10, 100, '2026-09-01T14:00:00.000+0000'),
      share('AAPL', 'Sell to Close', 10, 0, '2026-10-01T14:00:00.000+0000', { price: undefined, value: '1100', 'value-effect': 'Credit' }),
      share('AAPL', 'Sell to Close', 5, 0, '2026-10-02T14:00:00.000+0000', { price: undefined, value: undefined }),
    ]);
    expect(r.lots[0].pnl).toBe(100);
    expect(r.unmatched).toHaveLength(1);
    expect(r.unmatched[0].reason).toMatch(/no readable/);
  });

  it('uses the New York calendar day, not the UTC day, for a late-evening close', () => {
    const r = reconstructEquityRealized([
      share('META', 'Buy to Open', 1, 100, '2026-09-01T14:00:00.000+0000'),
      share('META', 'Sell to Close', 1, 110, '2026-10-10T01:30:00.000+0000'), // 9:30 pm EDT on Oct 9
    ]);
    expect(r.lots[0].closeDate).toBe('2026-10-09');
  });

  it('ignores options and non-trade rows', () => {
    const r = reconstructEquityRealized([
      { id: 'o1', 'instrument-type': 'Equity Option', 'transaction-type': 'Trade', symbol: 'META  261120P00600000', action: 'Sell to Close', quantity: '1', price: '3', 'executed-at': '2026-10-09T15:00:00.000+0000' },
      { id: 'm1', 'transaction-type': 'Money Movement', 'transaction-sub-type': 'Deposit', value: '1000' },
    ]);
    expect(r).toEqual({ lots: [], unmatched: [] });
  });
});
