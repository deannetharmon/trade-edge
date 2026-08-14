import { describe, expect, it } from 'vitest';
import {
  calculateIronCondorCapital,
  calculatePmccCapital,
  buildPmccFinancialsFromQuotes,
  resolveOptionContractMultiplier,
  STANDARD_EQUITY_OPTION_MULTIPLIER,
} from '../financials';

describe('canonical scan financial calculations', () => {
  it('defines the standard equity-option multiplier in the financial domain', () => {
    expect(STANDARD_EQUITY_OPTION_MULTIPLIER).toBe(100);
    expect(resolveOptionContractMultiplier(undefined)).toBe(100);
    expect(resolveOptionContractMultiplier(10)).toBe(10);
  });

  it.each([
    [30, 100, 1, 3_000],
    [30, 100, 2, 6_000],
    [30, 10, 3, 900],
  ])('converts PMCC per-share debit exactly once', (netDebit, multiplier, quantity, expected) => {
    expect(calculatePmccCapital({
      netDebit,
      netDebitUnit: 'per_share',
      contractMultiplier: multiplier,
      quantity,
    })).toEqual({ capitalRequired: expected, theoreticalMaxLoss: expected });
  });

  it('proves raw PMCC debit is the per-share difference between option quote points', () => {
    expect(buildPmccFinancialsFromQuotes({
      longCostPerShare: 31.35,
      shortCreditPerShare: 1.35,
      contractMultiplier: 10,
      quantity: 3,
    })).toEqual({
      netDebit: 30,
      netDebitUnit: 'per_share',
      contractMultiplier: 10,
      quantity: 3,
      capitalRequired: 900,
      theoreticalMaxLoss: 900,
    });
  });

  it.each([
    ['zero debit', { netDebit: 0, netDebitUnit: 'per_share', contractMultiplier: 100, quantity: 1 }],
    ['negative debit', { netDebit: -1, netDebitUnit: 'per_share', contractMultiplier: 100, quantity: 1 }],
    ['nonfinite debit', { netDebit: Number.NaN, netDebitUnit: 'per_share', contractMultiplier: 100, quantity: 1 }],
    ['zero multiplier', { netDebit: 30, netDebitUnit: 'per_share', contractMultiplier: 0, quantity: 1 }],
    ['missing multiplier', { netDebit: 30, netDebitUnit: 'per_share', contractMultiplier: undefined as unknown as number, quantity: 1 }],
  ])('rejects invalid PMCC inputs: %s', (_label, input) => {
    expect(() => calculatePmccCapital(input as Parameters<typeof calculatePmccCapital>[0])).toThrow();
  });

  it('uses total Iron Condor credit against the wider threatened wing', () => {
    expect(calculateIronCondorCapital({
      putWidth: 5,
      callWidth: 5,
      totalCredit: 2,
      creditUnit: 'per_share',
      contractMultiplier: 100,
      quantity: 1,
    })).toEqual({ capitalRequired: 300, theoreticalMaxLoss: 300 });
    expect(calculateIronCondorCapital({
      putWidth: 5,
      callWidth: 10,
      totalCredit: 2,
      creditUnit: 'per_share',
      contractMultiplier: 10,
      quantity: 3,
    })).toEqual({ capitalRequired: 240, theoreticalMaxLoss: 240 });
  });

  it.each([
    ['credit exceeds wider wing', 5, 5, 6],
    ['zero credit', 5, 5, 0],
    ['invalid width', 0, 5, 1],
  ])('rejects impossible Iron Condor inputs: %s', (_label, putWidth, callWidth, totalCredit) => {
    expect(() => calculateIronCondorCapital({
      putWidth,
      callWidth,
      totalCredit,
      creditUnit: 'per_share',
      contractMultiplier: 100,
      quantity: 1,
    })).toThrow();
  });
});
