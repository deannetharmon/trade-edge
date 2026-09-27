// lib/wheel/__tests__/candidateRank.test.ts
//
// WHEEL-SYSTEM-0002 (W2) -- checks, verdict precedence, earnings states and order. Alan's edges, Quinn's unknown states.

import { describe, expect, it } from 'vitest';
import type { WheelChainLeg } from '../chainSearch';
import { resolveParams } from '../capitalPlan';
import {
  classifyEarnings,
  evaluateCandidate,
  ivrToHundredths,
  rankCandidates,
  rsiToHundredths,
  type CandidateInput,
  type EarningsState,
} from '../candidateRank';
import type { PlanPut } from '../planPut';

const TODAY = '2026-09-26';
const params = resolveParams();

const leg = (over: Partial<WheelChainLeg> = {}): WheelChainLeg => ({
  strikePrice: 51, expirationDate: '2026-10-26', optionType: 'P', delta: -0.27, openInterest: 500, bid: 0.85, ask: 0.89, mid: 0.87, occSymbol: 'X', ...over,
});
const putOf = (rocBps: number, l: WheelChainLeg = leg()): PlanPut => ({ leg: l, expirationDate: l.expirationDate, deltaBps: 2700, dte: 30, rocBps });

const input = (over: Partial<CandidateInput> = {}): CandidateInput => ({
  symbol: 'XLF', instrument: 'etf', put: putOf(2027), cashCents: 510_000, ivrHundredths: 3100, rsiHundredths: 5500,
  earnings: { kind: 'not-applicable' }, fits: true, forced: false, fitsAtCents: 1_700_000, notYetReason: 'Unlocks in 8 months', notFitText: 'Cash $16,200, over your $15,000 limit', ...over,
});
const verdictOf = (over: Partial<CandidateInput> = {}, p = params) => evaluateCandidate(input(over), p).verdict;

describe('unit conversions', () => {
  it('IVR percent to hundredths, safe against float error', () => {
    expect(ivrToHundredths(38.5)).toBe(3850);
    expect(ivrToHundredths(0.29 * 100)).toBe(2900); // 28.999999999999996 in floats
    expect(ivrToHundredths(0)).toBe(0);
    expect(ivrToHundredths(100)).toBe(10_000);
  });
  it('IVR outside 0 to 100, missing or non-finite is unknown', () => {
    expect(ivrToHundredths(-1)).toBeNull();
    expect(ivrToHundredths(101)).toBeNull();
    expect(ivrToHundredths(null)).toBeNull();
    expect(ivrToHundredths(Number.NaN)).toBeNull();
  });
  it('RSI hundredths from closes: too few or bad closes is unknown; a flat series is 50.00', () => {
    expect(rsiToHundredths([1, 2, 3])).toBeNull();
    expect(rsiToHundredths(null)).toBeNull();
    expect(rsiToHundredths(Array.from({ length: 30 }, () => 10))).toBe(5000);
    expect(rsiToHundredths([...Array.from({ length: 29 }, () => 10), Number.NaN])).toBeNull();
  });
  it('RSI of a steadily rising series is high', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    expect(rsiToHundredths(closes)).toBe(10_000);
  });
});

describe('earnings timing', () => {
  const state = (over: Partial<Parameters<typeof classifyEarnings>[0]>): EarningsState =>
    classifyEarnings({ instrument: 'stock', dataAvailable: true, date: '2026-12-01', expiration: '2026-11-06', today: TODAY, ...over });

  it('an ETF or index has none', () => {
    expect(state({ instrument: 'etf', date: '2026-10-01' })).toEqual({ kind: 'not-applicable' });
  });
  it('on or before the expiry is inside; the expiry date itself counts', () => {
    expect(state({ date: '2026-10-28' })).toEqual({ kind: 'inside', date: '2026-10-28' });
    expect(state({ date: '2026-11-06' })).toEqual({ kind: 'inside', date: '2026-11-06' });
  });
  it('1 to 10 days after the expiry is a "date may move" note; 11 or more is clear', () => {
    expect(state({ date: '2026-11-07' })).toEqual({ kind: 'near-after', date: '2026-11-07', daysAfter: 1 });
    expect(state({ date: '2026-11-16' })).toEqual({ kind: 'near-after', date: '2026-11-16', daysAfter: 10 });
    expect(state({ date: '2026-11-17' })).toEqual({ kind: 'clear', date: '2026-11-17' });
  });
  it('a missing date, a past date and unavailable data are three different unverified states', () => {
    expect(state({ date: null })).toEqual({ kind: 'unverified', reason: 'no-date' });
    expect(state({ date: '' })).toEqual({ kind: 'unverified', reason: 'no-date' });
    expect(state({ date: 'not a date' })).toEqual({ kind: 'unverified', reason: 'no-date' });
    expect(state({ date: '2026-09-01' })).toEqual({ kind: 'unverified', reason: 'stale' });
    expect(state({ dataAvailable: false, date: '2026-10-28' })).toEqual({ kind: 'unverified', reason: 'unavailable' });
  });
  it('earnings today is not stale', () => {
    expect(state({ date: TODAY, expiration: '2026-11-06' }).kind).toBe('inside');
  });
});

