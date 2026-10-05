// lib/portfolio-intelligence/__tests__/takeProfitBasis.test.ts

// TAKEPROFIT-BASIS-0001 golden fixtures (Alan, via Quinn's review). Short put, $540 credit, 31 DTE, no working target order.

import { describe, expect, it } from 'vitest';
import { evaluatePositionObjective, type PositionObjectiveInput } from '../objectives/positionObjective';

const NOW = new Date('2026-10-05T16:00:00.000Z');

function put(overrides: Partial<PositionObjectiveInput>): PositionObjectiveInput {
  return { positionId: 'p', symbol: 'SOXL', strategy: 'CSP', dte: 31, buffer: 18, hasGtc: false, ...overrides };
}

const intentOf = (input: PositionObjectiveInput) => evaluatePositionObjective(input, NOW).legacyRecommendation.managementIntent?.intent;

describe('TAKEPROFIT-BASIS-0001 golden fixtures', () => {
  it('mid +22% but close-now -4%: no Set Profit Target and no Take Profit', () => {
    const intent = intentOf(put({ pnlPct: 22, marketablePnlPct: -4 }));
    expect(intent).not.toBe('SET_PROFIT_TARGET');
    expect(intent).not.toBe('TAKE_PROFIT');
  });

  it('mid +22%, close-now +3%: Set Profit Target with the numbers in the reason', () => {
    const { legacyRecommendation } = evaluatePositionObjective(put({ pnlPct: 22, marketablePnlPct: 3 }), NOW);
    expect(legacyRecommendation.managementIntent?.intent).toBe('SET_PROFIT_TARGET');
    expect(legacyRecommendation.label).toBe('Set Profit Target');
    expect(legacyRecommendation.managementIntent?.reasons).toContain('Up 22% of credit at mid (close-now: +3%) · no profit-target order.');
  });

  it('a working target order means no nudge', () => {
    expect(intentOf(put({ pnlPct: 22, marketablePnlPct: 3, hasGtc: true }))).not.toBe('SET_PROFIT_TARGET');
  });

  it('mid +55% confirmed at close-now: Take Profit (the real exit is unchanged)', () => {
    expect(intentOf(put({ pnlPct: 55, marketablePnlPct: 52 }))).toBe('TAKE_PROFIT');
  });

  it('thresholds unchanged: 19% mid gives no nudge; 14 DTE gives no nudge', () => {
    expect(intentOf(put({ pnlPct: 19, marketablePnlPct: 10 }))).not.toBe('SET_PROFIT_TARGET');
    expect(intentOf(put({ pnlPct: 22, marketablePnlPct: 3, dte: 14 }))).not.toBe('SET_PROFIT_TARGET');
  });
});
