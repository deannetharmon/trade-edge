// SALVAGE-0001 slice A golden fixtures. Chain prices are SYNTHETIC (live chain
// is only available in market hours); the position values are the real MRNA case.
import { describe, expect, it } from 'vitest';
import {
  closeNowCash,
  evaluateObjective,
  holdAtExpiry,
  maxExpiryPayoff,
  pnlFromEntry,
  requiredUnderlying,
  validateWing,
  wingCreditCash,
  wingTotalFromToday,
  type LongLeg,
} from '../salvageMath';

const mrna: LongLeg = { right: 'P', strike: 140, quantity: 1, bid: 2.08, entryDebit: 2574 };
const wing100 = { strike: 100, bid: 0.3 }; // synthetic

describe('MRNA 140P fixture', () => {
  it('Close now = bid less $0.14 closing fee', () => {
    expect(closeNowCash(mrna)).toBe(207.86);
  });
  it('Hold pays only at expiry', () => {
    expect(holdAtExpiry(mrna, 215.9)).toBe(0);
    expect(holdAtExpiry(mrna, 100)).toBe(4000);
  });
  it('wing credit is the bid less $1.14 opening fee', () => {
    expect(wingCreditCash(wing100, 1)).toBe(28.86);
  });
  it('wing total from today across the scenario table', () => {
    expect(wingTotalFromToday(mrna, wing100, 1, 215.9)).toBe(28.86);
    expect(wingTotalFromToday(mrna, wing100, 1, 130)).toBe(1028.86);
    expect(wingTotalFromToday(mrna, wing100, 1, 100)).toBe(4028.86);
    expect(wingTotalFromToday(mrna, wing100, 1, 50)).toBe(4028.86); // capped
  });
  it('max payoff is the spread width x 100', () => {
    expect(maxExpiryPayoff(mrna, wing100, 1)).toBe(4000);
  });
  it('original P&L is separate from from-today dollars', () => {
    expect(pnlFromEntry(mrna, 28.86)).toBe(-2545.14);
  });
  it('full original-debit target needs MRNA at or below 114.54', () => {
    expect(requiredUnderlying(mrna, wing100, 1, 2574)).toEqual({ price: 114.54 });
    expect(evaluateObjective(mrna, wing100, 1, 2574).verdict).toBe('can-meet');
  });
  it('target above the spread cap cannot be met; best case is partial', () => {
    const r = evaluateObjective(mrna, wing100, 1, 5000);
    expect(r.verdict).toBe('partial-only');
    expect(r.bestCase).toBe(4028.86);
    expect(r.required).toBeNull();
  });
  it('a narrow wing cannot meet the original debit (cap 1,000)', () => {
    const r = evaluateObjective(mrna, { strike: 130, bid: 0.9 }, 1, 2574);
    expect(r.verdict).toBe('partial-only');
  });
  it('credit alone can meet a tiny custom amount', () => {
    expect(requiredUnderlying(mrna, wing100, 1, 20)).toEqual({ already: true });
  });
  it('cannot-meet when fees swallow the credit and the cap is tiny', () => {
    const r = evaluateObjective(mrna, { strike: 139.99, bid: 0.001 }, 1, 500);
    expect(r.bestCase).toBeLessThanOrEqual(0);
    expect(r.verdict).toBe('cannot-meet');
  });
});

describe('wing validity', () => {
  it('rejects a wing at or above the long put', () => {
    expect(validateWing(mrna, { strike: 140, bid: 1 }, 1).valid).toBe(false);
    expect(validateWing(mrna, { strike: 150, bid: 1 }, 1).valid).toBe(false);
  });
  it('rejects wing quantity above the long leg', () => {
    expect(validateWing(mrna, wing100, 2).valid).toBe(false);
  });
  it('rejects a zero bid', () => {
    expect(validateWing(mrna, { strike: 100, bid: 0 }, 1).valid).toBe(false);
  });
  it('accepts a lower strike with a bid', () => {
    expect(validateWing(mrna, wing100, 1).valid).toBe(true);
  });
});

describe('mirrored call', () => {
  const call: LongLeg = { right: 'C', strike: 100, quantity: 1, bid: 1, entryDebit: 800 };
  const wing = { strike: 120, bid: 0.4 };
  it('wing must be strictly above', () => {
    expect(validateWing(call, { strike: 90, bid: 1 }, 1).valid).toBe(false);
    expect(validateWing(call, wing, 1).valid).toBe(true);
  });
  it('caps at the width and needs a price at or above', () => {
    expect(maxExpiryPayoff(call, wing, 1)).toBe(2000);
    expect(wingTotalFromToday(call, wing, 1, 150)).toBe(wingCreditCash(wing, 1) + 2000);
    const need = requiredUnderlying(call, wing, 1, 800);
    expect(need).toEqual({ price: expect.any(Number) });
    expect((need as { price: number }).price).toBeGreaterThan(100);
  });
});

describe('quantity 2', () => {
  const two: LongLeg = { ...mrna, quantity: 2, bid: 2.08, entryDebit: 5148 };
  it('scales close, credit and cap', () => {
    expect(closeNowCash(two)).toBe(415.72);
    expect(wingCreditCash(wing100, 2)).toBe(57.72);
    expect(maxExpiryPayoff(two, wing100, 2)).toBe(8000);
  });
  it('a one-contract wing leaves one long put uncovered', () => {
    expect(validateWing(two, wing100, 1).valid).toBe(true);
    expect(wingTotalFromToday(two, wing100, 1, 100)).toBe(28.86 + 8000 - 0);
  });
});
