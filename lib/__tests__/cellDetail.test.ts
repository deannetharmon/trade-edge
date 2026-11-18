// lib/__tests__/cellDetail.test.ts
//
// OPTMAP-0001 S4a (Alan, Quinn): the cell panel must agree with the grid and the summary it sits next to.

import { describe, it, expect } from 'vitest';
import { cellDetail } from '@/lib/trademap/cellDetail';
import { computeGrid, DEFAULT_PRICING_PARAMS } from '@/lib/trademap/gridModel';
import { chanceOfProfit } from '@/lib/trademap/pop';
import type { TradeLeg } from '@/lib/trademap/strategyLegs';

const exp = '2026-12-18';
const legs: TradeLeg[] = [
  { right: 'P', side: 'short', strike: 45, expiration: exp, quantity: 1, entryPrice: 1.9, iv: 1.2 },
  { right: 'P', side: 'long', strike: 40, expiration: exp, quantity: 1, entryPrice: 0.45, iv: 1.2 },
];
const P = DEFAULT_PRICING_PARAMS;

describe('cellDetail', () => {
  it('P/L and percent of premium equal the grid cell', () => {
    const d = cellDetail(legs, 45, '2026-12-11', '2026-11-17', P, 1.2)!;
    const g = computeGrid(legs, [45], ['2026-12-11'], P)!;
    expect(d.pl).toBeCloseTo(g.cells[0][0]!.pl, 8);
    expect(d.plPctOfPremium).toBeCloseTo((g.cells[0][0]!.pl / Math.abs(g.netDebit)) * 100, 8);
    expect(d.daysOut).toBe(24);
    expect(d.daysToExpiry).toBe(7);
  });
  it('chance of profit from today at the current price equals the summary chance of profit', () => {
    const d = cellDetail(legs, 46.76, '2026-11-17', '2026-11-17', P, 1.2)!;
    expect(d.chanceOfProfit).toBeCloseTo(chanceOfProfit(legs, 46.76, '2026-11-17', 1.2, P.riskFreeRate, P.dividendYield)!, 10);
  });
  it('chance of profit rises as the stock rises for a bull put spread', () => {
    const lo = cellDetail(legs, 42, '2026-12-04', '2026-11-17', P, 1.2)!.chanceOfProfit!;
    const hi = cellDetail(legs, 50, '2026-12-04', '2026-11-17', P, 1.2)!.chanceOfProfit!;
    expect(hi).toBeGreaterThan(lo);
  });
  it('at expiration there is no chance-of-profit number, only the outcome and the intrinsic delta step', () => {
    const d = cellDetail(legs, 43, exp, '2026-11-17', P, 1.2)!;
    expect(d.chanceOfProfit).toBeNull();
    expect(d.greeks).toEqual({ delta: -100 * -1 + 0, gamma: 0, theta: 0, vega: 0 });
  });
  it('lists each leg delta with its side', () => {
    const d = cellDetail(legs, 46, '2026-11-24', '2026-11-17', P, 1.2)!;
    expect(d.legs.map(l => [l.side, l.strike])).toEqual([['short', 45], ['long', 40]]);
    expect(d.legs[0].delta).toBeLessThan(0);
    expect(d.legs[0].delta).toBeLessThan(d.legs[1].delta); // the nearer strike is more negative
  });
  it('is null when a leg cannot be valued (date after expiration)', () => {
    expect(cellDetail(legs, 45, '2026-12-19', '2026-11-17', P, 1.2)).toBeNull();
  });
});
