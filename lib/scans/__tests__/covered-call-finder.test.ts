// lib/scans/__tests__/covered-call-finder.test.ts
// TE-0007C — candidate-selection tests (ticket "Testing" §2, cases 1–10).
import { describe, it, expect } from 'vitest';
import { findBestCoveredCall } from '../covered-call-finder';
import { computeCoveredCallCapacity } from '../covered-call-capacity';
import type { CcRulesType } from '../constants';
import type { WheelChainResult, WheelChainLeg } from '@/lib/wheel/chainSearch';

const RULES: CcRulesType = {
  DELTA_MIN: 0.20, DELTA_MAX: 0.35,
  DTE_MIN: 21, DTE_MAX: 45,
  OI_MIN: 100, BID_ASK_MAX: 0.20,
};

type TestChain = { expirations: string[]; chains: Record<string, WheelChainLeg[]> };

function makeChain(overrides: Partial<WheelChainResult> = {}): TestChain {
  const expDate = '2026-09-18'; // ~well outside "today" in test harness time, DTE computed dynamically by daysUntil
  return {
    expirations: [expDate],
    chains: {
      [expDate]: [
        { strikePrice: 105, expirationDate: expDate, optionType: 'C', delta: 0.28, openInterest: 500, bid: 1.20, ask: 1.30, mid: 1.25, occSymbol: 'TEST260918C00105000' },
        { strikePrice: 95, expirationDate: expDate, optionType: 'P', delta: -0.25, openInterest: 500, bid: 1.00, ask: 1.10, mid: 1.05, occSymbol: 'TEST260918P00095000' },
      ],
    },
    ...overrides,
  } as unknown as TestChain;
}

// Freezes a fixed 30-DTE window relative to "today" by constructing a chain
// with a dynamically-computed near-term expiration, since the finder's
// selection loop filters by real daysUntil().
function chainWithDte(dte: number, opts: { strike?: number; delta?: number; oi?: number; bid?: number; ask?: number } = {}): TestChain {
  const d = new Date();
  d.setDate(d.getDate() + dte);
  const expDate = d.toISOString().slice(0, 10);
  const strike = opts.strike ?? 105;
  const delta = opts.delta ?? 0.28;
  const oi = opts.oi ?? 500;
  const bid = opts.bid ?? 1.20;
  const ask = opts.ask ?? 1.30;
  return {
    expirations: [expDate],
    chains: {
      [expDate]: [
        { strikePrice: strike, expirationDate: expDate, optionType: 'C', delta, openInterest: oi, bid, ask, mid: (bid + ask) / 2, occSymbol: 'TESTC' },
      ],
    },
  };
}

const fullCapacity = computeCoveredCallCapacity(500, 0, 0, 90);

