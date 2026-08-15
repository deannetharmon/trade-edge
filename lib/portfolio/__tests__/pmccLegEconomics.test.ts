import { describe, it, expect } from 'vitest';
import {
  canonicalShortLegEntryCredit,
  hasSupportedShortLegEntryEconomics,
  canonicalShortLegCreditPerContract,
  type PmccShortLegLike,
} from '../pmccLegEconomics';

function shortLeg(overrides: Partial<PmccShortLegLike> = {}): PmccShortLegLike {
  return {
    direction: 'Short',
    quantity: 1,
    avgOpenPrice: 3.5,
    dte: 30,
    strikePrice: 200,
    ...overrides,
  };
}

describe('canonicalShortLegEntryCredit', () => {
  it('computes credit from the leg\'s own fill price, quantity, and the contract multiplier', () => {
    expect(canonicalShortLegEntryCredit(shortLeg({ avgOpenPrice: 3.5, quantity: 1 }))).toBe(350);
  });

  it('scales correctly with quantity > 1', () => {
    expect(canonicalShortLegEntryCredit(shortLeg({ avgOpenPrice: 2.0, quantity: 3 }))).toBe(600);
  });

  it('uses the absolute value of quantity (broker sign conventions vary)', () => {
    expect(canonicalShortLegEntryCredit(shortLeg({ avgOpenPrice: 2.0, quantity: -1 }))).toBe(200);
  });

  it('fails closed on a Long leg -- this function is short-leg-only by design', () => {
    expect(canonicalShortLegEntryCredit(shortLeg({ direction: 'Long' }))).toBeNull();
  });

  it('fails closed on missing fill price', () => {
    expect(canonicalShortLegEntryCredit(shortLeg({ avgOpenPrice: null }))).toBeNull();
  });

  it('fails closed on a negative fill price', () => {
    expect(canonicalShortLegEntryCredit(shortLeg({ avgOpenPrice: -1 }))).toBeNull();
  });

  it('fails closed on a non-finite fill price', () => {
    expect(canonicalShortLegEntryCredit(shortLeg({ avgOpenPrice: NaN }))).toBeNull();
  });

  it('fails closed on zero or invalid quantity', () => {
    expect(canonicalShortLegEntryCredit(shortLeg({ quantity: 0 }))).toBeNull();
  });

  it('is not affected by the long leg\'s data -- isolated by construction, only takes one leg', () => {
    // There is no long-leg parameter for this function to accept at all;
    // this test documents that structural guarantee explicitly rather
    // than leaving it implicit in the function signature alone.
    const credit = canonicalShortLegEntryCredit(shortLeg({ avgOpenPrice: 3.5, quantity: 1 }));
    expect(credit).toBe(350);
    // A wildly different, unrelated "long leg" price could never have
    // influenced this result since no such input exists in this function.
  });
});

describe('hasSupportedShortLegEntryEconomics', () => {
  it('true for a valid short leg with positive credit', () => {
    expect(hasSupportedShortLegEntryEconomics(shortLeg())).toBe(true);
  });

  it('false for a long leg', () => {
    expect(hasSupportedShortLegEntryEconomics(shortLeg({ direction: 'Long' }))).toBe(false);
  });

  it('false for missing fill data', () => {
    expect(hasSupportedShortLegEntryEconomics(shortLeg({ avgOpenPrice: null }))).toBe(false);
  });
});

describe('canonicalShortLegCreditPerContract', () => {
  it('computes per-contract credit correctly for a single contract', () => {
    expect(canonicalShortLegCreditPerContract(shortLeg({ avgOpenPrice: 3.5, quantity: 1 }))).toBe(3.5);
  });

  it('computes per-contract credit correctly across multiple contracts', () => {
    expect(canonicalShortLegCreditPerContract(shortLeg({ avgOpenPrice: 2.0, quantity: 4 }))).toBe(2.0);
  });

  it('fails closed when the underlying credit is unavailable', () => {
    expect(canonicalShortLegCreditPerContract(shortLeg({ avgOpenPrice: null }))).toBeNull();
  });
});

