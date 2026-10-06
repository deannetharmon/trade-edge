// lib/tradeLog/__tests__/coachingInput.test.ts

import { describe, expect, it } from 'vitest';
import type { ClosedTrade } from '../types';
import { buildPerformanceReport } from '../performanceMetrics';
import { breakEvenWinRate, buildCoachingInput, comparisonTier, evidenceTier, netLiqAtOpen, type BalancePoint } from '../coachingInput';
import { checkCoachingNumbers } from '../coachingNumberCheck';
import dean from './fixtures/dean-trade-log-2026-10-06.json';

const DEAN = dean as unknown as ClosedTrade[];
const OK_PROFIT = { status: 'OK' as const, startDate: '2026-04-28', endDate: '2026-10-05', startValue: 42000, endValue: 44980, netMoved: -5000, profit: 7980 };

function input(trades: ClosedTrade[], history: BalancePoint[] = [], overrides: string[] = []) {
  return buildCoachingInput({ report: buildPerformanceReport(trades), from: '2026-04-29', to: '2026-10-05', label: 'Apr 29 – Oct 5', accountProfit: OK_PROFIT, balanceHistory: history, sizeOverrides: new Set(overrides) });
}

let n = 0;
const t = (o: Partial<ClosedTrade>): ClosedTrade => ({
  id: `t${n++}`, symbol: 'SPY', strategy: 'BPS', openDate: '2026-05-01', closeDate: '2026-05-10', openTime: '10:30', openDow: 1, expiry: '2026-06-18',
  holdDays: 9, strikes: '450P/445P', creditReceived: 100, closePrice: 50, pnl: 50, pnlPct: 50, outcome: 'WIN', quantity: 2, fees: 0,
  dteAtClose: 39, dteAtEntry: 48, exitType: 'TARGET_HIT', reconstructionStatus: 'COMPLETE', closureMechanism: 'CLOSED',
  openedQuantity: 1, closedQuantity: 1, remainingQuantity: 0, sourceTransactionIds: [], ...o,
});

describe('PERF-AI-0001 coaching input: golden fixture (Dean, 4/29–10/5)', () => {
  const ci = input(DEAN);
  it('same totals as the Performance tab', () => {
    expect(ci.counts.included).toBe(66);
    expect(ci.counts.incomplete).toBe(1);
    expect(ci.headline.pnl).toBeCloseTo(2449.69, 2);
  });
  it("Ian's rule findings reproduce (independently cross-checked)", () => {
    expect(ci.habits.beyondStop.trades).toBe(5);
    expect(ci.habits.beyondStop.pnl).toBeCloseTo(-1637.19, 2);
    expect(ci.habits.beyondStop.savedClosingAtStop).toBeCloseTo(402, 2);
    expect(ci.habits.beyondStop.tier).toBe('RULE_BREAK');
    expect(ci.habits.openedInside21Dte.trades).toBe(11);
    expect(ci.habits.openedInside21Dte.savedBySkipping).toBeCloseTo(614.54, 2);
    expect(ci.habits.creditToWidth.atOrAbove).toEqual({ trades: 9, pnl: -981.61 });
    expect(ci.habits.creditToWidth.below).toEqual({ trades: 43, pnl: 425.9 });
    expect(ci.habits.creditToWidth.tier).toBe('EARLY_SIGNAL'); // 9 vs 43: the smaller group decides
    expect(ci.habits.target.atTarget.trades).toBe(22);
    expect(ci.habits.target.early.trades).toBe(17);
    expect(ci.habits.insideStop.trades).toBe(22);
  });
  it('trend by month sums to the habit count', () => {
    const sum = Object.values(ci.habits.openedInside21Dte.byMonth).reduce((a, b) => a + b, 0);
    expect(sum).toBe(11);
  });
  it('a real answer quoting the input passes the number check; an invented figure fails', () => {
    expect(checkCoachingNumbers('5 trades lost −$1,637 past the stop; closing at the stop saves $402.', ci).ok).toBe(true);
    // Small counts (1-20) almost always appear somewhere in the input, so counts are a weak check; dollars are the strong one.
    const bad = checkCoachingNumbers('137 trades lost $812 past the stop.', ci);
    expect(bad.ok).toBe(false);
    expect(bad.unverified).toEqual(expect.arrayContaining(['$812', '137 trades']));
  });
});

