// lib/scans/__tests__/spreadOiPolicy.test.ts

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { findBestSpread, findBestSpreadUnfiltered } from '../spread-finder';
import { DEFAULT_ETF_RULES } from '../constants';

// LIQUIDITY-SYNC-0002: one liquidity policy for spreads. Zero open interest on either leg = no market: excluded.
// A positive OI below the preset/rule minimum is only a warning, so it still produces a candidate.

const EXP = '2026-10-16';
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-16T15:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });
const PRICE = 329.58;

const leg = (strike: number, delta: number, bid: number, ask: number, oi: number) => ({
  expirationDate: EXP, optionType: 'C', strikePrice: strike, delta, iv: 0.28, bid, ask, mid: (bid + ask) / 2,
  openInterest: oi, occSymbol: `AAPL  261016C${String(strike * 1000).padStart(8, '0')}`,
});
// The reference chain from spreadFinderDeterminism (it yields a valid BCS); oiFor sets each strike's open interest.
const base = [[295, 0.34, 6.10, 6.30], [300, 0.28, 4.30, 4.50], [305, 0.22, 2.90, 3.10], [310, 0.18, 1.85, 2.05], [315, 0.15, 1.10, 1.30], [320, 0.11, 0.62, 0.82]];
const chain = (oiFor: (strike: number) => number) => base.map(([k, d, b, a]) => leg(k, d, b, a, oiFor(k)));

describe('spread legs and open interest (LIQUIDITY-SYNC-0002)', () => {
  it('the reference chain produces a candidate (control)', () => {
    expect(findBestSpread(chain(() => 5000), 'BCS', EXP, PRICE, DEFAULT_ETF_RULES)).not.toBeNull();
    expect(findBestSpreadUnfiltered(chain(() => 5000), 'BCS', EXP, PRICE)).not.toBeNull();
  });
  it('zero open interest on every leg: no spread', () => {
    expect(findBestSpread(chain(() => 0), 'BCS', EXP, PRICE, DEFAULT_ETF_RULES)).toBeNull();
    expect(findBestSpreadUnfiltered(chain(() => 0), 'BCS', EXP, PRICE)).toBeNull();
  });
  it('a strike with zero open interest is never used as a leg', () => {
    for (const dead of [295, 300, 305, 310, 315, 320]) {
      const c = findBestSpread(chain(k => (k === dead ? 0 : 5000)), 'BCS', EXP, PRICE, DEFAULT_ETF_RULES);
      const u = findBestSpreadUnfiltered(chain(k => (k === dead ? 0 : 5000)), 'BCS', EXP, PRICE);
      for (const r of [c, u]) if (r) { expect(r.shortStrike).not.toBe(dead); expect(r.longStrike).not.toBe(dead); }
    }
  });
  it('low but nonzero open interest (below the rule minimum) is a warning, not an exclusion', () => {
    const c = findBestSpread(chain(() => 40), 'BCS', EXP, PRICE, DEFAULT_ETF_RULES);
    expect(c).not.toBeNull();
    expect(c!.shortOI).toBe(40);
  });
});
