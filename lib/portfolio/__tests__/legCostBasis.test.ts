// lib/portfolio/__tests__/legCostBasis.test.ts

import { describe, it, expect } from 'vitest';
import { computeLegCostBasis } from '../legCostBasis';

describe('computeLegCostBasis', () => {
  it('credit spread: net is a credit (negative)', () => {
    const r = computeLegCostBasis([
      { direction: 'Short', quantity: 2, avgOpenPrice: 1.5 },
      { direction: 'Long', quantity: 2, avgOpenPrice: 0.5 },
    ]);
    expect(r).toEqual({ longPaid: 100, shortCollected: 300, net: -200 });
  });

  it('PMCC: long LEAPS net of short call is a debit (money invested)', () => {
    const r = computeLegCostBasis([
      { direction: 'Long', quantity: 1, avgOpenPrice: 40 },
      { direction: 'Short', quantity: 1, avgOpenPrice: 2.25 },
    ]);
    expect(r?.longPaid).toBe(4000);
    expect(r?.shortCollected).toBe(225);
    expect(r?.net).toBe(3775);
  });

  it('returns null when any leg has no average open price', () => {
    expect(computeLegCostBasis([
      { direction: 'Long', quantity: 1, avgOpenPrice: 1 },
      { direction: 'Short', quantity: 1, avgOpenPrice: null },
    ])).toBeNull();
  });

  it('returns null for no legs', () => {
    expect(computeLegCostBasis([])).toBeNull();
  });
});
