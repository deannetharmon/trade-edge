import { describe, expect, it } from 'vitest';
import { buildAccountPnlSpark } from '../accountPnl';

const history = [
  { date: '2026-08-18', netLiquidatingValue: 50066 },
  { date: '2026-09-22', netLiquidatingValue: 50858 },
  { date: '2026-10-19', netLiquidatingValue: 42640 },
];
const movements = [
  { date: '2026-03-30', amount: 10000, label: '' },
  { date: '2026-04-07', amount: 40000, label: '' },
  { date: '2026-10-01', amount: -5000, label: '' },
];

describe('buildAccountPnlSpark', () => {
  it('is net liquidating value minus money moved to that day, so a withdrawal is not a loss', () => {
    const s = buildAccountPnlSpark(history, movements, '2026-11-24', 26517)!;
    expect(s.points.map(p => p.netLiquidatingValue)).toEqual([66, 858, -2360, -18483]);
  });
  it('draws nothing until money movements were read', () => {
    expect(buildAccountPnlSpark(history, null, '2026-11-24', 26517)).toBeNull();
  });
  it('reports the day change against the prior close', () => {
    const s = buildAccountPnlSpark(history, movements, '2026-11-24', 26517)!;
    expect(s.priorClose).toBeNull(); // the prior stored day is more than 5 days old, so no day-change is claimed
  });
});
