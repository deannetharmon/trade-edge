// lib/portfolio-data/__tests__/balancePerformance.test.ts

import { describe, expect, it } from 'vitest';
import { closedDaysOnly, extractMoneyMovements, performanceSeries, todayNewYork, withLivePoint } from '../balancePerformance';

const tx = (o: Record<string, unknown>) => ({ 'transaction-type': 'Money Movement', 'transaction-sub-type': 'Withdrawal', 'net-value': '5000.0', 'net-value-effect': 'Debit', 'executed-at': '2026-09-29T15:00:00.000Z', ...o });

describe('BALANCE-CHART-0001', () => {
  it('money movements: withdrawals negative, deposits positive; interest, fees and trades are not movements', () => {
    const m = extractMoneyMovements([
      tx({}),
      tx({ 'transaction-sub-type': 'Deposit', 'net-value': '1000', 'net-value-effect': 'Credit', 'executed-at': '2026-08-01T15:00:00.000Z' }),
      tx({ 'transaction-sub-type': 'Credit Interest', 'net-value': '3.21', 'net-value-effect': 'Credit' }),
      tx({ 'transaction-type': 'Trade', 'transaction-sub-type': 'Sell to Open' }),
    ]);
    expect(m.map((x) => [x.date, x.amount])).toEqual([['2026-08-01', 1000], ['2026-09-29', -5000]]);
    expect(m[1].label).toContain('withdrawal');
  });

  it('performance: a $5k withdrawal does not show as a $5k loss', () => {
    const days = [
      { date: '2026-09-26', netLiquidatingValue: 50000 },
      { date: '2026-09-29', netLiquidatingValue: 45200 }, // withdrew 5,000, traded +200
      { date: '2026-10-05', netLiquidatingValue: 45500 },
    ];
    const perf = performanceSeries(days, extractMoneyMovements([tx({})]));
    expect(perf.map((d) => d.netLiquidatingValue)).toEqual([50000, 50200, 50500]);
  });

  it('movements before the first plotted day do not shift the line', () => {
    const perf = performanceSeries([{ date: '2026-10-01', netLiquidatingValue: 45000 }, { date: '2026-10-02', netLiquidatingValue: 45100 }], extractMoneyMovements([tx({})]));
    expect(perf.map((d) => d.netLiquidatingValue)).toEqual([45000, 45100]);
  });

  it('only completed, non-zero days are stored; the live balance is the last point and replaces a stored "today"', () => {
    const days = [{ date: '2026-10-05', netLiquidatingValue: 44000 }, { date: '2026-10-06', netLiquidatingValue: 41000 }, { date: '2026-10-04', netLiquidatingValue: 0 }];
    expect(closedDaysOnly(days, '2026-10-06').map((d) => d.date)).toEqual(['2026-10-05']);
    expect(withLivePoint(days.slice(0, 2), '2026-10-06', 44713.82)).toEqual([{ date: '2026-10-05', netLiquidatingValue: 44000 }, { date: '2026-10-06', netLiquidatingValue: 44713.82 }]);
  });

  it('New York date: 00:30 UTC is still the previous New York day', () => {
    expect(todayNewYork(Date.parse('2026-10-06T00:30:00Z'))).toBe('2026-10-05');
  });
});
