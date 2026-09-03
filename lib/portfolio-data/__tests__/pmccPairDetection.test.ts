import { describe, expect, it } from 'vitest';
import { findPairedShortCall, isPairedPmccLong } from '../pmccPairDetection';
import { PMCC_LONG_DTE_MIN, PMCC_SHORT_DTE_MAX } from '@/lib/portfolio/positionLifecycle';
import type { Position, PositionLeg } from '../types';

// ── Fixtures ────────────────────────────────────────────────────────────
function leg(overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    symbol: 'NFLX  270618C00700000',
    optionType: 'C',
    strikePrice: 700,
    direction: 'Long',
    quantity: 1,
    avgOpenPrice: 50,
    currentPrice: null,
    ...overrides,
  };
}

function position(overrides: Partial<Position> = {}): Position {
  return {
    key: 'NFLX::2027-06-18',
    symbol: 'NFLX',
    expDate: '2027-06-18',
    dte: 300,
    strategy: 'PMCC',
    legs: [leg()],
    quantity: 1,
    identity: null,
    structureAmbiguous: false,
    structureBlockMessage: null,
    entryPriceEffect: 'Debit',
    entryCredit: null,
    entryEconomicsComplete: false,
    creditReceived: 0,
    currentValue: 5000,
    closeValue: 5000,
    closeNowPnl: null,
    pnl: null,
    pnlPct: null,
    pnlReliable: false,
    intent: 'income',
    plOpen: null,
    targetPrice: 0,
    profitTarget: 0.5,
    maxRisk: 5000,
    hitTarget: false,
    needsClose: false,
    entryDte: 300,
    entryDate: '2026-09-01',
    accountNumber: 'ACCT-1',
    ivr: 40,
    iv: 35,
    hv30: 30,
    beta: 1.1,
    netDelta: 0.7,
    netVega: 0.3,
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
    stockPrice: 720,
    buffer: null,
    putBufferPct: null,
    callBufferPct: null,
    theta: 0.4,
    gamma: 0.01,
    earningsDate: null,
    ...overrides,
  } as Position;
}

const longLeg = () => leg({ direction: 'Long', optionType: 'C' });
const shortLeg = (overrides: Partial<PositionLeg> = {}) => leg({ direction: 'Short', optionType: 'C', symbol: 'NFLX  261016C00750000', strikePrice: 750, ...overrides });

