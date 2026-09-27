// lib/portfolio/__tests__/rollExplanation.test.ts

import { describe, expect, it } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';
import { explainRoll, OPEN_COMMISSION_PER_CONTRACT, REG_CLEARING_FEE_PER_CONTRACT_PER_LEG } from '../rollExplanation';

function basePosition(overrides: Partial<Position> = {}): Position {
  return {
    key: 'TEST-1', symbol: 'TEST', strategy: 'BPS', quantity: 1,
    legs: [
      { symbol: 'TEST-short', optionType: 'P', strikePrice: 570, direction: 'Short', quantity: 1, avgOpenPrice: null, currentPrice: null },
      { symbol: 'TEST-long', optionType: 'P', strikePrice: 565, direction: 'Long', quantity: 1, avgOpenPrice: null, currentPrice: null },
    ],
    entryCredit: 165, creditReceived: 165, currentValue: 210, maxRisk: 335,
    ...overrides,
  } as unknown as Position;
}

describe('explainRoll', () => {
  // The ticket's own worked example (put spread, credit $1.65, 570/565, one
  // contract, roll to 568/563) recomputed with the real fee constants
  // (Dean, 2026-09-27: TastyTrade's standard published rate) rather than
  // the ticket prose's illustrative, unsourced $4 fee.
  it('matches the ticket\'s worked example, recomputed with the real fee constants', () => {
    const result = explainRoll({
      position: basePosition(),
      newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28,
    });
    expect(result).not.toBeNull();
    const r = result!;

    expect(r.oldCreditTotal).toBe(165);
    expect(r.closeCostTotal).toBe(210);
    expect(r.lossAtCloseTotal).toBe(45); // "You lose $45 on this trade"

    expect(r.openCreditTotal).toBe(228);
    // close: 2 legs x $0.14 = $0.28; open: 2 legs x ($1.00 + $0.14) = $2.28; total $2.56
    expect(r.feesTotal).toBeCloseTo(2.56, 2);

    // rollNet = floor(2.28 - 2.10) - (2.56/100) = 0.18 - 0.0256 = 0.1544 -> rounds to $0.15/share
    expect(r.netRollPerShare).toBeCloseTo(0.15, 2);
    expect(r.netRollTotal).toBeCloseTo(15.00, 2);
    expect(r.isNetDebit).toBe(false);

    // C' = 1.65 + 0.15 = 1.80
    expect(r.newCreditBasisPerShare).toBeCloseTo(1.80, 2);
    expect(r.newCreditBasisTotal).toBeCloseTo(180, 2);

    // new max loss = (5 - 1.80) x 100 = $320 (was $335)
    expect(r.newMaxLossTotal).toBeCloseTo(320, 2);
    expect(r.oldMaxLossTotal).toBe(335);
    expect(r.maxLossChangeTotal).toBeCloseTo(-15, 2);

    // old breakeven = 570 - 1.65 = 568.35; new breakeven = 568 - 1.80 = 566.20
    expect(r.oldBreakeven).toBeCloseTo(568.35, 2);
    expect(r.newBreakeven).toBeCloseTo(566.20, 2);

    // new stop = 2 x C' = $3.60 mark, total loss $180 (2x-credit default policy, reused unchanged)
    expect(r.newStopTriggerPrice).toBeCloseTo(3.60, 2);
    expect(r.newStopTotalLoss).toBeCloseTo(180, 2);

    expect(r.isWiderSpread).toBe(false);
    expect(r.oldWidth).toBe(5);
    expect(r.newWidth).toBe(5);
    expect(r.optionType).toBe('P');
    expect(r.qty).toBe(1);
  });

  it('scales fees and totals by quantity', () => {
    const r = explainRoll({ position: basePosition({ quantity: 3, entryCredit: 495, creditReceived: 495, currentValue: 630, maxRisk: 1005 }), newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 })!;
    expect(r.feesTotal).toBeCloseTo(2.56 * 3, 2);
    expect(r.qty).toBe(3);
  });

  it('confirms the fee constants: $1.00 open commission, $0.14 regulatory/clearing per leg', () => {
    expect(OPEN_COMMISSION_PER_CONTRACT).toBe(1.00);
    expect(REG_CLEARING_FEE_PER_CONTRACT_PER_LEG).toBe(0.14);
  });

  it('returns null for a single-leg position (CSP/CC) -- v1 is two-leg vertical spreads only', () => {
    const singleLeg = basePosition({ legs: [{ symbol: 'TEST-short', optionType: 'P', strikePrice: 570, direction: 'Short', quantity: 1, avgOpenPrice: null, currentPrice: null }] as any });
    expect(explainRoll({ position: singleLeg, newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 })).toBeNull();
  });

  it('returns null for a 4-leg iron condor -- out of v1 scope', () => {
    const ic = basePosition({ legs: [
      { symbol: 'p-short', optionType: 'P', strikePrice: 570, direction: 'Short', quantity: 1, avgOpenPrice: null, currentPrice: null },
      { symbol: 'p-long', optionType: 'P', strikePrice: 565, direction: 'Long', quantity: 1, avgOpenPrice: null, currentPrice: null },
      { symbol: 'c-short', optionType: 'C', strikePrice: 590, direction: 'Short', quantity: 1, avgOpenPrice: null, currentPrice: null },
      { symbol: 'c-long', optionType: 'C', strikePrice: 595, direction: 'Long', quantity: 1, avgOpenPrice: null, currentPrice: null },
    ] as any });
    expect(explainRoll({ position: ic, newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 })).toBeNull();
  });

  it('returns null when quantity is zero or not finite', () => {
    expect(explainRoll({ position: basePosition({ quantity: 0 }), newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 })).toBeNull();
  });

  it('returns null when both entryCredit and creditReceived are unavailable', () => {
    const noCredit = basePosition({ entryCredit: null, creditReceived: null } as any);
    expect(explainRoll({ position: noCredit, newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 })).toBeNull();
  });

  it('flags a net debit roll when fees exceed the mid-to-mid improvement', () => {
    // close mid 2.10, new credit only 2.05 -- a $0.05 improvement, less than the $0.0256/share in fees once fee > improvement
    const r = explainRoll({ position: basePosition({ currentValue: 210 }), newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.11 })!;
    // floor(2.11 - 2.10) - 0.0256 = 0.01 - 0.0256 = -0.0156 -> rounds to -$0.02/share
    expect(r.netRollPerShare).toBeLessThan(0);
    expect(r.isNetDebit).toBe(true);
  });

  it('flags a wider spread when the new width exceeds the old width', () => {
    const r = explainRoll({ position: basePosition(), newShortStrike: 570, newLongStrike: 550, newCreditPerShare: 5.00 })!;
    expect(r.isWiderSpread).toBe(true);
    expect(r.newWidth).toBe(20);
  });

  it('computes breakeven in the opposite direction for a call spread (BCS)', () => {
    const bcs = basePosition({
      strategy: 'BCS',
      legs: [
        { symbol: 'c-short', optionType: 'C', strikePrice: 100, direction: 'Short', quantity: 1, avgOpenPrice: null, currentPrice: null },
        { symbol: 'c-long', optionType: 'C', strikePrice: 105, direction: 'Long', quantity: 1, avgOpenPrice: null, currentPrice: null },
      ] as any,
      entryCredit: 165, creditReceived: 165, currentValue: 210, maxRisk: 335,
    });
    const r = explainRoll({ position: bcs, newShortStrike: 102, newLongStrike: 107, newCreditPerShare: 2.28 })!;
    expect(r.optionType).toBe('C');
    // call spread breakeven = strike + credit, not strike - credit
    expect(r.oldBreakeven).toBeCloseTo(101.65, 2);
    expect(r.newBreakeven).toBeCloseTo(103.80, 2);
  });

  it('computes the old stop\'s total loss only for an ORIGINAL_CREDIT-anchored policy', () => {
    const withPolicy = basePosition({
      stopLossPolicy: { triggerPrice: 3.30, anchorBasis: 'ORIGINAL_CREDIT', anchorValue: 1.65, multiple: 2, source: 'DEFAULT', createdAt: null, brokerOrderId: null, complexOrderId: null },
    } as any);
    const r = explainRoll({ position: withPolicy, newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 })!;
    expect(r.oldStopTotalLoss).toBeCloseTo(165, 2); // (3.30 - 1.65) x 100

    const manual = basePosition({
      stopLossPolicy: { triggerPrice: 4.00, anchorBasis: 'MANUAL_ABSOLUTE', anchorValue: null, multiple: null, source: 'MANUAL', createdAt: null, brokerOrderId: null, complexOrderId: null },
    } as any);
    const r2 = explainRoll({ position: manual, newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 })!;
    expect(r2.oldStopTotalLoss).toBeNull();
  });

  it('handles a missing old maxRisk gracefully (maxLossChangeTotal unavailable, newMaxLossTotal still computed)', () => {
    const noMaxRisk = basePosition({ maxRisk: NaN } as any);
    const r = explainRoll({ position: noMaxRisk, newShortStrike: 568, newLongStrike: 563, newCreditPerShare: 2.28 })!;
    expect(r.oldMaxLossTotal).toBeNull();
    expect(r.maxLossChangeTotal).toBeNull();
    expect(r.newMaxLossTotal).toBeCloseTo(320, 2);
  });
});