describe('checks and their exact edges', () => {
  it('ROC exactly on the hurdle passes; one basis point under is a Wait', () => {
    expect(verdictOf({ put: putOf(1000) })).toEqual({ kind: 'candidate' });
    expect(verdictOf({ put: putOf(999) })).toEqual({ kind: 'wait', reason: 'Premium too thin' });
  });
  it('the ETF and stock IVR floors differ; exactly on the floor passes', () => {
    expect(verdictOf({ ivrHundredths: 2000 }).kind).toBe('candidate'); // ETF floor 20
    expect(verdictOf({ ivrHundredths: 1999 }).kind).toBe('wait');
    expect(verdictOf({ instrument: 'stock', earnings: { kind: 'clear', date: '2027-01-01' }, ivrHundredths: 3000 }).kind).toBe('candidate'); // stock floor 30
    expect(verdictOf({ instrument: 'stock', earnings: { kind: 'clear', date: '2027-01-01' }, ivrHundredths: 2999 }).kind).toBe('wait');
  });
  it('RSI 70.00 passes and 70.01 fails; within 3 points of the limit is an amber chip that does not change the verdict', () => {
    expect(verdictOf({ rsiHundredths: 7000 }).kind).toBe('candidate');
    expect(verdictOf({ rsiHundredths: 7001 })).toEqual({ kind: 'wait', reason: 'Wait for a pullback' });
    const near = evaluateCandidate(input({ rsiHundredths: 6700 }), params);
    expect(near.verdict.kind).toBe('candidate');
    expect(near.chips.find((c) => c.id === 'rsi')).toMatchObject({ tone: 'warn', text: 'RSI 67, close to 70' });
  });
  it('an illiquid put is a Skip, not a Wait', () => {
    expect(verdictOf({ put: putOf(2000, leg({ bid: 0.5, ask: 0.8 })) })).toEqual({ kind: 'skip', reason: 'Put is illiquid' });
    expect(verdictOf({ put: putOf(2000, leg({ openInterest: 10 })) })).toEqual({ kind: 'skip', reason: 'Put is illiquid' });
  });
  it('the hurdle is an editable default: a 9% hurdle lets 954 bps through', () => {
    expect(verdictOf({ put: putOf(954) }, resolveParams({ hurdleBps: 900 })).kind).toBe('candidate');
    expect(verdictOf({ put: putOf(954) }).kind).toBe('wait');
  });
});

describe('unknown never reads as pass or fail', () => {
  it('a missing IVR or RSI shows "unavailable", and the other checks decide', () => {
    const r = evaluateCandidate(input({ ivrHundredths: null, rsiHundredths: null }), params);
    expect(r.verdict.kind).toBe('candidate');
    expect(r.chips.filter((c) => c.tone === 'note').map((c) => c.text)).toEqual(['IVR unavailable', 'RSI unavailable']);
  });
  it('a stock with an unverified earnings date is flagged, so it ranks after clean candidates', () => {
    const r = evaluateCandidate(input({ instrument: 'stock', earnings: { kind: 'unverified', reason: 'no-date' } }), params);
    expect(r.verdict.kind).toBe('candidate');
    expect(r.group).toBe('candidate-flagged');
    expect(r.chips.some((c) => c.text === 'Earnings unverified: no date on file')).toBe(true);
  });
  it('the three unverified reasons each have their own chip text', () => {
    const text = (reason: 'no-date' | 'stale' | 'unavailable') => evaluateCandidate(input({ instrument: 'stock', earnings: { kind: 'unverified', reason } }), params).chips.find((c) => c.id === 'earnings')?.text;
    expect(text('no-date')).toBe('Earnings unverified: no date on file');
    expect(text('stale')).toBe('Earnings unverified: date is in the past');
    expect(text('unavailable')).toBe('Earnings unverified: data unavailable');
  });
});

