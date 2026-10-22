// lib/entry-walk/__tests__/ladder.test.ts

import { describe, expect, it } from 'vitest';
import { buildWalkLadder, priceStillValid, type LadderInput } from '../ladder';
import type { TickTable } from '@/lib/portfolio/tickSize';

const COARSE: TickTable = [{ threshold: 3, value: 0.01 }, { threshold: null, value: 0.05 }];
const base = (over: Partial<LadderInput>): LadderInput => ({
  side: 'credit', netBid: 1.2, netAsk: 1.4, legSpreads: [0.1, 0.1], tickTable: null, ...over,
});
const prices = (input: LadderInput) => {
  const r = buildWalkLadder(input);
  if (!r.ok) throw new Error(`ladder refused: ${r.reason}`);
  return r.prices;
};

describe("Alan's ENTRY-WALK-0001 fixtures", () => {
  it('credit 2-leg', () => expect(prices(base({}))).toEqual([1.37, 1.36, 1.34, 1.32, 1.3]));
  it('credit 4-leg condor', () => expect(prices(base({ netBid: 2.1, netAsk: 2.5, legSpreads: [0.1, 0.1, 0.1, 0.1] }))).toEqual([2.45, 2.41, 2.37, 2.34, 2.3]));
  it('CSP single leg', () => expect(prices(base({ netBid: 0.85, netAsk: 1.05, legSpreads: [0.1] }))).toEqual([1.02, 1.01, 0.99, 0.97, 0.95]));
  it('coarse tick drops the duplicate', () => expect(prices(base({ netBid: 3.3, netAsk: 3.7, tickTable: COARSE, legSpreads: [0.1] }))).toEqual([3.65, 3.6, 3.55, 3.5]));
  it('minimum-credit floor above the mid', () => expect(prices(base({ netBid: 0.85, netAsk: 1.1, minCredit: 1.0, legSpreads: [0.1] }))).toEqual([1.07, 1.05, 1.03, 1.02, 1.0]));
  it('floor at or above the start does not start', () => {
    const r = buildWalkLadder(base({ netBid: 0.85, netAsk: 1.0, minCredit: 1.0, legSpreads: [0.1] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('floor_not_below_start');
  });
  it('debit 2-leg mirrors upward', () => expect(prices(base({ side: 'debit', netBid: 2.0, netAsk: 2.4, legSpreads: [0.1, 0.1] }))).toEqual([2.05, 2.09, 2.13, 2.16, 2.2]));
  it('very tight market', () => expect(prices(base({ netBid: 1.28, netAsk: 1.32, legSpreads: [0.04] }))).toEqual([1.31, 1.3]));
});

describe('ladder safety', () => {
  it('never goes below the floor and is strictly descending (credit)', () => {
    for (const [bid, ask] of [[1.2, 1.4], [0.5, 0.7], [2.1, 2.5], [0.99, 1.07], [1.2, 1.35]]) {
      const r = buildWalkLadder(base({ netBid: bid, netAsk: ask }));
      if (!r.ok) continue;
      expect(Math.min(...r.prices)).toBeGreaterThanOrEqual(r.end);
      for (let i = 1; i < r.prices.length; i++) expect(r.prices[i]).toBeLessThan(r.prices[i - 1]);
    }
  });
  it('never goes above the ceiling and is strictly ascending (debit)', () => {
    const r = buildWalkLadder(base({ side: 'debit', netBid: 2.0, netAsk: 2.4, maxDebit: 2.12 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Math.max(...r.prices)).toBeLessThanOrEqual(2.12);
      for (let i = 1; i < r.prices.length; i++) expect(r.prices[i]).toBeGreaterThan(r.prices[i - 1]);
    }
  });
  it('a half-cent mid never rounds below the floor', () => {
    const r = buildWalkLadder(base({ netBid: 1.2, netAsk: 1.41, legSpreads: [0.1] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.prices[r.prices.length - 1]).toBeGreaterThanOrEqual(1.305);
  });
  it('does not start when any single leg is wider than $0.10', () => {
    const r = buildWalkLadder(base({ legSpreads: [0.05, 0.28] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('leg_too_wide');
  });
  it('WALK-WIDTH-0001: the reported NVDL 27P ($0.16 wide, about 12.6% of a $1.27 mid) walks when the scan limit is passed', () => {
    const r = buildWalkLadder(base({ netBid: 1.19, netAsk: 1.35, legSpreads: [0.16], maxLegSpread: 0.19 }));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.prices[0]).toBeLessThanOrEqual(1.35); expect(r.prices[r.prices.length - 1]).toBeGreaterThanOrEqual(1.27); }
  });
  it('WALK-WIDTH-0001: without the scan limit the flat $0.10 still applies, and the message shows the limit in force', () => {
    const r = buildWalkLadder(base({ netBid: 1.19, netAsk: 1.35, legSpreads: [0.16] }));
    expect(r).toMatchObject({ ok: false, reason: 'leg_too_wide', message: 'One leg is $0.16 wide, over the $0.10 limit.' });
  });
  it('WALK-WIDTH-0001: a leg wider than the scan limit is still refused, and a limit below $0.10 never tightens the default', () => {
    expect(buildWalkLadder(base({ legSpreads: [0.25], maxLegSpread: 0.19 })).ok).toBe(false);
    expect(buildWalkLadder(base({ legSpreads: [0.1], maxLegSpread: 0.05 })).ok).toBe(true);
    expect(buildWalkLadder(base({ legSpreads: [0.1], maxLegSpread: null })).ok).toBe(true);
  });
  it('does not start on a missing or crossed quote', () => {
    expect(buildWalkLadder(base({ netBid: 0 })).ok).toBe(false);
    expect(buildWalkLadder(base({ netBid: 1.5, netAsk: 1.4 })).ok).toBe(false);
    expect(buildWalkLadder(base({ netBid: NaN })).ok).toBe(false);
  });
});

describe('priceStillValid', () => {
  it('credit: valid at or above the fresh floor, invalid below it', () => {
    expect(priceStillValid(base({}), 1.3)).toBe(true);
    expect(priceStillValid(base({ netBid: 1.3, netAsk: 1.5 }), 1.3)).toBe(false); // mid rose to 1.40
  });
  it('debit: valid at or below the fresh ceiling', () => {
    expect(priceStillValid(base({ side: 'debit', netBid: 2.0, netAsk: 2.4 }), 2.2)).toBe(true);
    expect(priceStillValid(base({ side: 'debit', netBid: 1.8, netAsk: 2.0 }), 2.2)).toBe(false);
  });
});
