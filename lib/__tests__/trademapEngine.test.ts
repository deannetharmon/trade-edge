// lib/__tests__/trademapEngine.test.ts
//
// OPTMAP-0001 S1: golden fixtures for the Trade Map pricing engine (Alan).
// Reference values were produced by an independent Python implementation
// (math.erfc based) and are compared here to 1e-8; the OptionStrat screenshot
// rows are a cross-check, not a golden, and use a documented tolerance.

import { describe, expect, it } from 'vitest';
import { bsPrice, daysBetween, normCdf } from '../trademap/pricing';
import { expiryMetrics, netDebit, type TradeLeg } from '../trademap/strategyLegs';
import {
  DEFAULT_PRICING_PARAMS,
  buildDateAxis,
  buildPriceAxis,
  computeGrid,
  positionAt,
} from '../trademap/gridModel';

const TOL = 1e-8;

const leg = (over: Partial<TradeLeg>): TradeLeg => ({
  right: 'C', side: 'long', strike: 100, expiration: '2026-12-18', quantity: 1, entryPrice: 1, iv: 0.5, ...over,
});

describe('OPTMAP-0001 S1: normCdf', () => {
  const table: Array<[number, number]> = [
    [0, 0.5],
    [0.1, 0.539827837277029],
    [0.5, 0.6914624612740131],
    [1, 0.8413447460685429],
    [1.96, 0.9750021048517795],
    [-3, 0.0013498980316300957],
    [-8, 6.220960574271819e-16],
  ];
  it.each(table)('N(%s)', (x, expected) => {
    expect(Math.abs(normCdf(x) - expected)).toBeLessThan(1e-12);
  });
  it('is symmetric and bounded', () => {
    expect(normCdf(1.3) + normCdf(-1.3)).toBeCloseTo(1, 14);
    expect(normCdf(50)).toBe(1);
    expect(normCdf(-50)).toBe(0);
  });
});

describe('OPTMAP-0001 S1: bsPrice golden values', () => {
  it('matches the independent reference', () => {
    expect(Math.abs(bsPrice('C', 100, 100, 0.5, 0.04, 0, 0.3)! - 9.390440479909117)).toBeLessThan(TOL);
    expect(Math.abs(bsPrice('P', 100, 100, 0.5, 0.04, 0, 0.3)! - 7.410307810584641)).toBeLessThan(TOL);
    expect(Math.abs(bsPrice('P', 50, 55, 1, 0.05, 0.02, 0.4)! - 9.79038534459471)).toBeLessThan(TOL);
    expect(Math.abs(bsPrice('C', 50, 55, 1, 0.05, 0.02, 0.4)! - 6.482700662393203)).toBeLessThan(TOL);
    expect(Math.abs(bsPrice('C', 30, 20, 0.25, 0.04, 0, 0.25)! - 10.199356954832695)).toBeLessThan(TOL);
    expect(Math.abs(bsPrice('P', 30, 20, 0.25, 0.04, 0, 0.25)! - 0.0003536298160570217)).toBeLessThan(TOL);
  });
  it('put-call parity holds with a dividend yield', () => {
    for (const [s, k, t, r, q, v] of [[100, 100, 0.5, 0.04, 0, 0.3], [50, 55, 1, 0.05, 0.02, 0.4], [210, 180, 0.08, 0.045, 0.01, 1.2]]) {
      const c = bsPrice('C', s, k, t, r, q, v)!;
      const p = bsPrice('P', s, k, t, r, q, v)!;
      expect(Math.abs(c - p - (s * Math.exp(-q * t) - k * Math.exp(-r * t)))).toBeLessThan(1e-10);
    }
  });
  it('at expiry (t = 0) prices at intrinsic value', () => {
    expect(bsPrice('C', 105, 100, 0, 0.04, 0, 0.5)).toBe(5);
    expect(bsPrice('P', 105, 100, 0, 0.04, 0, 0.5)).toBe(0);
    expect(bsPrice('P', 90, 100, 0, 0.04, 0, 0.5)).toBe(10);
  });
  it('zero volatility prices at the discounted-forward intrinsic value', () => {
    const t = 0.5;
    const fwd = 100 - 95 * Math.exp(-0.04 * t);
    expect(bsPrice('C', 100, 95, t, 0.04, 0, 0)).toBeCloseTo(fwd, 12);
    expect(bsPrice('P', 100, 95, t, 0.04, 0, 0)).toBe(0);
  });
  it('rises with volatility', () => {
    for (const right of ['C', 'P'] as const) {
      expect(bsPrice(right, 100, 100, 0.25, 0.04, 0, 0.6)!).toBeGreaterThan(bsPrice(right, 100, 100, 0.25, 0.04, 0, 0.3)!);
    }
  });
  it('fails closed on invalid input', () => {
    expect(bsPrice('C', 0, 100, 0.5, 0.04, 0, 0.3)).toBeNull();
    expect(bsPrice('C', 100, -1, 0.5, 0.04, 0, 0.3)).toBeNull();
    expect(bsPrice('C', 100, 100, -0.1, 0.04, 0, 0.3)).toBeNull();
    expect(bsPrice('C', 100, 100, 0.5, 0.04, 0, -0.3)).toBeNull();
    expect(bsPrice('C', NaN, 100, 0.5, 0.04, 0, 0.3)).toBeNull();
    expect(bsPrice('X' as never, 100, 100, 0.5, 0.04, 0, 0.3)).toBeNull();
  });
});

