// lib/portfolio-data/__tests__/balanceChange.test.ts

import { describe, expect, it } from 'vitest';
import { balanceChangeRows } from '../balanceChange';

const day = (date: string, nl: number, cash: number, opt: number) => ({ date, netLiquidatingValue: nl, cashBalance: cash, netOptionsValue: opt });

describe('BALANCE-CHANGE-0001', () => {
  const history = [day('2026-09-28', 50000, 48000, -1000), day('2026-09-29', 45200, 43100, -1100), day('2026-10-09', 44500, 42000, -500)];
  const moves = [{ date: '2026-09-29', amount: -5000, label: '−$5,000 withdrawal' }];

  it('splits each interval into cash, options and other, and takes money moved out of trading', () => {
    const rows = balanceChangeRows(history, null, '2026-10-16', moves);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ fromDate: '2026-09-28', toDate: '2026-09-29', netLiq: -4800, cash: -4900, options: -100, other: 200, moved: -5000, trading: 200, live: false });
  });

  it('adds the live interval from the last stored day and reports how old that day is', () => {
    const rows = balanceChangeRows(history, { netLiquidatingValue: 41779.12, cashBalance: 41321.48, netOptionsValue: -2149 }, '2026-10-16', moves);
    const last = rows[rows.length - 1];
    expect(last).toMatchObject({ fromDate: '2026-10-09', toDate: '2026-10-16', gapDays: 7, live: true });
    expect(last.netLiq).toBeCloseTo(-2720.88, 2);
    expect(last.options).toBeCloseTo(-1649, 2);
    expect(last.moved).toBe(0);
    expect(last.trading).toBeCloseTo(-2720.88, 2);
  });

  it('ignores a stored entry for today, keeps only the most recent rows, and handles too little history', () => {
    expect(balanceChangeRows([day('2026-10-16', 1, 1, 0)], null, '2026-10-16', [])).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, '0')}`, 1000 + i, 1000, 0));
    expect(balanceChangeRows(many, null, '2026-10-16', [], 5)).toHaveLength(5);
  });
});
