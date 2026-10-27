// lib/pnlCalendar/__tests__/buildPnlCalendar.test.ts

import { describe, expect, it } from 'vitest';
import {
  buildMonthCalendar, buildMonthlyGoal, buildPace, formatCellMoney, formatSignedMoney, formatSignedPct, monthBaseline, shiftMonth,
} from '../buildPnlCalendar';
import { buildPerformanceReport } from '../../tradeLog/performanceMetrics';
import type { EquityRealizedLot } from '../../tradeLog/equityRealized';
import type { ClosedTrade } from '../../tradeLog/types';

const lot = (symbol: string, closeDate: string, pnl: number, over: Partial<EquityRealizedLot> = {}): EquityRealizedLot => ({
  id: `${symbol}-${closeDate}-${pnl}`, symbol, openDate: '2026-09-01', closeDate, shares: 10, side: 'LONG', openPrice: 100, closePrice: 110, fees: 0, pnl, ...over,
});

let seq = 0;
const trade = (closeDate: string, pnl: number, over: Partial<ClosedTrade> = {}): ClosedTrade => ({
  id: `t${seq += 1}`, symbol: 'GGLL', strategy: 'CSP', openDate: '2026-09-01', closeDate, openTime: '10:00', openDow: 2, expiry: '2026-11-20',
  holdDays: 5, strikes: '75P', creditReceived: 300, closePrice: 1, pnl, pnlPct: 0, outcome: 'WIN' as ClosedTrade['outcome'], quantity: 1, fees: 1,
  dteAtClose: 20, dteAtEntry: 30, exitType: 'TARGET' as ClosedTrade['exitType'], reconstructionStatus: 'COMPLETE', closureMechanism: 'BTC' as ClosedTrade['closureMechanism'],
  openedQuantity: 1, closedQuantity: 1, remainingQuantity: 0, sourceTransactionIds: [], ...over,
});

// A trimmed copy of the October 2026 shape: a loss on the 1st, several closes on the 9th, a loss on the 13th.
const OCT = [
  trade('2026-10-01', -112), trade('2026-10-05', 50), trade('2026-10-06', 486), trade('2026-10-09', 1000), trade('2026-10-09', 800.4),
  trade('2026-10-12', 174), trade('2026-10-13', -155), trade('2026-10-19', 74), trade('2026-10-21', 123),
];

describe('buildMonthCalendar', () => {
  const cal = buildMonthCalendar(OCT, '2026-10');

  it('lays October 2026 out in five Sunday-first weeks that end on Sat Oct 31', () => {
    expect(cal.label).toBe('Oct 2026');
    expect(cal.weeks).toHaveLength(5);
    expect(cal.weeks[0].days[0].date).toBe('2026-09-27');
    expect(cal.weeks[4].days[6].date).toBe('2026-10-31');
    expect(cal.weeks.every(w => w.days.length === 7)).toBe(true);
  });

  it('puts each trade on its close date and sums several closes on one day', () => {
    const day = (d: string) => cal.weeks.flatMap(w => w.days).find(x => x.date === d)!;
    expect(day('2026-10-09').pnl).toBe(1800.4);
    expect(day('2026-10-09').trades).toBe(2);
    expect(day('2026-10-13').pnl).toBe(-155);
    expect(day('2026-10-07').pnl).toBeNull();
  });

  it('marks days outside the month and never counts them in a week total', () => {
    expect(cal.weeks[0].days[0].inMonth).toBe(false);
    expect(cal.weeks[0].total).toBe(-112); // only Oct 1 counts in the week that starts Sep 27
  });

  it('week totals are null when nothing closed, and the month total is the sum of the weeks', () => {
    expect(cal.weeks[4].total).toBeNull();
    const weekSum = cal.weeks.reduce((n, w) => n + (w.total ?? 0), 0);
    expect(Math.round(weekSum * 100) / 100).toBe(cal.total);
    expect(cal.total).toBe(2440.4);
    expect(cal.trades).toBe(9);
  });

  it('equals Performance for the same month: same records, same total', () => {
    const report = buildPerformanceReport(OCT);
    const month = report.byMonth.find(m => m.month === '2026-10')!;
    expect(cal.total).toBe(Math.round(month.stats.pnl * 100) / 100);
  });

  it('leaves out user-excluded and incomplete trades, and reports how many', () => {
    const noisy = [...OCT, trade('2026-10-14', 999, { excluded: true }), trade('2026-10-14', 888, { reconstructionStatus: 'INCOMPLETE' })];
    const c = buildMonthCalendar(noisy, '2026-10');
    expect(c.total).toBe(2440.4);
    expect(c.excludedByUser).toBe(1);
    expect(c.incomplete).toBe(1);
  });

  it('ignores trades closed in other months', () => {
    const c = buildMonthCalendar([...OCT, trade('2026-09-30', 5000), trade('2026-11-02', 5000)], '2026-10');
    expect(c.total).toBe(2440.4);
  });

  it('handles a six-row month and February', () => {
    expect(buildMonthCalendar([], '2026-08').weeks).toHaveLength(6); // Aug 2026 starts on a Saturday
    expect(buildMonthCalendar([], '2026-02').weeks).toHaveLength(4);
    expect(buildMonthCalendar([], '2026-02').daysInMonth).toBe(28);
  });
});

