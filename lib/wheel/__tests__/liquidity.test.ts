// lib/wheel/__tests__/liquidity.test.ts
//
// WHEEL-SYSTEM-0002 (W2) -- the bid-ask and open-interest check, in integer cents.

import { describe, expect, it } from 'vitest';
import { bidAskPercent, isLiquid } from '../liquidity';

const LIMITS = { maxBidAskBps: 1000, minOpenInterest: 100 };
const leg = (bid: number, ask: number, openInterest = 500) => ({ bid, ask, openInterest });

describe('isLiquid', () => {
  it('passes a tight quote with enough open interest', () => {
    expect(isLiquid(leg(0.8, 0.84), LIMITS)).toBe(true);
  });
  it('the bid-ask gap exactly 10% of the midpoint passes; a little over fails', () => {
    // bid 0.95, ask 1.05: mid 1.00, gap 0.10 = exactly 10%
    expect(isLiquid(leg(0.95, 1.05), LIMITS)).toBe(true);
    // bid 0.94, ask 1.05: gap 0.11 over mid 0.995 = 11.06%
    expect(isLiquid(leg(0.94, 1.05), LIMITS)).toBe(false);
  });
  it('a bid of 0 with an ask is never liquid', () => {
    expect(isLiquid(leg(0, 0.1), LIMITS)).toBe(false);
  });
  it('an inverted or missing quote is not liquid', () => {
    expect(isLiquid(leg(0.9, 0.8), LIMITS)).toBe(false);
    expect(isLiquid(leg(Number.NaN, 0.8), LIMITS)).toBe(false);
  });
  it('open interest exactly on the minimum passes; one under fails', () => {
    expect(isLiquid(leg(0.8, 0.84, 100), LIMITS)).toBe(true);
    expect(isLiquid(leg(0.8, 0.84, 99), LIMITS)).toBe(false);
  });
  it('limits are editable: a wider limit lets a wider gap through', () => {
    expect(isLiquid(leg(0.8, 0.95), { maxBidAskBps: 2000, minOpenInterest: 100 })).toBe(true);
    expect(isLiquid(leg(0.8, 0.95), LIMITS)).toBe(false);
  });
});

describe('bidAskPercent', () => {
  it('is the gap as a whole percent of the midpoint', () => {
    expect(bidAskPercent(leg(0.8, 0.9))).toBe(12); // 0.10 / 0.85 = 11.76%
    expect(bidAskPercent(leg(0.95, 1.05))).toBe(10);
  });
  it('is null without a usable quote', () => {
    expect(bidAskPercent(leg(0, 0.1))).toBeNull();
    expect(bidAskPercent(leg(0.9, 0.8))).toBeNull();
  });
});
