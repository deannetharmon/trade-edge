// lib/wheel/__tests__/planPut.test.ts
//
// WHEEL-SYSTEM-0001 (W1) -- the put the plan prices (the best-paying put in the delta band) and the honest state of each row.

import { describe, expect, it } from 'vitest';
import type { WheelChainLeg, WheelChainResult } from '../chainSearch';
import { classifyRow, selectPlanPut } from '../planPut';

const TODAY = '2026-09-26';
const BAND = { minBps: 2500, maxBps: 3000 };

const leg = (over: Partial<WheelChainLeg>): WheelChainLeg => ({
  strikePrice: 50, expirationDate: '2026-11-06', optionType: 'P', delta: -0.27, openInterest: 100, bid: 0.5, ask: 0.6, mid: 0.55, occSymbol: 'X', ...over,
});
const chainOf = (legs: WheelChainLeg[], failedBatches?: number): WheelChainResult => {
  const chains: Record<string, WheelChainLeg[]> = {};
  for (const l of legs) (chains[l.expirationDate] ??= []).push(l);
  return { expirations: Object.keys(chains).sort(), chains, failedBatches };
};

describe('selectPlanPut: the best-paying put whose delta is in the band', () => {
  it('picks the highest Annual ROC in the band, ignoring puts outside it', () => {
    const chain = chainOf([
      leg({ strikePrice: 50, delta: -0.2, bid: 0.9 }), // out of band, pays the most
      leg({ strikePrice: 49, delta: -0.26, bid: 0.6 }),
      leg({ strikePrice: 48, delta: -0.3, bid: 0.75 }),
      leg({ strikePrice: 47, delta: -0.33, bid: 1.2 }), // out of band
    ]);
    const put = selectPlanPut(chain, BAND, TODAY);
    expect(put?.leg.strikePrice).toBe(48);
    expect(put?.dte).toBe(41);
    expect(put?.rocBps).toBe(Math.floor((7500 * 365 * 10_000) / (480_000 * 41)));
  });

  it('the band edges are inclusive: 0.25 and 0.30 are in, 0.2499 and 0.3001 are out', () => {
    expect(selectPlanPut(chainOf([leg({ delta: -0.25 })]), BAND, TODAY)).not.toBeNull();
    expect(selectPlanPut(chainOf([leg({ delta: -0.3 })]), BAND, TODAY)).not.toBeNull();
    expect(selectPlanPut(chainOf([leg({ delta: -0.2499 })]), BAND, TODAY)).toBeNull();
    expect(selectPlanPut(chainOf([leg({ delta: -0.3001 })]), BAND, TODAY)).toBeNull();
  });

  it('compares expiries by annualized ROC, so a shorter expiry with the same credit wins', () => {
    const chain = chainOf([
      leg({ expirationDate: '2026-11-06', strikePrice: 50, delta: -0.27, bid: 0.5 }), // 41 days
      leg({ expirationDate: '2026-10-30', strikePrice: 50, delta: -0.27, bid: 0.5 }), // 34 days
    ]);
    expect(selectPlanPut(chain, BAND, TODAY)?.expirationDate).toBe('2026-10-30');
  });

  it('a longer expiry wins when it pays enough more', () => {
    const chain = chainOf([
      leg({ expirationDate: '2026-11-06', strikePrice: 50, delta: -0.27, bid: 0.9 }),
      leg({ expirationDate: '2026-10-30', strikePrice: 50, delta: -0.27, bid: 0.5 }),
    ]);
    expect(selectPlanPut(chain, BAND, TODAY)?.expirationDate).toBe('2026-11-06');
  });

  it('ignores calls, legs with no delta, dead quotes, and puts with no bid to collect', () => {
    const chain = chainOf([
      leg({ strikePrice: 50, optionType: 'C', delta: 0.27, bid: 5 }),
      leg({ strikePrice: 51, delta: null, bid: 5 }),
      leg({ strikePrice: 52, delta: -0.27, bid: 0, ask: 0 }),
      leg({ strikePrice: 53, delta: -0.27, bid: 0, ask: 0.1 }),
      leg({ strikePrice: 47, delta: -0.26, bid: 0.4 }),
    ]);
    expect(selectPlanPut(chain, BAND, TODAY)?.leg.strikePrice).toBe(47);
  });

  it('a tie in ROC goes to the lower delta, then the nearer expiry, then the lower strike', () => {
    const sameRoc = chainOf([leg({ delta: -0.29, bid: 0.5 }), leg({ delta: -0.26, bid: 0.5 })]);
    expect(selectPlanPut(sameRoc, BAND, TODAY)?.deltaBps).toBe(2600);
  });

  it('skips an expiry that is today or past', () => {
    expect(selectPlanPut(chainOf([leg({ expirationDate: '2026-09-26' })]), BAND, TODAY)).toBeNull();
    expect(selectPlanPut(chainOf([leg({ expirationDate: '2026-09-25' })]), BAND, TODAY)).toBeNull();
    expect(selectPlanPut(chainOf([leg({ expirationDate: '2026-09-27' })]), BAND, TODAY)?.dte).toBe(1);
  });

  it('an empty chain finds nothing', () => {
    expect(selectPlanPut({ expirations: [], chains: {} }, BAND, TODAY)).toBeNull();
  });
});

describe('classifyRow: a failure never looks like "no put found"', () => {
  const good = chainOf([leg({})]);
  it('ok when a put is found, even without a quote', () => {
    expect(classifyRow({ quote: 54.8, chain: good, chainError: null }, BAND, TODAY).kind).toBe('ok');
    expect(classifyRow({ quote: null, chain: good, chainError: null }, BAND, TODAY).kind).toBe('ok');
  });
  it('chain error when the chain fetch threw', () => {
    expect(classifyRow({ quote: 54.8, chain: null, chainError: 'boom' }, BAND, TODAY)).toEqual({ kind: 'chain-error', message: 'boom' });
  });
  it('chain error when there is no chain at all', () => {
    expect(classifyRow({ quote: 54.8, chain: null, chainError: null }, BAND, TODAY).kind).toBe('chain-error');
  });
  it('chain error when a quote batch failed and no put could be chosen (not "no put")', () => {
    expect(classifyRow({ quote: 54.8, chain: chainOf([], 1), chainError: null }, BAND, TODAY).kind).toBe('chain-error');
  });
  it('a failed batch does not hide a put that was found', () => {
    expect(classifyRow({ quote: 54.8, chain: chainOf([leg({})], 1), chainError: null }, BAND, TODAY).kind).toBe('ok');
  });
  it('quote unavailable when nothing was found and the quote is missing', () => {
    expect(classifyRow({ quote: null, chain: chainOf([], 0), chainError: null }, BAND, TODAY).kind).toBe('quote-unavailable');
  });
  it('no put found only when the chain loaded cleanly and nothing is in the band', () => {
    expect(classifyRow({ quote: 54.8, chain: chainOf([leg({ delta: -0.05 })], 0), chainError: null }, BAND, TODAY).kind).toBe('no-put');
  });
});
