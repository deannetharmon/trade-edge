// lib/__tests__/greeks.test.ts
//
// OPTMAP-0001 S4a (Alan): Greeks are checked against finite differences of the grid's own bsPrice, so the panel cannot
// drift from the grid. Plus put-call relations and known values.

import { describe, it, expect } from 'vitest';
import { bsGreeks, positionGreeksAt } from '@/lib/trademap/greeks';
import { bsPrice } from '@/lib/trademap/pricing';
import { DEFAULT_PRICING_PARAMS } from '@/lib/trademap/gridModel';
import type { TradeLeg } from '@/lib/trademap/strategyLegs';

const S = 100, K = 100, T = 0.5, R = 0.04, Q = 0.01, SIG = 0.3;
const P = (right: 'C' | 'P', s = S, t = T, sig = SIG) => bsPrice(right, s, K, t, R, Q, sig)!;

describe('bsGreeks vs finite differences of bsPrice', () => {
  for (const right of ['C', 'P'] as const) {
    const g = bsGreeks(right, S, K, T, R, Q, SIG)!;
    it(`${right}: delta`, () => { const h = 0.01; expect(g.delta).toBeCloseTo((P(right, S + h) - P(right, S - h)) / (2 * h), 6); });
    it(`${right}: gamma`, () => { const h = 0.05; expect(g.gamma).toBeCloseTo((P(right, S + h) - 2 * P(right) + P(right, S - h)) / (h * h), 5); });
    it(`${right}: vega per point`, () => { const h = 0.0001; expect(g.vega).toBeCloseTo(((P(right, S, T, SIG + h) - P(right, S, T, SIG - h)) / (2 * h)) / 100, 6); });
    it(`${right}: theta per calendar day`, () => { const h = 1 / 365; expect(g.theta).toBeCloseTo((P(right, S, T - h) - P(right, S, T + h)) / (2 * h) / 365, 5); });
  }
});

describe('bsGreeks relations and edges', () => {
  it('call delta minus put delta = e^(-qT); gamma and vega equal for call and put', () => {
    const c = bsGreeks('C', S, K, T, R, Q, SIG)!, p = bsGreeks('P', S, K, T, R, Q, SIG)!;
    expect(c.delta - p.delta).toBeCloseTo(Math.exp(-Q * T), 10);
    expect(c.gamma).toBeCloseTo(p.gamma, 12);
    expect(c.vega).toBeCloseTo(p.vega, 12);
  });
  it('known value: ATM call, no rate/dividend, sigma 20%, T=1 -> delta 0.5398, vega 0.3970 per point', () => {
    const g = bsGreeks('C', 100, 100, 1, 0, 0, 0.2)!;
    expect(g.delta).toBeCloseTo(0.5398, 4);
    expect(g.vega).toBeCloseTo(0.39695, 4);
  });
  it('at expiry only the intrinsic delta step remains', () => {
    expect(bsGreeks('P', 90, 100, 0, R, Q, SIG)).toEqual({ delta: -1, gamma: 0, theta: 0, vega: 0 });
    expect(bsGreeks('P', 110, 100, 0, R, Q, SIG)).toEqual({ delta: 0, gamma: 0, theta: 0, vega: 0 });
  });
  it('fails closed on bad input', () => {
    expect(bsGreeks('C', -1, K, T, R, Q, SIG)).toBeNull();
    expect(bsGreeks('C', S, K, -1, R, Q, SIG)).toBeNull();
    expect(bsGreeks('C', NaN, K, T, R, Q, SIG)).toBeNull();
  });
});

describe('positionGreeksAt', () => {
  const exp = '2026-12-18';
  const legs: TradeLeg[] = [
    { right: 'P', side: 'short', strike: 100, expiration: exp, quantity: 2, entryPrice: 3, iv: 0.3 },
    { right: 'P', side: 'long', strike: 95, expiration: exp, quantity: 2, entryPrice: 1.5, iv: 0.3 },
  ];
  it('a bull put spread has positive delta and negative vega (short the nearer strike)', () => {
    const g = positionGreeksAt(legs, 100, '2026-11-17', DEFAULT_PRICING_PARAMS)!;
    expect(g.delta).toBeGreaterThan(0);
    expect(g.vega).toBeLessThan(0);
  });
  it('sums legs by side and contracts x 100', () => {
    const one = bsGreeks('P', 100, 100, 31 / 365, 0.04, 0, 0.3)!;
    const two = bsGreeks('P', 100, 95, 31 / 365, 0.04, 0, 0.3)!;
    const g = positionGreeksAt(legs, 100, '2026-11-17', DEFAULT_PRICING_PARAMS)!;
    expect(g.delta).toBeCloseTo(-2 * 100 * one.delta + 2 * 100 * two.delta, 8);
  });
  it('the IV multiplier moves the Greeks the way it moves the grid', () => {
    const a = positionGreeksAt(legs, 100, '2026-11-17', DEFAULT_PRICING_PARAMS)!;
    const b = positionGreeksAt(legs, 100, '2026-11-17', { ...DEFAULT_PRICING_PARAMS, ivMultiplier: 1.5 })!;
    expect(b.vega).not.toBeCloseTo(a.vega, 4);
  });
  it('a date after expiration returns null', () => {
    expect(positionGreeksAt(legs, 100, '2026-12-19', DEFAULT_PRICING_PARAMS)).toBeNull();
  });
});
