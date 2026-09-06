// lib/scans/__tests__/leapsScore.test.ts

import { describe, it, expect } from 'vitest';
import { computeLeapsScore } from '../leapsScore';

describe('computeLeapsScore', () => {
  it('gives full marks (100) for zero extrinsic, tight spread, deep OI', () => {
    const result = computeLeapsScore({ extrinsicValue: 0, totalCost: 10000, spreadPct: 0, openInterest: 1000 });
    expect(result.total).toBe(100);
    expect(result.costEfficiencyScore).toBe(60);
    expect(result.liquidityScore).toBe(40);
    expect(result.incomplete).toBe(false);
  });

  it('gives zero Cost Efficiency at or beyond the 30% extrinsic ceiling', () => {
    const atCeiling = computeLeapsScore({ extrinsicValue: 3000, totalCost: 10000, spreadPct: 0, openInterest: 1000 });
    expect(atCeiling.costEfficiencyScore).toBe(0);
    const beyondCeiling = computeLeapsScore({ extrinsicValue: 5000, totalCost: 10000, spreadPct: 0, openInterest: 1000 });
    expect(beyondCeiling.costEfficiencyScore).toBe(0);
  });

  it('scores a real example from the app screenshots correctly (MSFT: 11.6% extrinsic, 1.8% spread, 1254 OI)', () => {
    // MSFT $15,770 cost, $18.29 extrinsic (11.6% of cost per-contract cost
    // basis -- extrinsicValue here is per-contract, matching the actual
    // computeLeapsScore call site's inputs).
    const result = computeLeapsScore({ extrinsicValue: 18.29, totalCost: 15770, spreadPct: 1.8, openInterest: 1254 });
    // Cost efficiency: 11.6% of 30% ceiling -> (1 - 0.387) * 60 ~= 37
    expect(result.costEfficiencyScore).toBeGreaterThan(30);
    expect(result.costEfficiencyScore).toBeLessThan(45);
    // Liquidity: tight spread (1.8% of 10% ceiling) + OI well past 500 floor -> near-full 40
    expect(result.liquidityScore).toBeGreaterThan(35);
    expect(result.incomplete).toBe(false);
  });

  it('is null-safe and reports incomplete when any required input is missing', () => {
    const noDelta = computeLeapsScore({ extrinsicValue: null, totalCost: 10000, spreadPct: 1, openInterest: 500 });
    expect(noDelta.incomplete).toBe(true);
    expect(noDelta.costEfficiencyScore).toBe(0);

    const noOi = computeLeapsScore({ extrinsicValue: 100, totalCost: 10000, spreadPct: 1, openInterest: null });
    expect(noOi.incomplete).toBe(true);
    expect(noOi.liquidityScore).toBeLessThan(40);
  });

  it('never returns a negative score or a score above 100 for extreme inputs', () => {
    const extreme = computeLeapsScore({ extrinsicValue: 999999, totalCost: 1, spreadPct: 999, openInterest: -5 });
    expect(extreme.total).toBeGreaterThanOrEqual(0);
    expect(extreme.total).toBeLessThanOrEqual(100);
  });
});
