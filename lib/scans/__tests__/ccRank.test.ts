// lib/scans/__tests__/ccRank.test.ts
// CC-WHEEL-0001 -- covered calls order by annualized yield; a wide spread sorts below a tight one; unknown yield is null.
import { describe, it, expect } from 'vitest';
import { ccRankValue } from '../ccRank';
import { ccRsiChip } from '../ccRsiChip';

describe('ccRankValue', () => {
  it('higher yield ranks first', () => {
    expect(ccRankValue({ ccAnnualizedYieldOnShares: 12 }, false)!).toBeGreaterThan(ccRankValue({ ccAnnualizedYieldOnShares: 8 }, false)!);
  });
  it('a tight spread beats a wide one even at a lower yield', () => {
    expect(ccRankValue({ ccAnnualizedYieldOnShares: 5 }, false)!).toBeGreaterThan(ccRankValue({ ccAnnualizedYieldOnShares: 40 }, true)!);
  });
  it('unknown yield is null', () => {
    expect(ccRankValue({}, false)).toBeNull();
    expect(ccRankValue({ ccAnnualizedYieldOnShares: NaN }, false)).toBeNull();
  });
});

describe('crown eligibility follows the chip', () => {
  it('only Ready can carry the crown', () => {
    expect(ccRsiChip({ rsi: 62, price: 90, costBasis: 80 }).state).toBe('ready');
    expect(ccRsiChip({ rsi: 32, price: 90, costBasis: 80 }).state).not.toBe('ready');
    expect(ccRsiChip({ rsi: 62, price: 62, costBasis: 82 }).state).not.toBe('ready');
  });
});
