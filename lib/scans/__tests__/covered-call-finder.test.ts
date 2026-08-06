// lib/scans/__tests__/covered-call-finder.test.ts
// TE-0007C — candidate-selection tests (ticket "Testing" §2, cases 1–10).
import { describe, it, expect } from 'vitest';
import { findBestCoveredCall } from '../covered-call-finder';
import { computeCoveredCallCapacity } from '../covered-call-capacity';
import type { CcRulesType } from '../constants';
import type { WheelChainResult } from '@/lib/wheel/chainSearch';

const RULES: CcRulesType = {
  DELTA_MIN: 0.20, DELTA_MAX: 0.35,
  DTE_MIN: 21, DTE_MAX: 45,
  OI_MIN: 100, BID_ASK_MAX: 0.20,
};

function makeChain(overrides: Partial<WheelChainResult> = {}): { expirations: string[]; chains: Record<string, any[]> } {
  const expDate = '2026-09-18';
  return {
    expirations: [expDate],
    chains: {
      [expDate]: [
        { strikePrice: 105, expirationDate: expDate, optionType: 'C', delta: 0.28, openInterest: 500, bid: 1.20, ask: 1.30, mid: 1.25, occSymbol: 'TEST260918C00105000' },
        { strikePrice: 95, expirationDate: expDate, optionType: 'P', delta: -0.25, openInterest: 500, bid: 1.00, ask: 1.10, mid: 1.05, occSymbol: 'TEST260918P00095000' },
      ],
    },
    ...overrides,
  } as any;
}

function chainWithDte(dte: number, opts: { strike?: number; delta?: number; oi?: number; bid?: number; ask?: number } = {}) {
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
    expect(cand?.shortStrike).toBe(105);
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
    const chain = chainWithDte(30, { strike: 95 });
    expect(findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).toBeNull();
  });

  it('5. rejects strikes below known cost basis', () => {
    const chain = chainWithDte(30, { strike: 105 });
    const capacityHighBasis = computeCoveredCallCapacity(500, 0, 0, 110);
    expect(findBestCoveredCall(chain, { rules: RULES, capacity: capacityHighBasis, stockPrice: 100 })).toBeNull();
  });

  it('6. returns no candidate when none qualify', () => {
    const chain = { expirations: [], chains: {} };
    expect(findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 })).toBeNull();
  });

  it('7. produces correct premium, yield, annualized yield, and assignment math', () => {
    const chain = chainWithDte(36, { strike: 105, bid: 1.20, ask: 1.30 });
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100 });
    expect(cand).not.toBeNull();
    expect(cand!.ccPremiumPerShare).toBeCloseTo(1.25, 4);
    expect(cand!.ccPremiumPerContract).toBeCloseTo(125, 2);
    expect(cand!.ccPeriodYieldOnShares).toBeCloseTo(1.25, 4);
    expect(cand!.ccAssignmentProceeds).toBeCloseTo(10500, 2);
  });

  it('8. quantity never exceeds available covered contracts', () => {
    const chain = chainWithDte(30, { strike: 105 });
    const capacityTwo = computeCoveredCallCapacity(250, 0, 0, 90);
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: capacityTwo, stockPrice: 100 });
    expect(cand).not.toBeNull();
    expect(cand!.ccAvailableCoveredContracts).toBe(2);
    expect(cand!.credit).toBeCloseTo(cand!.ccPremiumPerContract! * 2, 2);
  });

  it('9. leg ordering does not affect open-short-call exposure (finder side)', () => {
    const dte = 30;
    const d = new Date(); d.setDate(d.getDate() + dte);
    const expDate = d.toISOString().slice(0, 10);
    const legA = { strikePrice: 105, expirationDate: expDate, optionType: 'C', delta: 0.28, openInterest: 500, bid: 1.20, ask: 1.30, mid: 1.25, occSymbol: 'A' };
    const legB = { strikePrice: 110, expirationDate: expDate, optionType: 'C', delta: 0.15, openInterest: 500, bid: 0.50, ask: 0.60, mid: 0.55, occSymbol: 'B' };
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
    const zeroCapacity = computeCoveredCallCapacity(100, 1, 0, 90);
    expect(findBestCoveredCall(chain, { rules: RULES, capacity: zeroCapacity, stockPrice: 100 })).toBeNull();
  });

  it('earnings within expiry window -> no candidate', () => {
    const chain = chainWithDte(30, { strike: 105 });
    const cand = findBestCoveredCall(chain, { rules: RULES, capacity: fullCapacity, stockPrice: 100, earningsWithinExpiry: true });
    expect(cand).toBeNull();
  });
});
