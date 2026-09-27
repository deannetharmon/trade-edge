// lib/portfolio/__tests__/rollExplanation.test.ts

import { describe, expect, it } from 'vitest';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import { explainRoll, ROLL_FEE_PER_LEG_ROUND_TRIP } from '../rollExplanation';
import { buildOriginalCreditDefaultPolicy } from '../stopLossPolicy';

function leg(overrides: Partial<PositionLeg>): PositionLeg {
  return { symbol: 'X', optionType: 'P', strikePrice: 0, direction: 'Short', quantity: 1, avgOpenPrice: null, currentPrice: null, ...overrides } as PositionLeg;
}

// KEEP-CREDIT-0001 Part A's own worked example: put spread, credit $1.65,
// 570/565, one contract, closing mid $2.10, rolled to 568/563 at a $2.28
// limit. The ticket's prose uses an illustrative, unsourced $4 fee (Dane's
// review: no fee model existed); this fixture uses the real approved
// $0.14-per-leg constant instead, so the fee/net/downstream figures below
// are recomputed, not copied from the ticket text -- see the module's own
// doc comment.
function basePosition(overrides: Partial<Position> = {}): Position {
  return {
    key: 'AAPL-1', symbol: 'AAPL', strategy: 'BPS', quantity: 1,
    legs: [leg({ strikePrice: 570, direction: 'Short' }), leg({ strikePrice: 565, direction: 'Long' })],
    entryCredit: 165, creditReceived: 165, currentValue: 210, maxRisk: 335,
    stopLossPolicy: buildOriginalCreditDefaultPolicy(1.65),
    ...overrides,
  } as unknown as Position;
}

describe('explainRoll: the ticket\'s worked-example scenario, real fee constant', () => {
  const result = explainRoll({ position: basePosition(), newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 });

  it('computes the close side unaffected by fees', () => {
    expect(result?.closeCostTotal).toBe(210);
    expect(result?.lossAtCloseTotal).toBe(45); // pos.currentValue(210) - entryCredit(165)
  });

  it('computes the real fee total: $0.14/leg x 4 legs x 1 contract', () => {
    expect(ROLL_FEE_PER_LEG_ROUND_TRIP).toBe(0.14);
    expect(result?.feesTotal).toBeCloseTo(0.56, 5);
  });

  it('nets the roll: floor_to_cent(new - old) - fees, per DECIDE-0001', () => {
    // floor_to_cent(2.28 - 2.10) = 0.18; 0.18 - (0.56/100) = 0.1744 -> 0.17
    expect(result?.netRollPerShare).toBeCloseTo(0.17, 5);
    expect(result?.netRollTotal).toBeCloseTo(17, 5);
    expect(result?.isNetDebit).toBe(false);
  });

  it('carries the credit basis forward: C\' = C + rollNet', () => {
    expect(result?.newCreditBasisPerShare).toBeCloseTo(1.82, 5); // 1.65 + 0.17
    expect(result?.newCreditBasisTotal).toBeCloseTo(182, 5);
  });

  it('computes new max loss as (new width - C\') x 100, and the change vs. the old max loss', () => {
    expect(result?.newWidth).toBe(5);
    expect(result?.newMaxLossTotal).toBeCloseTo(318, 5); // (5 - 1.82) * 100
    expect(result?.oldMaxLossTotal).toBe(335);
    expect(result?.maxLossChangeTotal).toBeCloseTo(-17, 5);
  });

  it('computes old and new breakeven with the same put-spread formula (strike - credit)', () => {
    expect(result?.oldBreakeven).toBeCloseTo(568.35, 5); // 570 - 1.65, matches the ticket's own "was $568.35"
    expect(result?.newBreakeven).toBeCloseTo(566.18, 5); // 568 - 1.82
  });

  it('computes the new stop as 2 x C\' via the canonical stop-policy builder, and the old stop total loss from the recorded policy', () => {
    expect(result?.newStopTriggerPrice).toBeCloseTo(3.64, 5); // 2 * 1.82
    expect(result?.newStopTotalLoss).toBeCloseTo(182, 5);     // = C' total, since loss at a 2C mark is C
    expect(result?.oldStopTotalLoss).toBeCloseTo(165, 5);     // matches the ticket's own "was $165"
  });

  it('is not a wider spread (both widths are 5)', () => {
    expect(result?.isWiderSpread).toBe(false);
  });

  it('reports quantity and option type', () => {
    expect(result?.qty).toBe(1);
    expect(result?.optionType).toBe('P');
  });
});

