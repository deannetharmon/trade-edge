// lib/scans/__tests__/cleanCard.test.ts

import { describe, it, expect } from 'vitest';
import { yieldTone, popTone, distanceTone, allocTone, oiTone, breakevenDistancePct, otmPct, allocationFor } from '../cleanCard';

describe('clean card tones', () => {
  it('yield: 20+ green, 10-20 yellow, under 10 red, missing none', () => {
    expect(yieldTone(20)).toBe('green'); expect(yieldTone(10)).toBe('yellow'); expect(yieldTone(6)).toBe('red'); expect(yieldTone(null)).toBe('none');
  });
  it('pop: 80/70 bands', () => {
    expect(popTone(87)).toBe('green'); expect(popTone(75)).toBe('yellow'); expect(popTone(60)).toBe('red');
  });
  it('distance: 7/4 bands', () => {
    expect(distanceTone(7)).toBe('green'); expect(distanceTone(4.4)).toBe('yellow'); expect(distanceTone(3.9)).toBe('red');
  });
  it('alloc: under 15 green, 15-25 yellow, over 25 red', () => {
    expect(allocTone(13)).toBe('green'); expect(allocTone(15)).toBe('yellow'); expect(allocTone(25)).toBe('yellow'); expect(allocTone(27)).toBe('red');
  });
  it('oi is advisory: yellow below the floor, never red', () => {
    expect(oiTone(421, 500)).toBe('yellow'); expect(oiTone(900, 500)).toBe('none'); expect(oiTone(null, 500)).toBe('none');
  });
});

describe('distances', () => {
  it('KO example: price 94, strike 90, breakeven 89.89', () => {
    expect(otmPct(94, 90)!).toBeCloseTo(4.255, 2);
    expect(breakevenDistancePct({ price: 94, breakeven: 89.89 })!).toBeCloseTo(4.37, 2);
  });
  it('falls back to strike minus credit and fails closed without price', () => {
    expect(breakevenDistancePct({ price: 100, strike: 90, creditPerShare: 1 })!).toBeCloseTo(11, 5);
    expect(breakevenDistancePct({ price: null, breakeven: 89 })).toBeNull();
    expect(breakevenDistancePct({ price: 100 })).toBeNull();
  });
});

describe('allocationFor', () => {
  const book = { netLiq: 100000, bySymbol: { KO: 4000 } };
  it('adds the trade to what is already held', () => {
    const a = allocationFor(book, 'KO', 9000)!;
    expect(a.currentPct).toBe(4); expect(a.afterPct).toBe(13); expect(a.afterDollars).toBe(13000);
  });
  it('treats an unheld symbol as zero', () => { expect(allocationFor(book, 'PEP', 9000)!.currentPct).toBe(0); });
  it('fails closed with no book, zero net liquidation, or no cash figure', () => {
    expect(allocationFor(null, 'KO', 9000)).toBeNull();
    expect(allocationFor({ netLiq: 0, bySymbol: {} }, 'KO', 9000)).toBeNull();
    expect(allocationFor(book, 'KO', null)).toBeNull();
  });
});
