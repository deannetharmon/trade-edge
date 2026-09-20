// lib/scans/__tests__/pmccStartPrice.test.ts
//
// LEAPS-PMCC-START-0001. Reference values come from the Black-Scholes definition, not from the implementation:
// the round-trip test recomputes a call's delta at the returned start price and must land on the target delta.

import { describe, expect, it } from 'vitest';
import { computePmccStartPrice, normalInv } from '../pmccStartPrice';

// Standard normal CDF (Abramowitz & Stegun 26.2.17, |error| < 7.5e-8) -- used only to check the solver independently.
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * poly;
  return x >= 0 ? 1 - tail : tail;
}

function bsCallDelta(spot: number, strike: number, sigma: number, years: number, rate: number): number {
  const d1 = (Math.log(spot / strike) + (rate + sigma * sigma / 2) * years) / (sigma * Math.sqrt(years));
  return normalCdf(d1);
}

// GOOGL 250C Jun-2027 from a real scan: spot $350.858, breakeven $363.55, IVx 36.4%.
const GOOGL = { spot: 350.858, breakeven: 363.55, ivxPct: 36.4, shortDeltaMax: 0.35, shortDteMin: 21 };

describe('normalInv', () => {
  it.each([
    [0.5, 0], [0.30, -0.5244005101], [0.35, -0.3853204664], [0.20, -0.8416212336], [0.975, 1.959963985], [0.01, -2.326347874],
  ])('N^-1(%s) = %s', (p, expected) => {
    expect(normalInv(p)).toBeCloseTo(expected, 6);
  });

  it('is undefined outside (0, 1)', () => {
    expect(normalInv(0)).toBeNaN();
    expect(normalInv(1)).toBeNaN();
    expect(normalInv(1.5)).toBeNaN();
  });
});

describe('computePmccStartPrice', () => {
  it('GOOGL example: start price is about $349.38 and the stock is already above it', () => {
    const result = computePmccStartPrice(GOOGL);
    expect(result.startPrice).toBeCloseTo(349.38, 1);
    expect(result.status).toBe('above');
    expect(result.pctToStart).toBeNull();
  });

  it('reports how far the stock must rise when it is below the start price', () => {
    const result = computePmccStartPrice({ ...GOOGL, spot: 340 });
    expect(result.status).toBe('below');
    expect(result.pctToStart).toBeCloseTo((result.startPrice! / 340 - 1) * 100, 6);
    expect(result.pctToStart).toBeCloseTo(2.76, 1);
  });

  it('a stock exactly at the start price counts as above', () => {
    const { startPrice } = computePmccStartPrice(GOOGL);
    expect(computePmccStartPrice({ ...GOOGL, spot: startPrice! }).status).toBe('above');
  });

  it('round trip: a call struck at the breakeven has the target delta at the start price', () => {
    for (const shortDeltaMax of [0.20, 0.30, 0.35, 0.40]) {
      for (const shortDteMin of [14, 21, 45]) {
        const { startPrice } = computePmccStartPrice({ ...GOOGL, shortDeltaMax, shortDteMin });
        const delta = bsCallDelta(startPrice!, GOOGL.breakeven, GOOGL.ivxPct / 100, shortDteMin / 365, 0.04);
        expect(delta, `delta ${shortDeltaMax}, DTE ${shortDteMin}`).toBeCloseTo(shortDeltaMax, 3);
      }
    }
  });

  it('is more conservative (higher start price) for a higher delta ceiling and a shorter DTE floor', () => {
    const at = (shortDeltaMax: number, shortDteMin: number) => computePmccStartPrice({ ...GOOGL, shortDeltaMax, shortDteMin }).startPrice!;
    expect(at(0.35, 21)).toBeGreaterThan(at(0.30, 21));
    expect(at(0.30, 21)).toBeGreaterThan(at(0.20, 21));
    expect(at(0.35, 21)).toBeGreaterThan(at(0.35, 45));
  });

  it('a call in the trader\'s range never needs a start price above the breakeven for deltas below 0.5', () => {
    for (const shortDeltaMax of [0.10, 0.25, 0.35, 0.40, 0.49]) {
      expect(computePmccStartPrice({ ...GOOGL, shortDeltaMax }).startPrice!).toBeLessThan(GOOGL.breakeven);
    }
  });

  it('is unavailable when an input is missing or invalid', () => {
    const bad = { status: 'unavailable', startPrice: null, pctToStart: null };
    expect(computePmccStartPrice({ ...GOOGL, ivxPct: null })).toEqual(bad);
    expect(computePmccStartPrice({ ...GOOGL, ivxPct: 0 })).toEqual(bad);
    expect(computePmccStartPrice({ ...GOOGL, breakeven: null })).toEqual(bad);
    expect(computePmccStartPrice({ ...GOOGL, breakeven: 0 })).toEqual(bad);
    expect(computePmccStartPrice({ ...GOOGL, spot: undefined })).toEqual(bad);
    expect(computePmccStartPrice({ ...GOOGL, shortDeltaMax: 0 })).toEqual(bad);
    expect(computePmccStartPrice({ ...GOOGL, shortDeltaMax: 1 })).toEqual(bad);
    expect(computePmccStartPrice({ ...GOOGL, shortDteMin: 0 })).toEqual(bad);
    expect(computePmccStartPrice({ ...GOOGL, ivxPct: Number.NaN })).toEqual(bad);
  });
});