describe('explainRoll: scope exclusions (Dean, 2026-09-27)', () => {
  it('returns null for an iron condor (4 legs)', () => {
    const ic = basePosition({
      legs: [
        leg({ strikePrice: 95, direction: 'Short', optionType: 'P' }),
        leg({ strikePrice: 90, direction: 'Long', optionType: 'P' }),
        leg({ strikePrice: 105, direction: 'Short', optionType: 'C' }),
        leg({ strikePrice: 110, direction: 'Long', optionType: 'C' }),
      ],
    });
    expect(explainRoll({ position: ic, newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 })).toBeNull();
  });

  it('returns null for a single-leg CSP (no long leg to pair with)', () => {
    const csp = basePosition({ strategy: 'CSP', legs: [leg({ strikePrice: 570, direction: 'Short' })] });
    expect(explainRoll({ position: csp, newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 })).toBeNull();
  });
});

describe('explainRoll: net-debit and wider-spread warnings', () => {
  it('flags a net debit when fees and close cost outrun the new credit', () => {
    const result = explainRoll({ position: basePosition(), newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 1.50 });
    // floor_to_cent(1.50 - 2.10) = -0.60; -0.60 - 0.0056 -> rounds to -0.61
    expect(result?.netRollPerShare).toBeCloseTo(-0.61, 5);
    expect(result?.isNetDebit).toBe(true);
  });

  it('flags a wider spread when the new width exceeds the old', () => {
    const result = explainRoll({ position: basePosition(), newShortStrike: 570, newLongStrike: 550, newCreditPerShare: 2.28 });
    expect(result?.newWidth).toBe(20);
    expect(result?.isWiderSpread).toBe(true);
  });
});

describe('explainRoll: call spread breakeven direction', () => {
  it('adds credit to the short strike for a call spread (BCS)', () => {
    const bcs = basePosition({
      strategy: 'BCS',
      legs: [leg({ strikePrice: 430, direction: 'Short', optionType: 'C' }), leg({ strikePrice: 435, direction: 'Long', optionType: 'C' })],
    });
    const result = explainRoll({ position: bcs, newShortStrike: 432, newLongStrike: 437, newCreditPerShare: 2.28 });
    expect(result?.optionType).toBe('C');
    expect(result?.oldBreakeven).toBeCloseTo(431.65, 5); // 430 + 1.65
    expect(result?.newBreakeven).toBeCloseTo(433.82, 5); // 432 + C'(1.82)
  });
});

describe('explainRoll: missing data is handled without throwing', () => {
  it('falls back to creditReceived when entryCredit is absent', () => {
    const position = basePosition({ entryCredit: null });
    const result = explainRoll({ position, newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 });
    expect(result?.oldCreditTotal).toBe(165);
  });

  it('returns a null oldMaxLossTotal and maxLossChangeTotal when maxRisk is not finite', () => {
    const position = basePosition({ maxRisk: NaN });
    const result = explainRoll({ position, newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 });
    expect(result?.oldMaxLossTotal).toBeNull();
    expect(result?.maxLossChangeTotal).toBeNull();
  });

  it('returns a null oldStopTotalLoss when there is no recorded stop policy', () => {
    const position = basePosition({ stopLossPolicy: null });
    const result = explainRoll({ position, newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 });
    expect(result?.oldStopTotalLoss).toBeNull();
  });

  it('returns a null oldStopTotalLoss for a non-credit-multiple stop basis (current-spread-value anchored)', () => {
    const position = basePosition({
      stopLossPolicy: { triggerPrice: 3.0, anchorBasis: 'CURRENT_SPREAD_VALUE', anchorValue: 2.0, multiple: 1.5, source: 'AI_SUGGESTION', createdAt: null, brokerOrderId: null, complexOrderId: null },
    });
    const result = explainRoll({ position, newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 });
    expect(result?.oldStopTotalLoss).toBeNull();
  });

  it('returns null when quantity is not a positive finite number', () => {
    expect(explainRoll({ position: basePosition({ quantity: 0 }), newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 })).toBeNull();
  });
});
