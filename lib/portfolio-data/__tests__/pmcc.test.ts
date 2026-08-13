// lib/portfolio-data/__tests__/pmcc.test.ts
//
// PMCC-0003: unit coverage for the pure functions behind PMCC linking and
// display -- attachPmccLinks, calcLeapIntrinsicExtrinsic, isLeapDecayDue.
// Deliberately does NOT attempt to render PmccManagerPanel/PmccGroup
// (page.tsx components) -- same proportionate-testing rationale as
// PI-0010/PI-0011: those components depend on live position data, network
// calls, and modal-open interaction state, and the logic worth testing in
// isolation is fully captured by these pure functions.

import { describe, expect, it } from 'vitest';
import { attachPmccLinks, calcLeapIntrinsicExtrinsic, isLeapDecayDue, LEAP_DECAY_DTE_THRESHOLD } from '../acquisition';
import type { Position, PositionLeg, PmccLink } from '../types';

function leg(overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    symbol: 'NVDA  270917C00165000',
    optionType: 'C',
    strikePrice: 165,
    direction: 'Long',
    quantity: 1,
    avgOpenPrice: 76.50,
    currentPrice: null,
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    key: 'NVDA::2027-09-17',
    symbol: 'NVDA',
    expDate: '2027-09-17',
    dte: 401,
    strategy: 'PMCC',
    legs: [leg()],
    quantity: 1,
    identity: null,
    structureAmbiguous: false,
    structureBlockMessage: null,
    entryPriceEffect: 'Debit',
    creditReceived: 0,
    currentValue: 7650,
    closeValue: 7650,
    closeNowPnl: 0,
    pnl: 0,
    pnlPct: 0,
    pnlReliable: true,
    intent: 'income',
    plOpen: null,
    targetPrice: 0,
    profitTarget: 0.5,
    maxRisk: 7190,
    hitTarget: false,
    needsClose: false,
    entryDte: 401,
    entryDate: '2026-08-12',
    accountNumber: 'ACCT-1',
    ivr: 40,
    iv: 35,
    hv30: 30,
    beta: 1.7,
    netDelta: 0.80,
    netVega: 0.5,
    pop: null,
    hasGtc: false,
    gtcOrderId: null,
    gtcOrderPrice: null,
    stopLossStatus: 'unknown',
    stopLossPrice: null,
    stopLossPolicy: null,
    stopLossDisplayPolicy: null,
    stopLossClassification: 'NO_STOP',
    stopLossOrderStatus: null,
    quoteWidthEvidence: null,
    stockPrice: 223.55,
    buffer: null,
    putBufferPct: null,
    callBufferPct: null,
    theta: 0.02,
    gamma: 0.001,
    earningsDate: null,
    ...overrides,
  } as Position;
}

function makeLink(overrides: Partial<PmccLink> = {}): PmccLink {
  return {
    id: 'link-1',
    leapPositionKey: 'NVDA::2027-09-17',
    shortCallPositionKey: 'NVDA::2026-09-25',
    openedDate: '2026-08-12',
    leapCost: 7190,
    cumulativePremiumCollected: 460,
    rollCount: 1,
    ...overrides,
  };
}

