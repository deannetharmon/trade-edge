// lib/__tests__/coveredCall.test.ts

import { describe, it, expect } from 'vitest';
import { expiryMetrics, shareLeg, type TradeLeg } from '@/lib/trademap/strategyLegs';
import { positionAt, DEFAULT_PRICING_PARAMS } from '@/lib/trademap/gridModel';
import { positionGreeksAt } from '@/lib/trademap/greeks';
import { cellDetail } from '@/lib/trademap/cellDetail';
import { chanceOfProfit } from '@/lib/trademap/pop';
import { legSpecs, STRATEGIES, defaultAnchorStrike } from '@/lib/trademap/strategies';

const EXP = '2026-12-18';
const call: TradeLeg = { right: 'C', side: 'short', strike: 50, expiration: EXP, quantity: 1, entryPrice: 1.2, iv: 0.4 };
const legs = [shareLeg(44.2, EXP), call];

describe('covered call model', () => {
  it('expiry economics: max loss = basis less credit, max profit at the strike, one breakeven', () => {
    const m = expiryMetrics(legs)!;
    expect(m.maxLoss).toBeCloseTo(4300, 6);
    expect(m.maxProfit).toBeCloseTo((50 - 44.2) * 100 + 120, 6);
    expect(m.maxProfitUnbounded).toBe(false);
    expect(m.breakevens).toHaveLength(1);
    expect(m.breakevens[0]).toBeCloseTo(43.0, 6);
  });
  it('P/L at expiration equals the payoff; shares move one for one before it', () => {
    expect(positionAt(legs, 55, EXP, DEFAULT_PRICING_PARAMS)!.pl).toBeCloseTo((50 - 44.2) * 100 + 120, 6);
    const a = positionAt([shareLeg(44.2, EXP)], 46, '2026-11-18', DEFAULT_PRICING_PARAMS)!.pl;
    expect(a).toBeCloseTo(180, 6);
  });
  it('greeks: shares add 100 delta, nothing else', () => {
    const g = positionGreeksAt(legs, 46, '2026-11-18', DEFAULT_PRICING_PARAMS)!;
    const callOnly = positionGreeksAt([call], 46, '2026-11-18', DEFAULT_PRICING_PARAMS)!;
    expect(g.delta).toBeCloseTo(callOnly.delta + 100, 9);
    expect(g.vega).toBeCloseTo(callOnly.vega, 9);
    expect(g.theta).toBeCloseTo(callOnly.theta, 9);
  });
  it('cell detail lists the shares leg with delta 1 and chance of profit works', () => {
    const d = cellDetail(legs, 46, '2026-11-18', '2026-11-18', DEFAULT_PRICING_PARAMS, 0.4)!;
    expect(d.legs[0]).toMatchObject({ right: 'S', delta: 1 });
    expect(d.chanceOfProfit).not.toBeNull();
    const pop = chanceOfProfit(legs, 46, '2026-11-18', 0.4, 0.04, 0)!;
    expect(pop).toBeGreaterThan(0.4);
    expect(pop).toBeLessThan(1);
  });
  it('strategy list and specs: one short call, anchor above the stock', () => {
    expect(STRATEGIES.some(s => s.id === 'cc' && !s.hasWidth)).toBe(true);
    const chain = { date: EXP, dte: 30, strikes: [45, 50, 55].map(k => ({ strike: k, call: `SOXL  261218C0000${k}000`, put: `SOXL  261218P0000${k}000` })) } as any;
    const specs = legSpecs('cc', chain, 50, 46, 1)!;
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ right: 'C', side: 'short', strike: 50 });
    expect(defaultAnchorStrike('cc', [40, 45, 50, 55], 46, null)).toBeGreaterThan(46);
  });
});