describe('findPairedShortCall', () => {
  it('returns null when no candidate short call exists', () => {
    const long = position({ key: 'long-1', legs: [longLeg()], dte: PMCC_LONG_DTE_MIN + 50 });
    expect(findPairedShortCall(long, [long])).toBeNull();
  });

  it('matches a held short call on the same symbol within the PMCC DTE shape', () => {
    const long = position({ key: 'long-1', legs: [longLeg()], dte: PMCC_LONG_DTE_MIN + 50 });
    const short = position({ key: 'short-1', legs: [shortLeg()], dte: PMCC_SHORT_DTE_MAX - 15, strategy: 'CC' });
    expect(findPairedShortCall(long, [long, short])?.key).toBe('short-1');
    expect(isPairedPmccLong(long, [long, short])).toBe(true);
  });

  it('returns null when the long leg does not clear the long-dated bar (Ian)', () => {
    // A short-dated long call paired with an even-shorter call is a spread,
    // not a PMCC base -- must fail even with an otherwise-valid short match.
    const long = position({ key: 'long-1', legs: [longLeg()], dte: PMCC_LONG_DTE_MIN - 10 });
    const short = position({ key: 'short-1', legs: [shortLeg()], dte: PMCC_SHORT_DTE_MAX - 15, strategy: 'CC' });
    expect(findPairedShortCall(long, [long, short])).toBeNull();
  });

  it('is exact at the long-leg DTE boundary (121 qualifies, 119 does not)', () => {
    const short = position({ key: 'short-1', legs: [shortLeg()], dte: PMCC_SHORT_DTE_MAX - 15, strategy: 'CC' });
    const longAbove = position({ key: 'long-above', legs: [longLeg()], dte: PMCC_LONG_DTE_MIN + 1 });
    const longBelow = position({ key: 'long-below', legs: [longLeg()], dte: PMCC_LONG_DTE_MIN - 1 });
    expect(findPairedShortCall(longAbove, [longAbove, short])?.key).toBe('short-1');
    expect(findPairedShortCall(longBelow, [longBelow, short])).toBeNull();
  });

  it('is exact at the short-leg DTE boundary (59 qualifies, 61 does not)', () => {
    const long = position({ key: 'long-1', legs: [longLeg()], dte: PMCC_LONG_DTE_MIN + 50 });
    const shortBelow = position({ key: 'short-below', legs: [shortLeg()], dte: PMCC_SHORT_DTE_MAX - 1, strategy: 'CC' });
    const shortAbove = position({ key: 'short-above', legs: [shortLeg({ symbol: 'NFLX  270101C00800000', strikePrice: 800 })], dte: PMCC_SHORT_DTE_MAX + 1, strategy: 'CC' });
    expect(findPairedShortCall(long, [long, shortBelow])?.key).toBe('short-below');
    expect(findPairedShortCall(long, [long, shortAbove])).toBeNull();
  });

  it('resolves multiple candidate short calls to the soonest-expiring match', () => {
    const long = position({ key: 'long-1', legs: [longLeg()], dte: PMCC_LONG_DTE_MIN + 50 });
    const olderShort = position({ key: 'short-older', legs: [shortLeg()], dte: 45, strategy: 'CC' });
    const soonerShort = position({ key: 'short-sooner', legs: [shortLeg({ symbol: 'NFLX  260920C00760000', strikePrice: 760 })], dte: 20, strategy: 'CC' });
    expect(findPairedShortCall(long, [long, olderShort, soonerShort])?.key).toBe('short-sooner');
  });

  it('matches regardless of the short leg being structurally ambiguous (Alan) -- pairing is a fact independent of the short leg\'s own structure state', () => {
    const long = position({ key: 'long-1', legs: [longLeg()], dte: PMCC_LONG_DTE_MIN + 50 });
    const short = position({ key: 'short-1', legs: [shortLeg()], dte: PMCC_SHORT_DTE_MAX - 15, strategy: 'CC', structureAmbiguous: true, structureBlockMessage: 'Position structure is ambiguous.' });
    expect(findPairedShortCall(long, [long, short])?.key).toBe('short-1');
  });

  it('ignores multi-leg positions, puts, and short calls that are not a bare single leg', () => {
    const long = position({ key: 'long-1', legs: [longLeg()], dte: PMCC_LONG_DTE_MIN + 50 });
    const spreadOnSameSymbol = position({
      key: 'spread-1', strategy: 'BCS', dte: 30,
      legs: [shortLeg(), leg({ direction: 'Long', optionType: 'C', symbol: 'NFLX  261016C00780000', strikePrice: 780 })],
    });
    const putOnSameSymbol = position({ key: 'put-1', strategy: 'CSP', dte: 30, legs: [shortLeg({ optionType: 'P', symbol: 'NFLX  261016P00600000', strikePrice: 600 })] });
    expect(findPairedShortCall(long, [long, spreadOnSameSymbol, putOnSameSymbol])).toBeNull();
  });

  it('ignores candidate short calls on a different symbol', () => {
    const long = position({ key: 'long-1', legs: [longLeg()], dte: PMCC_LONG_DTE_MIN + 50 });
    const otherSymbolShort = position({ key: 'short-other', symbol: 'UBER', legs: [shortLeg({ symbol: 'UBER  261016C00080000', strikePrice: 80 })], dte: 20, strategy: 'CC' });
    expect(findPairedShortCall(long, [long, otherSymbolShort])).toBeNull();
  });
});