describe('PNL-CAL-0002: share P/L in the calendar', () => {
  // The October 2026 gap: options only (+$660 here) plus a META share sale on the 9th that the option-only Trade Log never saw.
  const options = [trade('2026-10-01', -112), trade('2026-10-05', 49), trade('2026-10-06', 401), trade('2026-10-12', 171), trade('2026-10-13', -158), trade('2026-10-19', 73), trade('2026-10-21', 122), trade('2026-10-27', 114)];
  const meta = lot('META', '2026-10-09', 1761);

  it('puts a share sale on its close day and adds it to the day, the week and the month', () => {
    const cal = buildMonthCalendar(options, '2026-10', [meta]);
    const day = cal.weeks.flatMap(w => w.days).find(d => d.date === '2026-10-09')!;
    expect(day.pnl).toBe(1761);
    expect(day.stockPnl).toBe(1761);
    expect(day.trades).toBe(1);
    expect(cal.weeks[1].total).toBe(2211); // Oct 5 (49) + Oct 6 (401) + Oct 9 (1,761)
    expect(cal.stockPnl).toBe(1761);
    expect(cal.stockSales).toBe(1);
    expect(cal.total).toBe(buildMonthCalendar(options, '2026-10').total + 1761);
    expect(buildMonthCalendar(options, '2026-10').total).toBe(660);
  });

  it('a share loss reduces the day and the month, and options-only months are unchanged when no lots are passed', () => {
    const withLoss = buildMonthCalendar(options, '2026-10', [lot('GGLL', '2026-10-13', -40)]);
    const day = withLoss.weeks.flatMap(w => w.days).find(d => d.date === '2026-10-13')!;
    expect(day.pnl).toBe(-198);
    expect(withLoss.total).toBe(620);
    const plain = buildMonthCalendar(options, '2026-10');
    expect(plain.stockPnl).toBe(0);
    expect(plain.stockSales).toBe(0);
    expect(plain.weeks.flatMap(w => w.days).every(d => d.stockPnl == null)).toBe(true);
  });

  it('one symbol sold in several lots on a day counts as one sale; two symbols count as two', () => {
    const cal = buildMonthCalendar([], '2026-10', [lot('SOXL', '2026-10-09', 100), lot('SOXL', '2026-10-09', 50), lot('TQQQ', '2026-10-09', 25)]);
    const day = cal.weeks.flatMap(w => w.days).find(d => d.date === '2026-10-09')!;
    expect(day.pnl).toBe(175);
    expect(day.trades).toBe(2);
    expect(cal.stockSales).toBe(2);
  });

  it('a day with only a share sale still shows (pnl is not null), and other months are ignored', () => {
    const cal = buildMonthCalendar([], '2026-10', [lot('META', '2026-10-09', 300), lot('META', '2026-09-30', 9999), lot('META', '2026-11-02', 9999)]);
    expect(cal.total).toBe(300);
    expect(cal.trades).toBe(1);
  });

  it('pace includes share sales inside the trailing 30 days', () => {
    const p = buildPace([trade('2026-10-20', 100)], '2026-10-27', 40000, [lot('META', '2026-10-09', 1761), lot('META', '2026-09-01', 5000)]);
    expect(p.pnl).toBe(1861);
    expect(p.returnPct).toBe(4.65);
  });

  it('excluded and incomplete counts cover only the viewed month', () => {
    const noisy = [...options, trade('2026-09-14', 5, { excluded: true }), trade('2026-09-15', 6, { reconstructionStatus: 'INCOMPLETE' }), trade('2026-10-14', 7, { reconstructionStatus: 'INCOMPLETE' })];
    expect(buildMonthCalendar(noisy, '2026-10')).toMatchObject({ excludedByUser: 0, incomplete: 1 });
    expect(buildMonthCalendar(noisy, '2026-09')).toMatchObject({ excludedByUser: 1, incomplete: 1 });
  });
});