describe('earnings inside the expiry', () => {
  const inside = input({ instrument: 'stock', earnings: { kind: 'inside', date: '2026-10-28' } });
  it('by default it is a candidate with an amber flag, in the flagged group, and the return includes earnings risk', () => {
    const r = evaluateCandidate(inside, params);
    expect(r.verdict.kind).toBe('candidate');
    expect(r.group).toBe('candidate-flagged');
    expect(r.includesEarningsRisk).toBe(true);
    expect(r.chips.find((c) => c.id === 'earnings')).toMatchObject({ tone: 'warn', text: 'Earnings Oct 28, inside this expiry' });
  });
  it('with the earnings rule set to wait, the verdict is Wait until after the date', () => {
    expect(verdictOf({ instrument: 'stock', earnings: { kind: 'inside', date: '2026-10-28' } }, resolveParams({ earningsRule: 'wait' }))).toEqual({ kind: 'wait', reason: 'Wait until after earnings Oct 28' });
  });
  it('the "date may move" note is grey, does not flag, and does not change the ranking group', () => {
    const r = evaluateCandidate(input({ instrument: 'stock', earnings: { kind: 'near-after', date: '2026-11-12', daysAfter: 6 } }), params);
    expect(r.group).toBe('candidate');
    expect(r.earningsFlagged).toBe(false);
    expect(r.chips.find((c) => c.id === 'earnings')).toMatchObject({ tone: 'note', text: 'Earnings Nov 12, 6 days after expiry: date may move' });
  });
  it('an ETF never shows an earnings chip', () => {
    expect(evaluateCandidate(input(), params).chips.some((c) => c.id === 'earnings')).toBe(false);
  });
});

describe('verdict precedence (first that applies)', () => {
  it('Not yet beats everything; a typed count (forced) removes it', () => {
    expect(verdictOf({ fits: false, put: putOf(500), ivrHundredths: 100 })).toEqual({ kind: 'not-yet', reason: 'Unlocks in 8 months' });
    expect(verdictOf({ fits: false, forced: true }).kind).toBe('candidate');
  });
  it('a typed count does not hide a failing check', () => {
    expect(verdictOf({ fits: false, forced: true, put: putOf(500) }).kind).toBe('wait');
  });
  it('Skip (illiquid) beats every Wait reason', () => {
    expect(verdictOf({ put: putOf(500, leg({ openInterest: 1 })), ivrHundredths: 100, rsiHundredths: 9000 }).kind).toBe('skip');
  });
  it('Wait reasons come in a fixed order: return, then IVR, then RSI, then earnings', () => {
    const all = { put: putOf(500), ivrHundredths: 100, rsiHundredths: 9000, instrument: 'stock' as const, earnings: { kind: 'inside', date: '2026-10-28' } as EarningsState };
    const p = resolveParams({ earningsRule: 'wait' });
    expect(verdictOf(all, p)).toEqual({ kind: 'wait', reason: 'Premium too thin' });
    expect(verdictOf({ ...all, put: putOf(2000) }, p)).toEqual({ kind: 'wait', reason: 'Not enough premium yet (low IVR)' });
    expect(verdictOf({ ...all, put: putOf(2000), ivrHundredths: 5000 }, p)).toEqual({ kind: 'wait', reason: 'Wait for a pullback' });
    expect(verdictOf({ ...all, put: putOf(2000), ivrHundredths: 5000, rsiHundredths: 5000 }, p)).toEqual({ kind: 'wait', reason: 'Wait until after earnings Oct 28' });
  });
});

describe('order', () => {
  const ranked = (over: Partial<CandidateInput>, p = params) => evaluateCandidate(input(over), p);

  it('clean candidates first, then flagged or unverified, then Wait, Not yet, Skip', () => {
    const list = [
      ranked({ symbol: 'SKIP', put: putOf(2000, leg({ openInterest: 1 })) }),
      ranked({ symbol: 'NOTYET', fits: false, fitsAtCents: 5_400_000 }),
      ranked({ symbol: 'WAIT', put: putOf(900) }),
      ranked({ symbol: 'FLAG', instrument: 'stock', earnings: { kind: 'inside', date: '2026-10-28' }, put: putOf(1780) }),
      ranked({ symbol: 'CLEAN', put: putOf(1100) }),
    ];
    expect(rankCandidates(list).map((r) => r.input.symbol)).toEqual(['CLEAN', 'FLAG', 'WAIT', 'NOTYET', 'SKIP']);
  });
  it('inside a group: net ROC descending, then the lower cash need, then symbol', () => {
    const list = [
      ranked({ symbol: 'B', put: putOf(1300), cashCents: 600_000 }),
      ranked({ symbol: 'A', put: putOf(1300), cashCents: 600_000 }),
      ranked({ symbol: 'C', put: putOf(1300), cashCents: 500_000 }),
      ranked({ symbol: 'D', put: putOf(1500) }),
    ];
    expect(rankCandidates(list).map((r) => r.input.symbol)).toEqual(['D', 'C', 'A', 'B']);
  });
  it('Not yet is ordered by the account size at which it fits, smallest first', () => {
    const list = [ranked({ symbol: 'BIG', fits: false, fitsAtCents: 9_000_000 }), ranked({ symbol: 'SOON', fits: false, fitsAtCents: 5_400_000 })];
    expect(rankCandidates(list).map((r) => r.input.symbol)).toEqual(['SOON', 'BIG']);
  });
  it('ranking does not mutate its input', () => {
    const list = [ranked({ symbol: 'B', put: putOf(900) }), ranked({ symbol: 'A', put: putOf(1500) })];
    const copy = [...list];
    rankCandidates(list);
    expect(list).toEqual(copy);
  });
});