describe('PMCC-0003 attachPmccLinks', () => {
  it('tags the LEAP position with pmccRole "leap" when it matches leapPositionKey', () => {
    const leapPos = makePosition({ key: 'NVDA::2027-09-17' });
    const link = makeLink();
    const [tagged] = attachPmccLinks([leapPos], { 'NVDA::2027-09-17': link });
    expect(tagged.pmccRole).toBe('leap');
    expect(tagged.pmccLink).toEqual(link);
  });

  it('tags the short-call position with pmccRole "short" when it matches shortCallPositionKey', () => {
    const shortPos = makePosition({ key: 'NVDA::2026-09-25', legs: [leg({ direction: 'Short', strikePrice: 245 })] });
    const link = makeLink();
    const [tagged] = attachPmccLinks([shortPos], { 'NVDA::2027-09-17': link });
    expect(tagged.pmccRole).toBe('short');
  });

  it('leaves an unrelated position untagged (pmccLink null, pmccRole null)', () => {
    const unrelated = makePosition({ key: 'AAPL::2026-09-18' });
    const link = makeLink();
    const [tagged] = attachPmccLinks([unrelated], { 'NVDA::2027-09-17': link });
    expect(tagged.pmccLink).toBeNull();
    expect(tagged.pmccRole).toBeNull();
  });

  it('handles an empty links store without error', () => {
    const pos = makePosition();
    const [tagged] = attachPmccLinks([pos], {});
    expect(tagged.pmccLink).toBeNull();
  });

  it('does not mutate dte/expDate on either tagged position -- core single-expiration fields are untouched', () => {
    const leapPos = makePosition({ key: 'NVDA::2027-09-17', dte: 401, expDate: '2027-09-17' });
    const link = makeLink();
    const [tagged] = attachPmccLinks([leapPos], { 'NVDA::2027-09-17': link });
    expect(tagged.dte).toBe(401);
    expect(tagged.expDate).toBe('2027-09-17');
  });
});

describe('PMCC-0003 calcLeapIntrinsicExtrinsic', () => {
  it('computes intrinsic as max(0, stockPrice - strike) * 100 * qty, extrinsic as the remainder', () => {
    // stock $223.55, strike $165 -> intrinsic $58.55/share * 100 = $5855 total (qty 1)
    const { intrinsic, extrinsic } = calcLeapIntrinsicExtrinsic(223.55, 165, 7650, 1);
    expect(intrinsic).toBeCloseTo(5855, 2);
    expect(extrinsic).toBeCloseTo(7650 - 5855, 2);
  });

  it('floors intrinsic at 0 when the LEAP is out of the money (stock below strike)', () => {
    const { intrinsic, extrinsic } = calcLeapIntrinsicExtrinsic(150, 165, 500, 1);
    expect(intrinsic).toBe(0);
    expect(extrinsic).toBe(500); // entire market value is extrinsic when OTM
  });

  it('scales intrinsic by quantity', () => {
    const { intrinsic } = calcLeapIntrinsicExtrinsic(223.55, 165, 15300, 2);
    expect(intrinsic).toBeCloseTo(5855 * 2, 2);
  });

  it('returns nulls for both when any required input is missing, never fabricating a partial value', () => {
    expect(calcLeapIntrinsicExtrinsic(null, 165, 7650, 1)).toEqual({ intrinsic: null, extrinsic: null });
    expect(calcLeapIntrinsicExtrinsic(223.55, null, 7650, 1)).toEqual({ intrinsic: null, extrinsic: null });
    expect(calcLeapIntrinsicExtrinsic(223.55, 165, null, 1)).toEqual({ intrinsic: null, extrinsic: null });
  });
});

describe('PMCC-0003 isLeapDecayDue', () => {
  it('is true for a leap-role position at or below the decay threshold', () => {
    const pos = makePosition({ pmccRole: 'leap', dte: LEAP_DECAY_DTE_THRESHOLD });
    expect(isLeapDecayDue(pos)).toBe(true);
  });

  it('is false for a leap-role position above the decay threshold', () => {
    const pos = makePosition({ pmccRole: 'leap', dte: LEAP_DECAY_DTE_THRESHOLD + 1 });
    expect(isLeapDecayDue(pos)).toBe(false);
  });

  it('is false for a short-role position regardless of dte -- this clock is LEAP-specific only', () => {
    const pos = makePosition({ pmccRole: 'short', dte: 10 });
    expect(isLeapDecayDue(pos)).toBe(false);
  });

  it('is false for an unlinked (pmccRole null) position regardless of dte', () => {
    const pos = makePosition({ pmccRole: null, dte: 10 });
    expect(isLeapDecayDue(pos)).toBe(false);
  });
});