describe('findBestCoveredCall: ticket cases 1-10', () => {
  it('1. searches call legs only', () => {
    const chain = makeChain();
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 });
    expect(cand?.strategy).toBe('CC');
    expect(cand?.shortStrike).toBe(105); // the call, not the 95 put
  });

  it('2. honors DTE and delta ranges', () => {
    const tooShortDte = chainWithDte(5);
    expect(findBestCoveredCall(tooShortDte, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).toBeNull();

    const badDelta = chainWithDte(30, { delta: 0.60 });
    expect(findBestCoveredCall(badDelta, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).toBeNull();

    const good = chainWithDte(30, { delta: 0.28 });
    expect(findBestCoveredCall(good, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).not.toBeNull();
  });

  it('3. rejects crossed/unusable quotes', () => {
    const crossed = chainWithDte(30, { bid: 2.00, ask: 1.00 });
    expect(findBestCoveredCall(crossed, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).toBeNull();

    const unusable = chainWithDte(30, { bid: 0, ask: 0 });
    expect(findBestCoveredCall(unusable, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).toBeNull();
  });

  it('4. rejects strikes below stock price', () => {
    const chain = chainWithDte(30, { strike: 95 }); // ITM relative to stock price 100
    expect(findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).toBeNull();
  });

  it('5. rejects strikes below known cost basis', () => {
    const chain = chainWithDte(30, { strike: 105 });
    const capacityHighBasis = computeCoveredCallCapacity(500, 0, 0, 110); // cost basis above strike
    expect(findBestCoveredCall(chain, { rules: RULES, capacity: capacityHighBasis, stockPrice: 100 })).toBeNull();
  });

  it('6. returns no candidate when none qualify', () => {
    const chain = { expirations: [], chains: {} };
    expect(findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).toBeNull();
  });

  it('7. produces correct premium, yield, annualized yield, and assignment math', () => {
    const chain = chainWithDte(36, { strike: 105, bid: 1.20, ask: 1.30 }); // mid 1.25
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 });
    expect(cand).not.toBeNull();
    expect(cand!.ccPremiumPerShare).toBeCloseTo(1.25, 4);
    expect(cand!.ccPremiumPerContract).toBeCloseTo(125, 2);
    expect(cand!.ccPeriodYieldOnShares).toBeCloseTo(1.25, 4); // 1.25/100*100
    expect(cand!.ccAssignmentProceeds).toBeCloseTo(10500, 2); // 105*100
  });

  it('8. quantity never exceeds available covered contracts', () => {
    const chain = chainWithDte(30, { strike: 105 });
    const capacityTwo = computeCoveredCallCapacity(250, 0, 0, 90); // 2 available contracts
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: capacityTwo, stockPrice: 100 });
    expect(cand).not.toBeNull();
    expect(cand!.ccAvailableCoveredContracts).toBe(2);
    expect(cand!.credit).toBeCloseTo(cand!.ccPremiumPerContract! * 2, 2);
  });

  it('9. leg ordering does not affect open-short-call exposure (finder side)', () => {
    // The finder itself doesn't compute exposure (that's covered-call-capacity's
    // job) — this asserts findBestCoveredCall's own behavior is order-independent
    // by feeding the same chain data in reversed leg order and getting an
    // identical candidate.
    const dte = 30;
    const d = new Date(); d.setDate(d.getDate() + dte);
    const expDate = d.toISOString().slice(0, 10);
    const legA = { strikePrice: 105, expirationDate: expDate, optionType: 'C' as const, delta: 0.28, openInterest: 500, bid: 1.20, ask: 1.30, mid: 1.25, occSymbol: 'A' };
    const legB = { strikePrice: 110, expirationDate: expDate, optionType: 'C' as const, delta: 0.15, openInterest: 500, bid: 0.50, ask: 0.60, mid: 0.55, occSymbol: 'B' };
    const chainOrderA = { expirations: [expDate], chains: { [expDate]: [legA, legB] } };
    const chainOrderB = { expirations: [expDate], chains: { [expDate]: [legB, legA] } };
    const candA = findBestCoveredCall(chainOrderA, { rules: RULES, capacity: fullCapacity, stockPrice: 100 });
    const candB = findBestCoveredCall(chainOrderB, { rules: RULES, capacity: fullCapacity, stockPrice: 100 });
    expect(candA?.shortStrike).toBe(candB?.shortStrike);
  });

  it('10. missing cost basis remains null and creates a warning without fabricated math', () => {
    const chain = chainWithDte(30, { strike: 105 });
    const capacityNoBasis = computeCoveredCallCapacity(500, 0, 0, null);
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: capacityNoBasis, stockPrice: 100 });
    expect(cand).not.toBeNull();
    expect(cand!.ccCostBasis).toBeNull();
    expect(cand!.ccStrikeVsCostBasisPct).toBeNull();
    expect(cand!.ccMaxUpsideIfCalledAway).toBeNull();
    expect(cand!.ccAssignmentWarning).toMatch(/cost basis unavailable/i);
  });

  it('zero available capacity -> no candidate, no naked-call recommendation', () => {
    const chain = chainWithDte(30, { strike: 105 });
    const zeroCapacity = computeCoveredCallCapacity(100, 1, 0, 90); // fully covered by existing short call
    expect(findBestCoveredCall(chain, { rules: RULES, capacity: zeroCapacity, stockPrice: 100 })).toBeNull();
  });

  it('bug regression: delta-closest strike is below stock price, but a valid strike exists further from delta center', () => {
    const dte = 30;
    const d = new Date(); d.setDate(d.getDate() + dte);
    const expDate = d.toISOString().slice(0, 10);
    // Delta-closest to center (0.275) is the 95 strike (delta 0.30) -- but
    // 95 < stockPrice(100), so it must be excluded. The 108 strike (delta
    // 0.21) is further from center but is the only ELIGIBLE strike, and
    // must be what gets returned.
    const legs = [
      { strikePrice: 95, expirationDate: expDate, optionType: 'C' as const, delta: 0.30, openInterest: 500, bid: 1.50, ask: 1.60, mid: 1.55, occSymbol: 'ITM' },
      { strikePrice: 108, expirationDate: expDate, optionType: 'C' as const, delta: 0.21, openInterest: 500, bid: 0.80, ask: 0.90, mid: 0.85, occSymbol: 'OTM_VALID' },
    ];
    const chain = { expirations: [expDate], chains: { [expDate]: legs } };
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 });
    expect(cand).not.toBeNull();
    expect(cand!.shortStrike).toBe(108);
  });

  it('bug regression: delta-closest strike is below cost basis, but a valid strike exists further from delta center', () => {
    const dte = 30;
    const d = new Date(); d.setDate(d.getDate() + dte);
    const expDate = d.toISOString().slice(0, 10);
    const legs = [
      { strikePrice: 102, expirationDate: expDate, optionType: 'C' as const, delta: 0.30, openInterest: 500, bid: 1.50, ask: 1.60, mid: 1.55, occSymbol: 'BELOW_BASIS' },
      { strikePrice: 115, expirationDate: expDate, optionType: 'C' as const, delta: 0.20, openInterest: 500, bid: 0.60, ask: 0.70, mid: 0.65, occSymbol: 'ABOVE_BASIS' },
    ];
    const chain = { expirations: [expDate], chains: { [expDate]: legs } };
    const capacityHighBasis = computeCoveredCallCapacity(500, 0, 0, 110); // cost basis 110
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: capacityHighBasis, stockPrice: 100 });
    expect(cand).not.toBeNull();
    expect(cand!.shortStrike).toBe(115);
  });

  it('earnings within expiry window -> no candidate', () => {
    const chain = chainWithDte(30, { strike: 105 });
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100, earningsWithinExpiry: true });
    expect(cand).toBeNull();
  });
});