describe('OPTMAP-0001 S1: dates', () => {
  it('counts calendar days and rejects invalid dates', () => {
    expect(daysBetween('2026-11-17', '2026-12-18')).toBe(31);
    expect(daysBetween('2026-12-18', '2027-09-17')).toBe(273);
    expect(daysBetween('2026-02-31', '2026-03-01')).toBeNull();
    expect(daysBetween('nope', '2026-03-01')).toBeNull();
  });
});

describe('OPTMAP-0001 S1: expiration-day metrics', () => {
  it('SOXL long 47P (the OptionStrat screenshot): debit, max loss, max profit, breakeven', () => {
    const legs = [leg({ right: 'P', strike: 47, entryPrice: 9.625, iv: 1.79 })];
    expect(netDebit(legs)).toBeCloseTo(962.5, 9);
    const m = expiryMetrics(legs)!;
    expect(m.maxLoss).toBeCloseTo(962.5, 9);
    expect(m.maxProfit).toBeCloseTo(3737.5, 9);
    expect(m.maxProfitUnbounded).toBe(false);
    expect(m.breakevens).toHaveLength(1);
    expect(m.breakevens[0]).toBeCloseTo(37.375, 9);
  });
  it('bull put spread: credit 1.50 on 50/45', () => {
    const m = expiryMetrics([
      leg({ right: 'P', side: 'short', strike: 50, entryPrice: 2.5 }),
      leg({ right: 'P', side: 'long', strike: 45, entryPrice: 1.0 }),
    ])!;
    expect(m.netDebit).toBeCloseTo(-150, 9);
    expect(m.maxProfit).toBeCloseTo(150, 9);
    expect(m.maxLoss).toBeCloseTo(350, 9);
    expect(m.breakevens).toEqual([48.5]);
  });
  it('iron condor: credit 2.00 on 40/45/55/60', () => {
    const m = expiryMetrics([
      leg({ right: 'P', side: 'short', strike: 45, entryPrice: 1.5 }),
      leg({ right: 'P', side: 'long', strike: 40, entryPrice: 0.5 }),
      leg({ right: 'C', side: 'short', strike: 55, entryPrice: 1.3 }),
      leg({ right: 'C', side: 'long', strike: 60, entryPrice: 0.3 }),
    ])!;
    expect(m.netDebit).toBeCloseTo(-200, 9);
    expect(m.maxProfit).toBeCloseTo(200, 9);
    expect(m.maxLoss).toBeCloseTo(300, 9);
    expect(m.breakevens).toHaveLength(2);
    expect(m.breakevens[0]).toBeCloseTo(43, 9);
    expect(m.breakevens[1]).toBeCloseTo(57, 9);
  });
  it('long call has unbounded profit; short call has unbounded loss', () => {
    const lc = expiryMetrics([leg({ strike: 100, entryPrice: 5 })])!;
    expect(lc.maxProfit).toBeNull();
    expect(lc.maxProfitUnbounded).toBe(true);
    expect(lc.maxLoss).toBeCloseTo(500, 9);
    expect(lc.breakevens[0]).toBeCloseTo(105, 9);
    const sc = expiryMetrics([leg({ side: 'short', strike: 100, entryPrice: 5 })])!;
    expect(sc.maxLoss).toBeNull();
    expect(sc.maxLossUnbounded).toBe(true);
    expect(sc.maxProfit).toBeCloseTo(500, 9);
  });
  it('scales with quantity', () => {
    const m = expiryMetrics([leg({ right: 'P', strike: 47, entryPrice: 9.625, quantity: 3 })])!;
    expect(m.maxLoss).toBeCloseTo(2887.5, 9);
  });
  it('multi-expiration strategies and invalid legs return null', () => {
    expect(expiryMetrics([leg({}), leg({ expiration: '2027-01-15' })])).toBeNull();
    expect(expiryMetrics([])).toBeNull();
    expect(expiryMetrics([leg({ quantity: 0 })])).toBeNull();
    expect(expiryMetrics([leg({ expiration: '2026-13-01' })])).toBeNull();
    expect(netDebit([leg({ entryPrice: -1 })])).toBeNull();
  });
});

