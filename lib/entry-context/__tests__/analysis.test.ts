import { describe, expect, it } from 'vitest';
import { buildCreditSpreadEntryFacts } from '../analysis';

describe('credit-spread entry facts', () => {
  it('calculates put-spread cushion and expected-move clearance', () => {
    expect(buildCreditSpreadEntryFacts({ strategy: 'BPS', underlyingPrice: 100, shortStrike: 90, expectedMove: 8 })).toEqual({ otmBufferPct: 10, expectedMoveClearancePct: 2, expectedMoveState: 'OUTSIDE' });
  });
  it('identifies a call short strike inside the expected move', () => {
    const facts = buildCreditSpreadEntryFacts({ strategy: 'BCS', underlyingPrice: 100, shortStrike: 105, expectedMove: 8 });
    expect(facts.otmBufferPct).toBe(5); expect(facts.expectedMoveClearancePct).toBe(-3); expect(facts.expectedMoveState).toBe('INSIDE');
  });
  it('does not fabricate expected-move evidence', () => {
    expect(buildCreditSpreadEntryFacts({ strategy: 'BPS', underlyingPrice: 100, shortStrike: 90, expectedMove: null })).toEqual({ otmBufferPct: 10, expectedMoveClearancePct: null, expectedMoveState: 'UNAVAILABLE' });
  });
});
