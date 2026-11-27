// lib/scans/__tests__/ccLotLoss.test.ts
//
// CC-LOTS-0001 (Alan's two-lot fixture): TQQQ-shaped lots, $75.50 bought Nov 4 and $82.00 bought earlier.
// FIFO delivers the older $82.00 lot first.

import { describe, expect, it } from 'vitest';
import { ccLotLossLine, computeCcLotLoss } from '../ccLotLoss';

const lots = [
  { shares: 100, price: 75.5, day: '2026-11-04' },
  { shares: 100, price: 82, day: '2026-10-20' },
];

describe('computeCcLotLoss', () => {
  it('one contract: FIFO delivers the older $82 lot, not the $78.75 average', () => {
    const r = computeCcLotLoss({ lots, strike: 55, premiumPerShare: 0.91, contracts: 1 })!;
    expect(r.oldestLotPrice).toBe(82);
    expect(r.deliveredAveragePrice).toBe(82);
    expect(r.spansLots).toBe(false);
    expect(r.gainBeforePremium).toBe(-2700);
    expect(r.premium).toBe(91);
    expect(r.gainWithPremium).toBe(-2609);
    expect(r.sellAtPrice).toBe(55.91);
    expect(r.highestLotPrice).toBe(82);
  });

  it('two contracts: both lots are delivered, averaged', () => {
    const r = computeCcLotLoss({ lots, strike: 55, premiumPerShare: 0.91, contracts: 2 })!;
    expect(r.deliveredAveragePrice).toBe(78.75);
    expect(r.spansLots).toBe(true);
    expect(r.gainBeforePremium).toBe(-4750);
    expect(r.gainWithPremium).toBe(-4568);
  });

  it('lots are ordered oldest first regardless of the order given', () => {
    const swapped = [lots[1], lots[0]];
    expect(computeCcLotLoss({ lots: swapped, strike: 55, premiumPerShare: 0.91, contracts: 1 })!.oldestLotPrice).toBe(82);
  });

  it('the highest lot is the below-cost yardstick even when it is not the oldest', () => {
    const r = computeCcLotLoss({ lots: [{ shares: 100, price: 70, day: '2026-01-01' }, { shares: 100, price: 82, day: '2026-02-01' }], strike: 75, premiumPerShare: 1, contracts: 1 })!;
    expect(r.oldestLotPrice).toBe(70);
    expect(r.highestLotPrice).toBe(82);
    expect(r.gainBeforePremium).toBe(500); // the delivered (older) lot is at a gain
  });

  it('a partial lot: 100 shares of a 150-share lot', () => {
    const r = computeCcLotLoss({ lots: [{ shares: 150, price: 20, day: '2026-01-01' }], strike: 22, premiumPerShare: 0.5, contracts: 1 })!;
    expect(r.gainBeforePremium).toBe(200);
    expect(r.gainWithPremium).toBe(250);
  });

  it('returns null when the lots cannot cover the calls or are unusable', () => {
    expect(computeCcLotLoss({ lots, strike: 55, premiumPerShare: 0.91, contracts: 3 })).toBeNull();
    expect(computeCcLotLoss({ lots: [], strike: 55, premiumPerShare: 0.91, contracts: 1 })).toBeNull();
    expect(computeCcLotLoss({ lots: [{ shares: 100, price: NaN, day: '2026-01-01' }], strike: 55, premiumPerShare: 0.91, contracts: 1 })).toBeNull();
    expect(computeCcLotLoss({ lots, strike: 55, premiumPerShare: 0.91, contracts: 0 })).toBeNull();
  });
});

describe('ccLotLossLine', () => {
  it('uses plain words with and without the premium (Diane)', () => {
    const r = computeCcLotLoss({ lots, strike: 55, premiumPerShare: 0.91, contracts: 1 })!;
    expect(ccLotLossLine(r)).toBe('You collect $91 · if called, you sell at $55.91 · you lose $2,609 on your oldest shares ($2,700 without the $91)');
  });

  it('says so when the premium turns a loss into a gain', () => {
    const r = computeCcLotLoss({ lots: [{ shares: 100, price: 20, day: '2026-01-01' }], strike: 19.5, premiumPerShare: 1, contracts: 1 })!;
    expect(ccLotLossLine(r)).toBe('You collect $100 · if called, you sell at $20.50 · you make $50 on your oldest shares (a $50 loss without the $100)');
  });

  it('a gain on the delivered shares', () => {
    const r = computeCcLotLoss({ lots: [{ shares: 100, price: 20, day: '2026-01-01' }], strike: 25, premiumPerShare: 0.5, contracts: 1 })!;
    expect(ccLotLossLine(r)).toContain('you make $550 on your oldest shares ($500 without the $50)');
  });
});