describe('OPTMAP-0001 S1: P/L grid', () => {
  const soxl = [leg({ right: 'P', strike: 47, entryPrice: 9.625, iv: 1.79 })];

  it('SOXL long 47P matches the independent reference today (31 DTE, r = 4%, IV 179%)', () => {
    expect(Math.abs(positionAt(soxl, 45, '2026-11-17', DEFAULT_PRICING_PARAMS)!.pl - 77.18675921334359)).toBeLessThan(1e-6);
    expect(Math.abs(positionAt(soxl, 57, '2026-11-17', DEFAULT_PRICING_PARAMS)!.pl - -329.2814328892023)).toBeLessThan(1e-6);
  });

  it('expiration column equals the payoff curve exactly', () => {
    const at = (s: number) => positionAt(soxl, s, '2026-12-18', DEFAULT_PRICING_PARAMS)!.pl;
    expect(at(45)).toBeCloseTo(-762.5, 9);
    expect(at(50)).toBeCloseTo(-962.5, 9);
    expect(at(30)).toBeCloseTo(737.5, 9);
  });

  it('cross-check against OptionStrat rows near the money (tolerance $12/contract)', () => {
    // OptionStrat, SOXL long 47P, Dec 18, today's column. Deep in-the-money rows (stock at or below 37)
    // are excluded on purpose: OptionStrat prices early exercise, Black-Scholes does not, and the gap
    // grows to about $37 at a $22 stock. That is the American-exercise caveat in Alan's spec.
    const shot: Array<[number, number]> = [[72, -623], [57, -334], [50, -122], [47, -12], [45, 70], [42, 205], [40, 303]];
    for (const [price, plShown] of shot) {
      expect(Math.abs(positionAt(soxl, price, '2026-11-17', DEFAULT_PRICING_PARAMS)!.pl - plShown)).toBeLessThanOrEqual(12);
    }
  });

  it('raising IV raises a long option and lowers a short one', () => {
    const up = { ...DEFAULT_PRICING_PARAMS, ivMultiplier: 2 };
    expect(positionAt(soxl, 47, '2026-11-17', up)!.pl).toBeGreaterThan(positionAt(soxl, 47, '2026-11-17', DEFAULT_PRICING_PARAMS)!.pl);
    const short = [leg({ right: 'P', side: 'short', strike: 47, entryPrice: 9.625, iv: 1.79 })];
    expect(positionAt(short, 47, '2026-11-17', up)!.pl).toBeLessThan(positionAt(short, 47, '2026-11-17', DEFAULT_PRICING_PARAMS)!.pl);
  });

  it('PMCC shape at the short expiration (illustrative short call, not a real position)', () => {
    // Long UBER 67.50C Sep 2027 (cost 21.30, IV 45%) and short 75C Dec 18 2026 (credit 0.90).
    const pmcc = [
      leg({ strike: 67.5, expiration: '2027-09-17', entryPrice: 21.3, iv: 0.45 }),
      leg({ side: 'short', strike: 75, expiration: '2026-12-18', entryPrice: 0.9, iv: 0.42 }),
    ];
    const grid = computeGrid(pmcc, [60, 75, 90], ['2026-12-18'], DEFAULT_PRICING_PARAMS)!;
    expect(Math.abs(grid.cells[0][0]!.pl - -1323.0598731968998)).toBeLessThan(1e-6);
    expect(Math.abs(grid.cells[1][0]!.pl - -417.69373250169957)).toBeLessThan(1e-6);
    expect(Math.abs(grid.cells[2][0]!.pl - -745.7991421378689)).toBeLessThan(1e-6);
    expect(grid.earliestExpiration).toBe('2026-12-18');
    expect(grid.netDebit).toBeCloseTo(2040, 9);
  });

  it('dates after the earliest expiration, and invalid inputs, give null cells or no grid', () => {
    const pmcc = [
      leg({ strike: 67.5, expiration: '2027-09-17', entryPrice: 21.3, iv: 0.45 }),
      leg({ side: 'short', strike: 75, expiration: '2026-12-18', entryPrice: 0.9, iv: 0.42 }),
    ];
    expect(computeGrid(pmcc, [70], ['2026-12-21'], DEFAULT_PRICING_PARAMS)!.cells[0][0]).toBeNull();
    expect(computeGrid(soxl, [45], ['2026-11-17'], { ...DEFAULT_PRICING_PARAMS, ivMultiplier: 0 })).toBeNull();
    expect(computeGrid([], [45], ['2026-11-17'], DEFAULT_PRICING_PARAMS)).toBeNull();
    expect(positionAt(soxl, -5, '2026-11-17', DEFAULT_PRICING_PARAMS)).toBeNull();
  });
});

