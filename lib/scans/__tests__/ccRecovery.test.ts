import { describe, expect, it } from 'vitest';
import { buildCcAllRows, type CcAllRow } from '../ccAllCalls';
import { calledOneIn, oldestLot, recoveryCandidates, recoveryChart, recoveryGap, weeksToCover } from '../ccRecovery';
import type { ChainRow } from '@/lib/tradeLookup/lookupTypes';

const lots = [{ shares: 100, price: 75.5, day: '2026-11-04' }, { shares: 100, price: 82, day: '2026-01-05' }];
const leg = (strike: number, bid: number, ask: number, delta: number, exp = '2026-12-04', oi = 500): ChainRow => ({
  strike, right: 'C', expiration: exp, bid, ask, delta, openInterest: oi, iv: null, occSymbol: `T${strike}${exp}`, quoteUpdatedAt: null,
});
const rows = (dte: number, legs: ChainRow[]): CcAllRow[] => buildCcAllRows({ rows: legs, dte, stockPrice: 48.69, floorBasis: 82, lots, minPayChip: 25 });

describe('recoveryGap', () => {
  it('adds up shares x the gap for each lot above the price', () => {
    expect(recoveryGap(lots, 48.69)).toBe(6012);
  });
  it('ignores a lot at or under the price', () => {
    expect(recoveryGap([...lots, { shares: 100, price: 40, day: '2026-02-01' }], 48.69)).toBe(6012);
  });
});

describe('oldestLot', () => {
  it('is the lot FIFO delivers first', () => expect(oldestLot(lots)?.price).toBe(82));
  it('is null with no lots', () => expect(oldestLot([])).toBeNull());
});

describe('recoveryChart', () => {
  const c = recoveryChart({ cost: 82, price: 48.69, strike: 51, premiumPerShare: 0.78 });
  it('hold, call and exit are the profit or loss on 100 oldest shares', () => {
    expect(c.exitNow).toBe(-3331);
    expect(c.hold(40)).toBe(-4200);
    expect(c.call(40)).toBe(-4122);
    expect(c.call(51)).toBe(-3022);
    expect(c.call(70)).toBe(-3022);
  });
  it('gives the two crossover prices', () => {
    expect(c.holdBeatsCallAbove).toBe(51.78);
    expect(c.exitBeatsCallBelow).toBe(47.91);
    expect(c.hold(51.78)).toBe(c.call(51.78));
  });
});

describe('recoveryCandidates', () => {
  it('keeps weekly calls in the delta band, drops the rest, and ranks by pay per day', () => {
    const r = rows(7, [leg(51, 0.77, 0.79, 0.25), leg(52, 0.61, 0.63, 0.21), leg(53, 0.47, 0.49, 0.17), leg(54, 0.36, 0.38, 0.12), leg(50, 1.1, 1.12, 0.35)]);
    const c = recoveryCandidates(r);
    expect(c.map(x => x.strike)).toEqual([51, 52, 53]);
    expect(c[0].perDay).toBe(11.14);
    expect(c[0].salePrice).toBe(51.78);
  });
  it('drops dates outside 5 to 21 days', () => {
    expect(recoveryCandidates(rows(3, [leg(51, 0.77, 0.79, 0.25)]))).toEqual([]);
    expect(recoveryCandidates(rows(30, [leg(51, 0.77, 0.79, 0.25)]))).toEqual([]);
  });
  it('drops a call under the stock price, a wide price gap, a thin payout and a missing delta', () => {
    const r = rows(7, [leg(47, 2, 2.05, 0.2), leg(55, 0.1, 0.4, 0.2), leg(60, 0.1, 0.12, 0.2), { ...leg(52, 0.6, 0.62, 0.2), delta: null }]);
    expect(recoveryCandidates(r)).toEqual([]);
  });
});

describe('calledOneIn / weeksToCover', () => {
  it('turns a delta into a plain "1 in N"', () => {
    expect(calledOneIn(0.25)).toBe(4);
    expect(calledOneIn(0.2)).toBe(5);
    expect(calledOneIn(null)).toBeNull();
    expect(calledOneIn(0)).toBeNull();
  });
  it('counts weeks of premium to cover the gap', () => {
    expect(weeksToCover(6012, 156)).toBe(39);
    expect(weeksToCover(6012, 0)).toBeNull();
    expect(weeksToCover(0, 156)).toBeNull();
  });
});
