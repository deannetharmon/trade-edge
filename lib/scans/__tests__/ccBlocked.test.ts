// lib/scans/__tests__/ccBlocked.test.ts
// CC-VISIBILITY-0001 slice 4. The trader's real case: a $63 call, 14 DTE, quoted by the broker with zero open interest.

import { describe, expect, it } from 'vitest';
import { describeCcBlocked, listCcBlockedCalls } from '../ccBlocked';
import type { WheelChainLeg } from '@/lib/wheel/chainSearch';

const today = new Date(2026, 10, 9); // Nov 9, 2026 local
const leg = (strike: number, over: Partial<WheelChainLeg> = {}): WheelChainLeg => ({
  strikePrice: strike, expirationDate: '2026-11-23', optionType: 'C', delta: 0.2, openInterest: 100, bid: 1, ask: 1.1, mid: 1.05, occSymbol: `TQQQ  261123C${String(strike * 1000).padStart(8, '0')}`, ...over,
});
const chain = (legs: WheelChainLeg[], exp = '2026-11-23') => ({ expirations: [exp], chains: { [exp]: legs } });
const input = { dteMin: 7, dteMax: 45, stockPrice: 57.35, today };

describe('listCcBlockedCalls', () => {
  it('lists the zero-open-interest call with a no-market reason', () => {
    const r = listCcBlockedCalls(chain([leg(63, { openInterest: 0, bid: 0.5, ask: 1.5 })]), input);
    expect(r.total).toBe(1);
    expect(r.calls[0]).toMatchObject({ strike: 63, dte: 14, reason: 'no-market' });
    expect(describeCcBlocked(r.calls[0])).toContain('no open interest');
  });
  it('lists one-sided, crossed and delta-less calls with their own reasons', () => {
    const r = listCcBlockedCalls(chain([leg(60, { bid: 0 }), leg(61, { bid: 2, ask: 1 }), leg(62, { delta: null })]), input);
    expect(r.calls.map(c => [c.strike, c.reason])).toEqual([[60, 'no-quote'], [61, 'crossed-quote'], [62, 'no-delta']]);
  });
  it('does not list calls that pass, calls below the stock price, puts, or calls outside the DTE window', () => {
    expect(listCcBlockedCalls(chain([leg(63), leg(55, { openInterest: 0 }), leg(64, { optionType: 'P', openInterest: 0 })]), input).total).toBe(0);
    expect(listCcBlockedCalls(chain([leg(63, { openInterest: 0 })], '2027-03-19'), input).total).toBe(0);
  });
  it('does not list width-only or delta-window rejections (the result filters own those)', () => {
    expect(listCcBlockedCalls(chain([leg(63, { bid: 0.1, ask: 1.0 }), leg(64, { delta: 0.9 })]), input).total).toBe(0);
  });
  it('lists nothing without a known price, and caps the list while counting everything', () => {
    expect(listCcBlockedCalls(chain([leg(63, { openInterest: 0 })]), { ...input, stockPrice: null }).total).toBe(0);
    const many = Array.from({ length: 60 }, (_, i) => leg(58 + i, { openInterest: 0 }));
    const r = listCcBlockedCalls(chain(many), input);
    expect(r.total).toBe(60);
    expect(r.calls).toHaveLength(40);
  });
});