describe('OPTMAP-0001 S1: axes', () => {
  it('price axis is highest first, evenly spread, rounded to cents', () => {
    expect(buildPriceAxis(100, 0.2, 5)).toEqual([120, 110, 100, 90, 80]);
    expect(buildPriceAxis(0, 0.2, 5)).toBeNull();
    expect(buildPriceAxis(100, 1, 5)).toBeNull();
    expect(buildPriceAxis(100, 0.2, 1)).toBeNull();
  });
  it('date axis skips weekends and always ends on the end date', () => {
    expect(buildDateAxis('2026-11-17', '2026-11-20', 10)).toEqual(['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
    expect(buildDateAxis('2026-11-20', '2026-11-24', 10)).toEqual(['2026-11-20', '2026-11-23', '2026-11-24']);
    expect(buildDateAxis('2026-11-17', '2026-11-17', 10)).toEqual(['2026-11-17']);
  });
  it('thins long axes but keeps the first and last dates', () => {
    const axis = buildDateAxis('2026-11-17', '2026-12-18', 5)!;
    expect(axis).toHaveLength(5);
    expect(axis[0]).toBe('2026-11-17');
    expect(axis[axis.length - 1]).toBe('2026-12-18');
  });
  it('rejects a reversed range', () => {
    expect(buildDateAxis('2026-12-18', '2026-11-17', 5)).toBeNull();
    expect(buildDateAxis('2026-11-17', '2026-12-18', 1)).toBeNull();
  });
});

import { buildDisplayPriceAxis, buildPriceAxis as buildPriceAxisRaw } from '../trademap/gridModel';

describe('OPTMAP-0001 S2h: display price axis', () => {
  it('rows $1 or more apart sit on whole dollars, descending and unique', () => {
    const axis = buildDisplayPriceAxis(46.76, 0.52, 11)!;
    expect(axis.every(p => Number.isInteger(p))).toBe(true);
    for (let i = 1; i < axis.length; i += 1) expect(axis[i]).toBeLessThan(axis[i - 1]);
    expect(axis[0]).toBe(71);
    expect(axis[axis.length - 1]).toBe(22);
  });
  it('tight rows keep cents, so labels never collide', () => {
    const raw = buildPriceAxisRaw(16.01, 0.2, 11)!;
    expect(buildDisplayPriceAxis(16.01, 0.2, 11)).toEqual(raw);
  });
  it('rows about $1.20 apart now round too (Dean 2026-11-17), still unique and descending', () => {
    const axis = buildDisplayPriceAxis(51.62, 0.12, 11)!;
    expect(axis.every(p => Number.isInteger(p))).toBe(true);
    for (let i = 1; i < axis.length; i += 1) expect(axis[i]).toBeLessThan(axis[i - 1]);
  });
  it('rows under $1 apart keep cents', () => {
    const raw = buildPriceAxisRaw(51.62, 0.09, 11)!;
    expect(buildDisplayPriceAxis(51.62, 0.09, 11)).toEqual(raw);
  });
  it('fails closed like the raw axis', () => {
    expect(buildDisplayPriceAxis(0, 0.2, 11)).toBeNull();
    expect(buildDisplayPriceAxis(100, 1.5, 11)).toBeNull();
  });
});
