// lib/tradeLog/__tests__/performanceMetrics.test.ts

import { describe, expect, it } from 'vitest';
import type { ClosedTrade } from '../types';
import { buildPerformanceReport, capitalAtRisk, methodExit } from '../performanceMetrics';

let n = 0;
const t = (o: Partial<ClosedTrade>): ClosedTrade => ({
  id: `t${n++}`, symbol: 'SPY', strategy: 'BPS', openDate: '2026-05-01', closeDate: '2026-05-10', openTime: '10:00', openDow: 1, expiry: '2026-06-18',
  holdDays: 9, strikes: '450P/445P', creditReceived: 200, closePrice: 100, pnl: 97.5, pnlPct: 48.75, outcome: 'WIN', quantity: 2, fees: 2.5,
  dteAtClose: 39, dteAtEntry: 48, exitType: 'SCRATCH_WIN', reconstructionStatus: 'COMPLETE', closureMechanism: 'CLOSED',
  openedQuantity: 1, closedQuantity: 1, remainingQuantity: 0, sourceTransactionIds: [], ...o,
});

describe('PERF-0001 performance metrics', () => {
  it('one record set: incomplete and user-excluded rows never enter any total', () => {
    const rep = buildPerformanceReport([t({ pnl: 100 }), t({ pnl: -50, outcome: 'LOSS' }), t({ pnl: 999, reconstructionStatus: 'INCOMPLETE' }), t({ pnl: 500, excluded: true })]);
    expect(rep.headline.trades).toBe(2);
    expect(rep.headline.pnl).toBe(50);
    expect(rep.incomplete).toHaveLength(1);
    expect(rep.excludedByUser).toBe(1);
    const sumStrategies = Object.values(rep.byStrategy).reduce((s, g) => s + g.pnl, 0);
    const sumMonths = rep.byMonth.reduce((s, m) => s + m.stats.pnl, 0);
    const sumTickers = rep.byTicker.reduce((s, x) => s + x.stats.pnl, 0);
    const sumExits = Object.values(rep.exits).reduce((s, e) => s + e.pnl, 0);
    [sumStrategies, sumMonths, sumTickers, sumExits].forEach(v => expect(v).toBe(50));
  });

  it('methodology exits: target, early profit, stopped within 2x, beyond the stop, expired, assigned', () => {
    expect(methodExit(t({ creditReceived: 200, pnl: 100, fees: 0 }))).toBe('TARGET');
    expect(methodExit(t({ creditReceived: 200, pnl: 40, fees: 0 }))).toBe('EARLY_PROFIT');
    expect(methodExit(t({ creditReceived: 200, pnl: -200, fees: 0 }))).toBe('STOPPED');
    expect(methodExit(t({ creditReceived: 200, pnl: -201, fees: 0 }))).toBe('BEYOND_STOP');
    expect(methodExit(t({ closureMechanism: 'EXPIRED' }))).toBe('EXPIRED');
    expect(methodExit(t({ closureMechanism: 'ASSIGNED', strategy: 'CSP' }))).toBe('ASSIGNED');
  });

  it('capital at risk: spread max loss, CSP collateral, short call unbounded', () => {
    expect(capitalAtRisk(t({ strikes: '450P/445P', creditReceived: 200, closedQuantity: 1 }))).toBe(300);
    expect(capitalAtRisk(t({ strategy: 'CSP', strikes: '135P', creditReceived: 805, closedQuantity: 1 }))).toBe(13500);
    expect(capitalAtRisk(t({ strategy: 'SHORT_CALL', strikes: '150C' }))).toBeNull();
  });

  it('beyond-stop leak and the excess over the stop', () => {
    const rep = buildPerformanceReport([t({ symbol: 'SMH', creditReceived: 356, pnl: -551.3, fees: 5.3, outcome: 'LOSS' })]);
    expect(rep.rules.beyondStop).toMatchObject({ trades: 1, symbols: ['SMH'] });
    expect(rep.rules.beyondStop.excessLoss).toBeCloseTo(546 - 356, 6);
  });

  it('rule adherence: spreads entered inside 21 DTE and held past 21 DTE; CSP exempt', () => {
    const rep = buildPerformanceReport([
      t({ dteAtEntry: 8, dteAtClose: 7 }),
      t({ dteAtEntry: 45, dteAtClose: 17 }),
      t({ strategy: 'CSP', strikes: '200P', dteAtEntry: 39, dteAtClose: 2 }),
    ]);
    expect(rep.rules.enteredInside21Dte.trades).toBe(1);
    expect(rep.rules.spreadsHeldPast21Dte.trades).toBe(1);
  });

  it('by ticker: total and per month; by month carries a running total; drawdown from the realized curve', () => {
    const rep = buildPerformanceReport([
      t({ symbol: 'MU', closeDate: '2026-08-17', pnl: 822 }),
      t({ symbol: 'MU', closeDate: '2026-09-16', pnl: -167, outcome: 'LOSS' }),
      t({ symbol: 'SMH', closeDate: '2026-07-30', pnl: -551, outcome: 'LOSS' }),
    ]);
    expect(rep.byTicker[0]).toMatchObject({ symbol: 'MU', byMonth: { '2026-08': 822, '2026-09': -167 } });
    expect(rep.byTicker[0].stats.pnl).toBe(655);
    expect(rep.byMonth.map(m => [m.month, m.cumulativePnl])).toEqual([['2026-07', -551], ['2026-08', 271], ['2026-09', 104]]);
    expect(rep.headline.maxDrawdown).toBe(-551);
  });
});
