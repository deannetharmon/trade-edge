import { describe, expect, it } from 'vitest';
import { calculateTargetedConservativeCredit, findBestICUnfiltered, findBestTargetedICWithCreditRatioFloor } from '../spread-finder';

const expiration = '2026-10-16';
const leg = (optionType: 'P' | 'C', strikePrice: number, bid: number, ask: number, delta: number) => ({
  expirationDate: expiration, optionType, strikePrice, bid, ask, mid: (bid + ask) / 2,
  delta, openInterest: 1000, occSymbol: `${optionType}${strikePrice}`,
});

describe('findBestTargetedICWithCreditRatioFloor', () => {
  it('calculates vertical credit/risk at the boundary and rejects invalid quotes when required', () => {
    const short = leg('P', 95, 1.5, 1.5, -0.20);
    const long = leg('P', 90, 0.5, 0.5, -0.10);
    expect(calculateTargetedConservativeCredit(short, long, 5, true)?.creditRatio).toBe(0.20);
    expect(calculateTargetedConservativeCredit({ ...short, ask: 1.4 }, long, 5, true)).toBeNull();
    expect(calculateTargetedConservativeCredit(short, long, 5, true)?.creditRatio).toBeLessThan(0.21);
  });
  it('accepts a wing exactly at the floor and rejects one below it', () => {
    // Natural 1.00, mid 1.00 on five-wide = 20% exact.
    const exact = [
      leg('P', 95, 1.5, 1.5, -0.20), leg('P', 90, 0.5, 0.5, -0.10),
      leg('C', 105, 1.5, 1.5, 0.20), leg('C', 110, 0.5, 0.5, 0.10),
    ];
    expect(findBestTargetedICWithCreditRatioFloor(exact, expiration, 100, 0.20)).not.toBeNull();
    expect(findBestTargetedICWithCreditRatioFloor(exact, expiration, 100, 0.21)).toBeNull();
  });

  it('requires both IC wings to meet the floor', () => {
    const asymmetric = [
      leg('P', 95, 1.5, 1.5, -0.20), leg('P', 90, 0.5, 0.5, -0.10), // 20%
      leg('C', 105, 1.0, 1.0, 0.20), leg('C', 110, 0.5, 0.5, 0.10), // 10%
    ];
    expect(findBestTargetedICWithCreditRatioFloor(asymmetric, expiration, 100, 0.20)).toBeNull();
  });

  it('treats crossed or missing two-sided quotes as a normal no-candidate result', () => {
    const crossed = [
      leg('P', 95, 1.5, 1.4, -0.20), leg('P', 90, 0.5, 0.5, -0.10),
      leg('C', 105, 1.5, 1.5, 0.20), leg('C', 110, 0.5, 0.5, 0.10),
    ];
    expect(findBestTargetedICWithCreditRatioFloor(crossed, expiration, 100, 0.20)).toBeNull();
  });

  it('uses the unchanged unfiltered selection path when the launch floor is Any', () => {
    const chain = [
      leg('P', 95, 1.5, 1.5, -0.20), leg('P', 90, 0.5, 0.5, -0.10),
      leg('C', 105, 1.5, 1.5, 0.20), leg('C', 110, 0.5, 0.5, 0.10),
    ];
    expect(findBestTargetedICWithCreditRatioFloor(chain, expiration, 100, 0)).toEqual(findBestICUnfiltered(chain, expiration, 100));
  });

  it('can search five-wide IC wings even when the high-priced underlying normally steps by $25', () => {
    const chain = [
      leg('P', 2495, 1.5, 1.5, -0.20), leg('P', 2490, 0.5, 0.5, -0.10),
      leg('C', 2505, 1.5, 1.5, 0.20), leg('C', 2510, 0.5, 0.5, 0.10),
    ].map(item => ({ ...item, iv: 0.20 }));
    const direct = findBestICUnfiltered(chain, expiration, 2500, 5);
    const withFloor = findBestTargetedICWithCreditRatioFloor(chain, expiration, 2500, 0.20, 5);
    expect(direct?.spreadWidth).toBe(5);
    expect(direct?.callWidth).toBe(5);
    expect(withFloor?.spreadWidth).toBe(5);
    expect(withFloor?.callWidth).toBe(5);
    expect(findBestICUnfiltered(chain, expiration, 2500)).toBeNull();
  });
});
