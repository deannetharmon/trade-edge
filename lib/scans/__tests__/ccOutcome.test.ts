// lib/scans/__tests__/ccOutcome.test.ts
// SELL-CC-0001 A -- Alan's golden fixture: 1 TQQQ Nov 20 $75 call at $0.24.
import { describe, it, expect } from 'vitest';
import { computeCcOutcome, ccOutcomeLines } from '../ccOutcome';

describe('computeCcOutcome', () => {
  const o = computeCcOutcome({ strike: 75, premiumPerShare: 0.24, contracts: 1, stockPrice: 62.16 });
  it('matches the TQQQ example', () => {
    expect(o.premiumPerContract).toBe(24);
    expect(o.grossCredit).toBe(24);
    expect(o.netCredit).toBe(22.87);
    expect(o.effectiveSalePrice).toBe(75.24);
    expect(o.downsideBufferPerShare).toBe(0.24);
    expect(o.inTheMoney).toBe(false);
  });
  it('scales by contracts and flags in-the-money', () => {
    const two = computeCcOutcome({ strike: 60, premiumPerShare: 3, contracts: 2, stockPrice: 62.16 });
    expect(two.grossCredit).toBe(600);
    expect(two.estFees).toBe(2.26);
    expect(two.inTheMoney).toBe(true);
  });
  it('in-the-money is unknown without a price', () => {
    expect(computeCcOutcome({ strike: 75, premiumPerShare: 0.24, contracts: 1 }).inTheMoney).toBeNull();
  });
});

describe('ccOutcomeLines', () => {
  it('states coverage and both outcomes, never "unlimited"', () => {
    const text = ccOutcomeLines({ strike: 75, premiumPerShare: 0.24, contracts: 1 }, 'TQQQ', 100).join(' ');
    expect(text).toContain('Covered by 100 TQQQ shares in this account.');
    expect(text).toContain('$0.24/share = $24.00 per contract.');
    expect(text).toContain('keep the shares and the premium');
    expect(text).toContain('$75.24/share');
    expect(text).not.toMatch(/unlimited/i);
  });
});