// ── TE-0007C corrective round: full-universe eligibility filtering ─────────
// findBestCoveredCall previously called findBestWheelContract('own-writing-cc',
// ...), which picks the single delta-closest strike FIRST, then validated
// liquidity/quote-quality against only that one pick. These tests prove the
// corrected flow filters the FULL chain for every hard gate before selecting
// -- a preselected invalid contract can never suppress a different, eligible
// one in the same chain.
describe('TE-0007C corrective round: one-sided quotes and full-universe eligibility', () => {
  function legAt(strike: number, opts: { delta?: number; oi?: number; bid?: number; ask?: number; occSymbol?: string }, expDate: string) {
    return {
      strikePrice: strike, expirationDate: expDate, optionType: 'C' as const,
      delta: opts.delta ?? 0.28, openInterest: opts.oi ?? 500,
      bid: opts.bid ?? 1.20, ask: opts.ask ?? 1.30,
      mid: ((opts.bid ?? 1.20) + (opts.ask ?? 1.30)) / 2,
      occSymbol: opts.occSymbol ?? `STRIKE${strike}`,
    };
  }
  function nearTermExpDate(dte: number): string {
    const d = new Date(); d.setDate(d.getDate() + dte);
    return d.toISOString().slice(0, 10);
  }

  // Requirement 9: bid 0, ask positive is rejected.
  it('9. bid 0 / ask positive (one-sided) is rejected', () => {
    const chain = chainWithDte(30, { bid: 0, ask: 1.30 });
    expect(findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).toBeNull();
  });

  // Requirement 10: positive bid, ask 0 is rejected.
  it('10. positive bid / ask 0 (one-sided) is rejected', () => {
    const chain = chainWithDte(30, { bid: 1.20, ask: 0 });
    expect(findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).toBeNull();
  });

  // Requirement 11: non-finite and crossed quotes are rejected.
  it('11a. non-finite bid/ask is rejected', () => {
    const expDate = nearTermExpDate(30);
    const chain = { expirations: [expDate], chains: { [expDate]: [legAt(105, { bid: NaN, ask: 1.30 }, expDate)] } };
    expect(findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).toBeNull();
  });

  it('11b. crossed market (ask < bid) is rejected', () => {
    const chain = chainWithDte(30, { bid: 2.00, ask: 1.00 });
    expect(findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).toBeNull();
  });

  // Requirement 12: the delta-closest contract is illiquid, but a second
  // eligible contract exists further from delta center — the second must be
  // selected, not "no candidate."
  it('12. delta-closest contract is illiquid (low OI); a second eligible contract is selected instead', () => {
    const expDate = nearTermExpDate(30);
    const deltaClosestButIlliquid = legAt(105, { delta: 0.275, oi: 5, occSymbol: 'ILLIQUID' }, expDate); // OI_MIN is 100
    const secondEligible = legAt(110, { delta: 0.22, oi: 500, occSymbol: 'ELIGIBLE' }, expDate);
    const chain = { expirations: [expDate], chains: { [expDate]: [deltaClosestButIlliquid, secondEligible] } };
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 });
    expect(cand).not.toBeNull();
    expect(cand!.shortStrike).toBe(110);
    expect(cand!.shortOccSymbol).toBe('ELIGIBLE');
  });

  // Requirement 13: the delta-closest contract is one-sided, but a second
  // valid contract exists — the second is selected.
  it('13. delta-closest contract is one-sided (bid 0); a second valid contract is selected instead', () => {
    const expDate = nearTermExpDate(30);
    const deltaClosestButOneSided = legAt(105, { delta: 0.275, bid: 0, ask: 1.30, occSymbol: 'ONE_SIDED' }, expDate);
    const secondValid = legAt(110, { delta: 0.22, bid: 0.55, ask: 0.60, occSymbol: 'VALID' }, expDate);
    const chain = { expirations: [expDate], chains: { [expDate]: [deltaClosestButOneSided, secondValid] } };
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 });
    expect(cand).not.toBeNull();
    expect(cand!.shortStrike).toBe(110);
    expect(cand!.shortOccSymbol).toBe('VALID');
  });

  // Requirement 14: no candidate is returned when every contract fails.
  it('14. no candidate is returned when every contract in the chain fails eligibility', () => {
    const expDate = nearTermExpDate(30);
    const illiquid = legAt(105, { delta: 0.28, oi: 5 }, expDate);
    const oneSided = legAt(110, { delta: 0.25, bid: 0, ask: 1.0 }, expDate);
    const wrongDelta = legAt(115, { delta: 0.60 }, expDate);
    const chain = { expirations: [expDate], chains: { [expDate]: [illiquid, oneSided, wrongDelta] } };
    expect(findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).toBeNull();
  });

  // Requirement 15 (finder half): even when multiple eligible contracts
  // exist, the returned candidate's implied quantity never exceeds the
  // capacity object's verified availableCoveredContracts.
  it('15. selected candidate quantity never exceeds verified available capacity', () => {
    const expDate = nearTermExpDate(30);
    const chain = { expirations: [expDate], chains: { [expDate]: [legAt(105, {}, expDate), legAt(110, { delta: 0.22 }, expDate)] } };
    const oneAvailable = computeCoveredCallCapacity(100, 0, 0, 90); // exactly 1 contract available
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: oneAvailable, stockPrice: 100 });
    expect(cand).not.toBeNull();
    expect(cand!.ccAvailableCoveredContracts).toBe(1);
    expect(cand!.credit).toBeCloseTo(cand!.ccPremiumPerContract! * 1, 2);
  });

  // Deterministic tie-breaking: two contracts equally close to the delta
  // center — higher OI wins.
  it('tie-break: equally delta-close contracts resolve by higher open interest', () => {
    const expDate = nearTermExpDate(30);
    const centerDelta = (RULES.DELTA_MIN + RULES.DELTA_MAX) / 2; // 0.275
    const legLowOi = legAt(105, { delta: centerDelta - 0.02, oi: 150, occSymbol: 'LOW_OI' }, expDate);
    const legHighOi = legAt(108, { delta: centerDelta + 0.02, oi: 900, occSymbol: 'HIGH_OI' }, expDate);
    const chain = { expirations: [expDate], chains: { [expDate]: [legLowOi, legHighOi] } };
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 });
    expect(cand?.shortOccSymbol).toBe('HIGH_OI');
  });
});
