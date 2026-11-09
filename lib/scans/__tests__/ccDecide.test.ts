// lib/scans/__tests__/ccDecide.test.ts

import { describe, expect, it } from 'vitest';
import { buildCcDecide, ccExpirationLabel, type CcDecideInput } from '../ccDecide';

const tqqq: CcDecideInput = { symbol: 'TQQQ', spot: 52.25, strike: 57, delta: 0.24, dte: 8, expiration: '2026-11-16', premiumPerContract: 116, contracts: 2, costBasis: 48, ivxPct: 91 };

describe('ccExpirationLabel', () => {
  it('formats an ISO date as Mon D', () => {
    expect(ccExpirationLabel('2026-11-16')).toBe('Nov 16');
    expect(ccExpirationLabel('2027-01-05')).toBe('Jan 5');
    expect(ccExpirationLabel('garbage')).toBe('garbage');
  });
});

describe('buildCcDecide', () => {
  it('says what to do and what you collect, with model odds of keeping the shares', () => {
    const d = buildCcDecide(tqqq)!;
    expect(d.headline).toBe('Sell 2 $57 calls expiring Nov 16 for $232.');
    expect(d.keepLine).toBe('You keep all gains up to $57. Model odds: about a 76% chance you keep your shares.');
  });
  it('the catch names a typical move up, the gain missed, and the sale result including the credit', () => {
    const d = buildCcDecide(tqqq)!;
    expect(d.catchKind).toBe('normal');
    expect(d.catchLabel).toBe('THE CATCH');
    // spot + implied move: 52.25 * 0.91 * sqrt(8/365) = 7.04 -> $59.29; missed = (59.29 - 57) * 200 - 232
    expect(d.catchText).toContain('If TQQQ rallies to $59.29 (a typical 8-day move up, model estimate), you would miss $226 of gain.');
    expect(d.catchText).toContain('Your shares would be sold at $57 for a $1,800 gain on your $48 cost, plus the $232 you collected.');
  });
  it('a single contract reads "1 $57 call"', () => {
    const d = buildCcDecide({ ...tqqq, contracts: 1, premiumPerContract: 116 })!;
    expect(d.headline).toBe('Sell 1 $57 call expiring Nov 16 for $116.');
  });
  it('a strike below your cost is a loss in dollars, before the credit', () => {
    const d = buildCcDecide({ ...tqqq, costBasis: 78.75 })!;
    expect(d.catchKind).toBe('below-cost');
    expect(d.catchLabel).toBe('THE CATCH · BELOW YOUR COST');
    expect(d.catchText).toBe('$57 is below your $78.75 cost. If TQQQ finishes above $57, your shares are sold for a $4,350 loss on your cost, before the $232 you collected.');
  });
  it('without implied volatility it leaves out the rally figure rather than guessing', () => {
    const d = buildCcDecide({ ...tqqq, ivxPct: null })!;
    expect(d.catchText).toContain('The calls only cost you if TQQQ finishes above $57.');
    expect(d.catchText).not.toContain('rallies to');
  });
  it('without a cost basis it leaves out the sale result', () => {
    const d = buildCcDecide({ ...tqqq, costBasis: null })!;
    expect(d.catchText).not.toContain('gain on your');
    expect(d.catchText).toContain('you would miss');
  });
  it('a far strike that a typical move does not reach says so', () => {
    const d = buildCcDecide({ ...tqqq, strike: 70, delta: 0.03 })!;
    expect(d.catchText).toContain('The calls only cost you if TQQQ finishes above $70.');
    expect(d.catchText).toContain('does not cost you more than the $232 you collect');
  });
  it('is null when a needed number is missing', () => {
    expect(buildCcDecide({ ...tqqq, contracts: 0 })).toBeNull();
    expect(buildCcDecide({ ...tqqq, premiumPerContract: null })).toBeNull();
    expect(buildCcDecide({ ...tqqq, spot: undefined })).toBeNull();
    expect(buildCcDecide({ ...tqqq, dte: 0 })).toBeNull();
  });
});
