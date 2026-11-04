// lib/scans/__tests__/ccStrikeFloor.test.ts
// CC-WHEEL-0001 S1 -- the shared covered-call strike floor.
import { describe, it, expect } from 'vitest';
import { ccStrikeFloor, ccStrikeFloorMessage } from '../ccStrikeFloor';

describe('ccStrikeFloor', () => {
  it('is the higher of stock price and cost basis', () => {
    expect(ccStrikeFloor(62.85, 82)).toEqual({ floor: 82, missing: null });
    expect(ccStrikeFloor(100, 90)).toEqual({ floor: 100, missing: null });
  });
  it('an unknown cost basis fails closed, never falls back to the price', () => {
    expect(ccStrikeFloor(100, null)).toEqual({ floor: null, missing: 'NO_COST_BASIS' });
    expect(ccStrikeFloor(100, undefined)).toEqual({ floor: null, missing: 'NO_COST_BASIS' });
  });
  it('an unknown stock price fails closed, never falls back to the basis', () => {
    expect(ccStrikeFloor(null, 82)).toEqual({ floor: null, missing: 'NO_STOCK_PRICE' });
    expect(ccStrikeFloor(undefined, 82)).toEqual({ floor: null, missing: 'NO_STOCK_PRICE' });
  });
  it('rejects zero, negative and non-finite inputs', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(ccStrikeFloor(100, bad).floor).toBeNull();
      expect(ccStrikeFloor(bad, 100).floor).toBeNull();
    }
  });
  it('has a message for each missing input', () => {
    expect(ccStrikeFloorMessage('NO_COST_BASIS')).toMatch(/cost basis unavailable/i);
    expect(ccStrikeFloorMessage('NO_STOCK_PRICE')).toMatch(/stock price unavailable/i);
  });
});
