// lib/scans/__tests__/pmccCompare.test.ts

import { describe, expect, it } from 'vitest';
import { blackScholesCall, buildPmccCompare, impliedCallIv, type CompareCandidate } from '../pmccCompare';

const uberCalls: CompareCandidate[] = [
  { id: 'u77', strike: 77, dte: 38, delta: 0.20, credit: 0.86 },
  { id: 'u78', strike: 78, dte: 38, delta: 0.17, credit: 0.71 },
  { id: 'u79', strike: 79, dte: 38, delta: 0.14, credit: 0.58 },
];
const uber = { spot: 68.68, longStrike: 67.5, longDte: 312, longValue: 11.35, paid: 21.3, quantity: 1, candidates: uberCalls };

describe('impliedCallIv', () => {
  it('backs out the IV that reproduces the value', () => {
    const iv = impliedCallIv(68.68, 67.5, 312 / 365, 11.35, 0.04) as number;
    expect(iv).toBeGreaterThan(0.37);
    expect(iv).toBeLessThan(0.41);
    expect(blackScholesCall(68.68, 67.5, 312 / 365, iv, 0.04)).toBeCloseTo(11.35, 3);
  });
  it('is null for a value the model cannot price', () => {
    expect(impliedCallIv(68.68, 67.5, 1, 0, 0.04)).toBeNull();
    expect(impliedCallIv(68.68, 67.5, 1, 90, 0.04)).toBeNull();
  });
});

describe('buildPmccCompare: UBER fixture (one contract, under water)', () => {
  const c = buildPmccCompare(uber)!;
  it('measures against what you paid', () => {
    expect(c.paidTotal).toBeCloseTo(2130, 6);
    expect(c.worthTotal).toBeCloseTo(1135, 6);
    expect(c.downVsPaid).toBeCloseTo(-995, 6);
    expect(c.underwater).toBe(true);
  });
  it('offers No call, never defaults to it, and defaults to the farthest strike when under water', () => {
    expect(c.options.map(o => o.stance)).toEqual(['none', 'bullish', 'neutral', 'cautious']);
    expect(c.defaultStance).toBe('bullish');
    expect(c.options.find(o => o.stance === 'bullish')!.candidate!.strike).toBe(79);
    expect(c.options.find(o => o.stance === 'cautious')!.candidate!.strike).toBe(77);
  });
  it('credits and odds come from the quotes and delta', () => {
    const b = c.options.find(o => o.stance === 'bullish')!;
    expect(b.collect).toBeCloseTo(58, 6);
    expect(b.oddsWorthless).toBeCloseTo(0.86, 6);
    expect(b.oddsAbove).toBeCloseTo(0.14, 6);
    expect(b.clearsMinimumCredit).toBe(true);
  });
  it('scenario P/L vs paid matches the approved mock within model tolerance', () => {
    const none = c.options[0].scenarios!;
    expect(none.map(s => s.label)).toEqual(['Unchanged', 'Up 5%', 'Up 10%', '10% above $79']);
    expect(none[2].spot).toBeCloseTo(75.548, 3);
    expect(none[3].spot).toBeCloseTo(86.9, 6);
    expect(none[0].noCall).toBeGreaterThan(-1120);
    expect(none[0].noCall).toBeLessThan(-1010);
    // Up 10% ($75.55) is still under every strike: no call is ever in play.
    expect(none[2].noCall).toBeGreaterThan(-700);
    expect(none[2].noCall).toBeLessThan(-500);
    expect(none[3].noCall).toBeGreaterThan(200);
    expect(none[3].noCall).toBeLessThan(400);
    const b = c.options.find(o => o.stance === 'bullish')!.scenarios!;
    // Unchanged: the call expires worthless, so the only change is the credit.
    expect(b[0].withCall! - b[0].noCall).toBeCloseTo(58, 6);
    // Up 10% ($75.55) is under the $79 strike: only the credit differs.
    expect(b[2].withCall! - b[2].noCall).toBeCloseTo(58, 6);
    // 10% past the highest strike ($86.90): credit minus intrinsic.
    expect(b[3].withCall! - b[3].noCall).toBeCloseTo(58 - (86.9 - 79) * 100, 4);
    // Past the strikes, the call gives up what the unhedged LEAP would have made.
    expect(b[3].withCall!).toBeLessThan(b[3].noCall);
  });
});