describe('buildMonthlyGoal', () => {
  it('computes the target from the baseline and flags the goal as achieved', () => {
    const g = buildMonthlyGoal({ realized: 2401, baseline: 45000, targetPct: 5, month: '2026-10', today: '2026-10-27' });
    expect(g.targetAmount).toBe(2250);
    expect(g.returnPct).toBe(5.34);
    expect(g.achieved).toBe(true);
    expect(g.dayOfMonth).toBe(27);
    expect(g.daysInMonth).toBe(31);
  });

  it('is not achieved below the target and reports progress', () => {
    const g = buildMonthlyGoal({ realized: 1125, baseline: 45000, targetPct: 5, month: '2026-10', today: '2026-10-27' });
    expect(g.achieved).toBe(false);
    expect(g.progressPct).toBe(50);
  });

  it('without a baseline shows no target amount and never claims the goal', () => {
    const g = buildMonthlyGoal({ realized: 9999, baseline: null, targetPct: 5, month: '2026-10', today: '2026-10-27' });
    expect(g.targetAmount).toBeNull();
    expect(g.returnPct).toBeNull();
    expect(g.achieved).toBe(false);
  });

  it('day of month: a past month is complete, a future month has no day yet', () => {
    expect(buildMonthlyGoal({ realized: 0, baseline: 1000, targetPct: 5, month: '2026-09', today: '2026-10-27' }).dayOfMonth).toBe(30);
    expect(buildMonthlyGoal({ realized: 0, baseline: 1000, targetPct: 5, month: '2026-11', today: '2026-10-27' }).dayOfMonth).toBeNull();
  });
});

describe('buildPace', () => {
  it('sums the trailing 30 days inclusive of today', () => {
    const trades = [trade('2026-09-27', 100), trade('2026-09-28', 200), trade('2026-10-27', 50), trade('2026-10-28', 999)];
    const p = buildPace(trades, '2026-10-27', 40000);
    expect(p.from).toBe('2026-09-28');
    expect(p.pnl).toBe(250); // Sep 27 is 30 days back and falls outside; Oct 28 is in the future
    expect(p.returnPct).toBe(0.63);
  });
});

describe('monthBaseline', () => {
  const history = [
    { date: '2026-09-29', netLiquidatingValue: 44000 }, { date: '2026-09-30', netLiquidatingValue: 45047 },
    { date: '2026-10-02', netLiquidatingValue: 45200 },
  ];
  it('uses the last stored day before the 1st', () => expect(monthBaseline(history, '2026-10')).toBe(45047));
  it('falls back to the first stored day inside the month', () => expect(monthBaseline(history.slice(2), '2026-10')).toBe(45200));
  it('is null when nothing usable is stored', () => expect(monthBaseline([], '2026-10')).toBeNull());
  it('ignores zero and missing values', () => expect(monthBaseline([{ date: '2026-09-30', netLiquidatingValue: 0 }], '2026-10')).toBeNull());
});

describe('formatting and month math', () => {
  it('formats cells like the reference: +$50, -$155, +$1.8k, +$2.3k', () => {
    expect(formatCellMoney(50)).toBe('+$50');
    expect(formatCellMoney(-155)).toBe('-$155');
    expect(formatCellMoney(1800.4)).toBe('+$1.8k');
    expect(formatCellMoney(2300)).toBe('+$2.3k');
  });
  it('formats headline figures', () => {
    expect(formatSignedMoney(2401)).toBe('+$2,401');
    expect(formatSignedPct(5.33, 2)).toBe('+5.33%');
    expect(formatSignedPct(-0.4)).toBe('-0.4%');
  });
  it('shifts months across year ends', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});