describe('PERF-AI-0001 evidence tiers and break-even', () => {
  it('tiers: 10 finding, 5-9 early, <5 not enough; a breach is a rule break at any count', () => {
    expect(evidenceTier(10)).toBe('FINDING');
    expect(evidenceTier(9)).toBe('EARLY_SIGNAL');
    expect(evidenceTier(5)).toBe('EARLY_SIGNAL');
    expect(evidenceTier(4)).toBe('NOT_ENOUGH_DATA');
    expect(evidenceTier(1, true)).toBe('RULE_BREAK');
    expect(evidenceTier(0, true)).toBe('NOT_ENOUGH_DATA');
    expect(comparisonTier(10, 43)).toBe('FINDING');
    expect(comparisonTier(9, 43)).toBe('EARLY_SIGNAL');
  });
  it('break-even win rate = avg loss / (avg win + avg loss)', () => {
    const s = buildPerformanceReport([t({ pnl: 100 }), t({ pnl: -350, outcome: 'LOSS' })]).headline;
    expect(breakEvenWinRate(s)).toBeCloseTo(77.78, 2);
  });
});

describe('PERF-AI-0001 position size (25% of net liq at open, override, fail closed)', () => {
  const hist: BalancePoint[] = [{ date: '2026-04-30', netLiquidatingValue: 40000 }];
  // CSP collateral = strike x 100 x contracts
  const csp = (strike: number, id: string) => t({ id, strategy: 'CSP', strikes: `${strike}P`, openDate: '2026-05-01' });
  it('24.9% and 25.0% are within the rule; 25.1% is a breach', () => {
    const ci = input([csp(99.6, 'a'), csp(100, 'b'), csp(100.4, 'c')], hist);
    expect(ci.habits.positionSize.oversize.map(o => o.id)).toEqual(['c']);
    expect(ci.habits.positionSize.oversize[0].pct).toBeCloseTo(25.1, 2);
    expect(ci.habits.positionSize.tier).toBe('RULE_BREAK');
  });
  it('an overridden trade is not counted', () => {
    const ci = input([csp(100.4, 'c')], hist, ['c']);
    expect(ci.habits.positionSize.trades).toBe(0);
    expect(ci.habits.positionSize.overridden).toBe(1);
  });
  it('no balance within 5 days of the open: not checked, never estimated', () => {
    expect(netLiqAtOpen(hist, '2026-05-06')).toBeNull();
    const ci = input([t({ id: 'z', strategy: 'CSP', strikes: '200P', openDate: '2026-06-01' })], hist);
    expect(ci.habits.positionSize.notChecked).toBe(1);
    expect(ci.habits.positionSize.trades).toBe(0);
  });
});

describe('PERF-AI-0001 other habits', () => {
  it('re-entry within 2 days of a losing close on the same ticker', () => {
    const ci = input([
      t({ id: 'l', symbol: 'MRNA', closeDate: '2026-06-10', pnl: -200, outcome: 'LOSS' }),
      t({ id: 'r', symbol: 'MRNA', openDate: '2026-06-12', closeDate: '2026-06-20', pnl: -100, outcome: 'LOSS' }),
      t({ id: 'x', symbol: 'MRNA', openDate: '2026-06-14', closeDate: '2026-06-25', pnl: 30 }),
    ]);
    expect(ci.habits.reentryAfterLoss.trades).toBe(1);
    expect(ci.habits.reentryAfterLoss.savedBySkipping).toBe(100);
  });
  it('first 30 minutes is never more than an early signal', () => {
    const many = Array.from({ length: 12 }, () => t({ openTime: '09:45' }));
    expect(input(many).habits.firstThirtyMinutes.tier).toBe('EARLY_SIGNAL');
  });
  it('trade lines are capped at 400 with a flag', () => {
    const many = Array.from({ length: 405 }, () => t({}));
    const ci = input(many);
    expect(ci.tradeLines).toHaveLength(400);
    expect(ci.counts.tradeLinesCapped).toBe(true);
  });
});

describe('PERF-AI-0001 number checker', () => {
  const ci = input([t({ pnl: 1637.19 }), t({ pnl: -50, outcome: 'LOSS' })]);
  it('allows ±$1 rounding and k-notation to the nearest $100', () => {
    expect(checkCoachingNumbers('Made $1,637 and $1.6k.', ci).ok).toBe(true);
  });
  it('percentages are not treated as dollars', () => {
    expect(checkCoachingNumbers('Win rate 50%.', ci).ok).toBe(true);
  });
  it('dates and strikes on trade lines do not verify an invented dollar figure', () => {
    expect(checkCoachingNumbers('You lost $445 here.', ci).ok).toBe(false);
  });
});
