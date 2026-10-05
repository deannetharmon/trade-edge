// lib/portfolio-intelligence/__tests__/percentUnits.test.ts

// PCT-UNITS-0001: P/L % and buffer % are whole percentages everywhere. A small genuine percentage (between -1 and 1) must
// never be read as a fraction and multiplied by 100. Regression for Dean's 2026-10-05 SOXL short put: credit $540, +$5 at
// mid (0.93%), -$20 close-now, no profit-target order, 31 DTE -- shown as "Take Profit".

import { describe, expect, it } from 'vitest';
import { evaluatePositionObjective, normalizePositionObjectivePct, type PositionObjectiveInput } from '../objectives/positionObjective';
import { calculatePositionHealthScore } from '../health/score';

const NOW = new Date('2026-10-05T16:00:00.000Z');

function soxl(overrides: Partial<PositionObjectiveInput> = {}): PositionObjectiveInput {
  return {
    positionId: 'soxl_put',
    symbol: 'SOXL',
    strategy: 'CSP',
    dte: 31,
    pnlPct: (5 / 540) * 100, // 0.93%
    marketablePnlPct: (-20 / 540) * 100, // -3.7%
    buffer: 18.6,
    hasGtc: false,
    ...overrides,
  };
}

describe('normalizePositionObjectivePct', () => {
  it('takes whole percentages as given, including small ones', () => {
    expect(normalizePositionObjectivePct(0.93)).toBe(0.93);
    expect(normalizePositionObjectivePct(-0.5)).toBe(-0.5);
    expect(normalizePositionObjectivePct(1)).toBe(1);
    expect(normalizePositionObjectivePct(55)).toBe(55);
  });

  it('rejects only missing or non-finite values', () => {
    expect(normalizePositionObjectivePct(null)).toBeNull();
    expect(normalizePositionObjectivePct(undefined)).toBeNull();
    expect(normalizePositionObjectivePct(Number.NaN)).toBeNull();
    expect(normalizePositionObjectivePct(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('recommendations read a small profit as small', () => {
  // Mid between +$1.08 and +$2.70 on a $540 credit (0.2%-0.5%) used to read as 20%-50%: "meaningful profit but no
  // working profit-target order" -> Take Profit. At +$5 (0.93% -> 93%) it read as target reached, contradicted by
  // close-now -> Verify Pricing. Neither may happen for a position that is down at close-now and barely up at mid.
  it.each([2, 5])('SOXL up $%s at mid, down at close-now, no target order: no Take Profit and no pricing conflict', midDollars => {
    const { legacyRecommendation } = evaluatePositionObjective(soxl({ pnlPct: (midDollars / 540) * 100 }), NOW);
    expect(legacyRecommendation.kind).not.toBe('close-winner');
    expect(legacyRecommendation.kind).not.toBe('verify-pricing');
    expect(legacyRecommendation.managementIntent?.intent).not.toBe('TAKE_PROFIT');
  });

  it('a genuine 22% profit with no target order still gets the unprotected-profit nudge (rule unchanged)', () => {
    const { legacyRecommendation } = evaluatePositionObjective(soxl({ pnlPct: 22, marketablePnlPct: 18 }), NOW);
    expect(legacyRecommendation.managementIntent?.reasons ?? []).toContain('Position has meaningful profit but no working profit-target order.');
  });

  it('a strike 0.5% away is read as 0.5%, not 50%', () => {
    const near = evaluatePositionObjective(soxl({ buffer: 0.5, pnlPct: -40, marketablePnlPct: -45 }), NOW);
    const far = evaluatePositionObjective(soxl({ buffer: 50, pnlPct: -40, marketablePnlPct: -45 }), NOW);
    expect(near.legacyRecommendation).not.toEqual(far.legacyRecommendation);
  });
});

describe('health score reads small P/L and buffer as small', () => {
  it('0.5% buffer scores worse than 50% buffer; 0.9% profit is not treated as 90%', () => {
    const base = { symbol: 'SOXL', strategy: 'CSP', dte: 31 };
    const near = calculatePositionHealthScore({ ...base, pnlPct: 0.9, buffer: 0.5 }, NOW);
    const far = calculatePositionHealthScore({ ...base, pnlPct: 0.9, buffer: 50 }, NOW);
    expect(near.score).toBeLessThan(far.score);
    const small = calculatePositionHealthScore({ ...base, pnlPct: 0.9, buffer: 20 }, NOW);
    const large = calculatePositionHealthScore({ ...base, pnlPct: 90, buffer: 20 }, NOW);
    expect(small.factors.map(f => f.key)).not.toEqual(large.factors.map(f => f.key));
  });
});