describe('buildPmccCompare: other cases', () => {
  it('defaults to neutral at or above cost', () => {
    const rich = uberCalls.map(x => ({ ...x, credit: x.credit * 2 }));
    const c = buildPmccCompare({ ...uber, longValue: 24, paid: 21.3, candidates: rich })!;
    expect(c.underwater).toBe(false);
    expect(c.defaultStance).toBe('neutral');
    expect(c.verdict.headline).toBe('Sell the $78 call for $142.');
  });
  it('one candidate: single bullish option plus No call', () => {
    const c = buildPmccCompare({ ...uber, candidates: [uberCalls[2]] })!;
    expect(c.options.map(o => o.stance)).toEqual(['none', 'bullish']);
  });
  it('no usable candidate: only No call, default none', () => {
    const c = buildPmccCompare({ ...uber, candidates: [{ id: 'x', strike: 60, dte: 38, delta: 0.5, credit: 5 }] })!;
    expect(c.options.map(o => o.stance)).toEqual(['none']);
    expect(c.defaultStance).toBe('none');
  });
  it('never defaults to a call that fails the minimum credit: No call, with a plain reason', () => {
    const weak = [{ id: 'a', strike: 90, dte: 38, delta: 0.03, credit: 0.01 }, { id: 'b', strike: 77, dte: 38, delta: 0.2, credit: 0.11 }];
    const c = buildPmccCompare({ ...uber, candidates: weak })!;
    expect(c.defaultStance).toBe('none');
    expect(c.verdict.kind).toBe('none');
    expect(c.verdict.headline).toBe("Don't sell a call right now.");
    expect(c.verdict.reason).toContain('None of the calls pays enough. The best pays $11 per contract');
  });
  it('picks the farthest paying call when under water, skipping calls that fail the minimum', () => {
    const mixed = [{ id: 'a', strike: 90, dte: 38, delta: 0.03, credit: 0.01 }, ...uberCalls];
    const c = buildPmccCompare({ ...uber, candidates: mixed })!;
    expect(c.verdict.kind).toBe('sell');
    expect(c.verdict.headline).toBe('Sell the $79 call for $58.');
  });
  it('verdict names the number of contracts when there is more than one', () => {
    const c = buildPmccCompare({ ...uber, quantity: 2 })!;
    expect(c.verdict.headline).toBe('Sell 2 $79 calls for $116.');
  });
  it('gives each call a payoff curve that matches the scenario math and flattens above the strike', () => {
    const c = buildPmccCompare(uber)!;
    const o = c.options.find(x => x.stance === 'bullish')!;
    expect(o.curve!.length).toBeGreaterThan(10);
    expect(c.options[0].curve).toBeNull();
    const first = o.curve![0];
    expect(first.withCall - first.noCall).toBeCloseTo(58, 6);
    const last = o.curve![o.curve!.length - 1];
    expect(last.withCall).toBeLessThan(last.noCall);
  });
  it('scales dollars by contracts', () => {
    const c = buildPmccCompare({ ...uber, quantity: 2 })!;
    expect(c.paidTotal).toBeCloseTo(4260, 6);
    expect(c.options.find(o => o.stance === 'bullish')!.collect).toBeCloseTo(116, 6);
  });
  it('flags a credit under the minimum', () => {
    const c = buildPmccCompare({ ...uber, candidates: [{ id: 'low', strike: 80, dte: 38, delta: 0.1, credit: 0.2 }] })!;
    expect(c.options[1].clearsMinimumCredit).toBe(false);
  });
  it('uses one expiration cycle: the one most calls share', () => {
    const mixed = [...uberCalls, { id: 'far', strike: 90, dte: 100, delta: 0.1, credit: 1 }];
    const c = buildPmccCompare({ ...uber, candidates: mixed })!;
    expect(c.shortDte).toBe(38);
    expect(c.options.every(o => o.candidate == null || o.candidate.dte === 38)).toBe(true);
  });
  it('drops strikes at or below the LEAP strike (not covered)', () => {
    const c = buildPmccCompare({ ...uber, candidates: [{ id: 'low', strike: 67.5, dte: 38, delta: 0.5, credit: 4 }, uberCalls[0]] })!;
    expect(c.options.map(o => o.candidate?.strike ?? null)).toEqual([null, 77]);
  });
  it('is null when cost, value or price is missing', () => {
    expect(buildPmccCompare({ ...uber, paid: null })).toBeNull();
    expect(buildPmccCompare({ ...uber, longValue: undefined })).toBeNull();
    expect(buildPmccCompare({ ...uber, spot: null })).toBeNull();
  });
  it('keeps odds and credits when the IV cannot be solved, with no scenarios', () => {
    const c = buildPmccCompare({ ...uber, longValue: 0.01 })!;
    expect(c.ivPct).toBeNull();
    expect(c.options[1].scenarios).toBeNull();
    expect(c.options[1].oddsWorthless).not.toBeNull();
  });
});
