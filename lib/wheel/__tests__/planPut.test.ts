// lib/wheel/__tests__/planPut.test.ts
//
// WHEEL-SYSTEM-0001 (W1) -- the put the plan prices and the honest state of each ladder row.

import { describe, expect, it } from 'vitest';
import type { WheelChainLeg, WheelChainResult } from '../chainSearch';
import { classifyRow, selectPlanPut } from '../planPut';

const leg = (over: Partial<WheelChainLeg>): WheelChainLeg => ({
  strikePrice: 50, expirationDate: '2026-11-06', optionType: 'P', delta: -0.2, openInterest: 100, bid: 0.5, ask: 0.6, mid: 0.55, occSymbol: 'X', ...over,
});
const chainOf = (legs: WheelChainLeg[], failedBatches?: number): WheelChainResult => {
  const chains: Record<string, WheelChainLeg[]> = {};
  for (const l of legs) (chains[l.expirationDate] ??= []).push(l);
  return { expirations: Object.keys(chains).sort(), chains, failedBatches };
};

describe('selectPlanPut', () => {
  it('picks the put whose absolute delta is nearest the target', () => {
    const chain = chainOf([leg({ strikePrice: 48, delta: -0.14 }), leg({ strikePrice: 50, delta: -0.19 }), leg({ strikePrice: 52, delta: -0.27 })]);
    expect(selectPlanPut(chain, 2000)?.leg.strikePrice).toBe(50);
  });
  it('ignores calls, legs with no delta, and dead quotes (bid 0 and ask 0)', () => {
    const chain = chainOf([
      leg({ strikePrice: 50, optionType: 'C', delta: 0.2 }),
      leg({ strikePrice: 51, delta: null }),
      leg({ strikePrice: 52, delta: -0.2, bid: 0, ask: 0 }),
      leg({ strikePrice: 47, delta: -0.16 }),
    ]);
    expect(selectPlanPut(chain, 2000)?.leg.strikePrice).toBe(47);
  });
  it('a bid of 0 with a real ask is still a quote', () => {
    expect(selectPlanPut(chainOf([leg({ strikePrice: 50, bid: 0, ask: 0.1 })]), 2000)?.leg.strikePrice).toBe(50);
  });
  it('a tie in delta goes to the nearer expiry', () => {
    const chain = chainOf([leg({ expirationDate: '2026-12-04', strikePrice: 49, delta: -0.22 }), leg({ expirationDate: '2026-11-06', strikePrice: 50, delta: -0.18 })]);
    expect(selectPlanPut(chain, 2000)?.expirationDate).toBe('2026-11-06');
  });
  it('a tie in delta within one expiry goes to the lower strike', () => {
    const chain = chainOf([leg({ strikePrice: 51, delta: -0.22 }), leg({ strikePrice: 49, delta: -0.18 })]);
    expect(selectPlanPut(chain, 2000)?.leg.strikePrice).toBe(49);
  });
  it('a put further than 0.10 from the target is not used', () => {
    expect(selectPlanPut(chainOf([leg({ delta: -0.05 }), leg({ delta: -0.45 })]), 2000)).toBeNull();
    expect(selectPlanPut(chainOf([leg({ delta: -0.10 })]), 2000)).not.toBeNull();
    expect(selectPlanPut(chainOf([leg({ delta: -0.30 })]), 2000)).not.toBeNull();
    expect(selectPlanPut(chainOf([leg({ delta: -0.3001 })]), 2000)).toBeNull();
  });
  it('an empty chain finds nothing', () => {
    expect(selectPlanPut({ expirations: [], chains: {} }, 2000)).toBeNull();
  });
});

describe('classifyRow: a failure never looks like "no put found"', () => {
  const good = chainOf([leg({})]);
  it('ok when a put is found, even without a quote', () => {
    expect(classifyRow({ quote: 54.8, chain: good, chainError: null }, 2000).kind).toBe('ok');
    expect(classifyRow({ quote: null, chain: good, chainError: null }, 2000).kind).toBe('ok');
  });
  it('chain error when the chain fetch threw', () => {
    expect(classifyRow({ quote: 54.8, chain: null, chainError: 'boom' }, 2000)).toEqual({ kind: 'chain-error', message: 'boom' });
  });
  it('chain error when there is no chain at all', () => {
    expect(classifyRow({ quote: 54.8, chain: null, chainError: null }, 2000).kind).toBe('chain-error');
  });
  it('chain error when a quote batch failed and no put could be chosen (not "no put")', () => {
    expect(classifyRow({ quote: 54.8, chain: chainOf([], 1), chainError: null }, 2000).kind).toBe('chain-error');
  });
  it('a failed batch does not hide a put that was found', () => {
    expect(classifyRow({ quote: 54.8, chain: chainOf([leg({})], 1), chainError: null }, 2000).kind).toBe('ok');
  });
  it('quote unavailable when nothing was found and the quote is missing', () => {
    expect(classifyRow({ quote: null, chain: chainOf([], 0), chainError: null }, 2000).kind).toBe('quote-unavailable');
  });
  it('no put found only when the chain loaded cleanly and nothing is near the target', () => {
    expect(classifyRow({ quote: 54.8, chain: chainOf([leg({ delta: -0.05 })], 0), chainError: null }, 2000).kind).toBe('no-put');
  });
});
