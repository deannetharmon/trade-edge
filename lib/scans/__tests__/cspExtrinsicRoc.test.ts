// lib/scans/__tests__/cspExtrinsicRoc.test.ts
//
// CSP-SCORE-EXTRINSIC-0001 — a deep-ITM put's bid is mostly intrinsic value
// (the cost of near-certain assignment, not option income). findAllCsp now
// also computes an extrinsic-value-only ROC (cspExtrinsicRoc /
// cspExtrinsicAnnualizedRoc), which feeds the CSP score's premium-efficiency
// dimension in app/screener/page.tsx, WITHOUT changing the trader-facing
// cash-flow numbers (credit / roc / annualizedRoc) shown on the card, which
// remain the actual premium received. This is the fix behind the "AAPL 400
// strike scores 78 despite POP 0% and OI 0" bug Ian flagged.

import { describe, it, expect } from 'vitest';
import { findAllCsp } from '../csp-finder';
import { DEFAULT_CSP_RULES } from '../constants';

const EXP_DAYS_OUT = 32;

function expDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + EXP_DAYS_OUT);
  return d.toISOString().slice(0, 10);
}

/** One-strike synthetic chain so each test isolates a single candidate. */
function oneStrikeChain(opts: { strike: number; delta: number; bid: number; ask: number; oi?: number }) {
  const exp = expDate();
  return {
    expirations: [exp],
    chains: {
      [exp]: [{
        strikePrice: opts.strike, expirationDate: exp, optionType: 'P' as const,
        delta: opts.delta, bid: opts.bid, ask: opts.ask, mid: (opts.bid + opts.ask) / 2,
        openInterest: opts.oi ?? 500, occSymbol: `X_${exp}_P${opts.strike}`,
      }],
    },
  };
}

// Wide rules so both an in-band OTM put and a deliberately out-of-band deep
// ITM put are both discovered (discovery is independent of the preferred
// band -- see csp-finder.ts's module header).
const WIDE_RULES = { ...DEFAULT_CSP_RULES, DELTA_MIN: 0.01, DELTA_MAX: 0.99 };

function firstCandidate(chain: ReturnType<typeof oneStrikeChain>, price: number) {
  const result = findAllCsp(chain, price, { rules: WIDE_RULES, contracts: 1, capital: { accountSelected: true, optionBuyingPower: 1_000_000, cashBalance: 1_000_000 } });
  expect(result.results).toHaveLength(1);
  return result.results[0].candidate;
}

describe('an out-of-the-money put (strike below price, no intrinsic value)', () => {
  // AAPL-shaped: price $338.67, a real in-band CSP strike well below price.
  const c = firstCandidate(oneStrikeChain({ strike: 300, delta: -0.18, bid: 1.20, ask: 1.40 }), 338.67);

  it('has zero intrinsic value, so extrinsic value equals the full premium', () => {
    expect(c.cspExtrinsicValuePerContract).toBeCloseTo(c.cspMid as number, 5);
  });

  it('extrinsic ROC equals the real cash-flow ROC -- no penalty for a genuine premium sale', () => {
    expect(c.cspExtrinsicRoc).toBeCloseTo(c.roc, 5);
    expect(c.cspExtrinsicAnnualizedRoc).toBeCloseTo(c.annualizedRoc as number, 5);
  });
});

describe('a deep in-the-money put (strike far above price -- Ian\'s AAPL 400 example)', () => {
  // Reproduces the screenshot: price $338.67, strike 400, bid/ask around
  // $59.05/$62.90, credit ~$6,097.50, cash required $40,000.
  const PRICE = 338.67;
  const c = firstCandidate(oneStrikeChain({ strike: 400, delta: -1.00, bid: 59.05, ask: 62.90, oi: 0 }), PRICE);

  it('reproduces the fixture\'s real cash numbers unchanged (credit, cash required stay real cash flow)', () => {
    expect(c.credit).toBeCloseTo(6097.50, 1);
    expect(c.requiredCash).toBe(40_000);
    expect(c.roc).toBeGreaterThan(15); // ~15.24% period ROC on the full bid -- correct, real cash flow, must NOT change
  });

  it('most of the premium is intrinsic value: extrinsic value is far below the full mid', () => {
    const intrinsic = 400 - PRICE; // $61.33
    expect(c.cspExtrinsicValuePerContract).toBeCloseTo(Math.max(0, (c.cspMid as number) - intrinsic), 2);
    expect(c.cspExtrinsicValuePerContract as number).toBeLessThan(1); // ~$0.635 of real time value, not $60.975
  });

  it('extrinsic ROC is dramatically lower than the real cash-flow ROC -- this is the fix', () => {
    expect(c.cspExtrinsicRoc as number).toBeLessThan(5); // real time value / $40,000 cash, not 15%+
    expect(c.cspExtrinsicRoc as number).toBeLessThan(c.roc);
    expect(c.cspExtrinsicAnnualizedRoc as number).toBeLessThan(c.annualizedRoc as number);
  });

  it('the trader-facing roc/annualizedRoc/credit fields are completely untouched by this fix', () => {
    // Recomputed independently from the raw fixture numbers, not from the
    // extrinsic fields, to prove the two calculations are fully separate.
    const totalPremium = parseFloat(((59.05 + 62.90) / 2 * 100).toFixed(2));
    const expectedRoc = (totalPremium / 40_000) * 100;
    expect(c.credit).toBeCloseTo(totalPremium, 2);
    expect(c.roc).toBeCloseTo(expectedRoc, 5);
    expect(c.annualizedRoc as number).toBeCloseTo(expectedRoc * (365 / c.dte), 5);
  });
});

describe('extrinsic value never goes negative', () => {
  it('floors at 0 when the bid is smaller than the strike/price gap (stale or wide quote)', () => {
    // Strike $500 vs price $338.67 -> intrinsic ~$161, but bid quoted below
    // that (a stale/crossed quote) -- extrinsic must floor at 0, not go negative.
    const c = firstCandidate(oneStrikeChain({ strike: 500, delta: -1.00, bid: 100, ask: 105 }), 338.67);
    expect(c.cspExtrinsicValuePerContract).toBe(0);
    expect(c.cspExtrinsicRoc).toBe(0);
    expect(c.cspExtrinsicAnnualizedRoc).toBe(0);
  });
});

describe('extrinsic fields degrade safely when the underlying price is unavailable', () => {
  it('with a null price, intrinsic value cannot be computed, so extrinsic value falls back to the full premium (never throws, never fabricates a number)', () => {
    const c = firstCandidate(oneStrikeChain({ strike: 400, delta: -1.00, bid: 59.05, ask: 62.90 }), NaN as unknown as number);
    // findAllCsp accepts `price: number | null`; NaN is not a valid finite
    // number either, so this exercises the same "no reliable price" path as
    // an explicit null without changing the chain-fetch contract under test.
    expect(Number.isFinite(c.cspExtrinsicValuePerContract)).toBe(true);
    // extrinsicValuePerContract is rounded to 2dp in csp-finder.ts, same as cspMid.
    expect(c.cspExtrinsicValuePerContract).toBeCloseTo(c.cspMid as number, 2);
  });
});
