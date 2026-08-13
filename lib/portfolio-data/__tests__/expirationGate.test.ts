import { describe, expect, it } from 'vitest';
import { getRecommendation, shouldShowExpirationGateNote } from '../acquisition';
import type { Position, PositionLeg, PositionSnapshot } from '../types';

// ── Fixtures (mirrors the pattern in stopLossWiring.test.ts) ───────────────
function leg(overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    symbol: 'MU   260918P00095000',
    optionType: 'P',
    strikePrice: 95,
    direction: 'Short',
    quantity: 5,
    avgOpenPrice: 2.52,
    currentPrice: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    date: '2026-08-01',
    dte: 21,
    currentValue: 1200,
    pnl: 60,
    pnlPct: 4.76,
    iv: 40,
    ivr: 50,
    theta: 0.5,
    gamma: -0.02,
    netDelta: -0.1,
    netVega: -0.2,
    pop: 70,
    buffer: 13.6,
    stockPrice: 110,
    ...overrides,
  };
}

// Minimal-but-complete Position fixture, defaulted to a past-21-DTE
// (needsClose=true) BPS that would otherwise be a candidate for the PI-0007
// gate. Individual tests override pop/netDelta/buffer/strategy/snapshotHistory
// to drive the gate into each branch.
function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    key: 'MU::2026-09-18',
    symbol: 'MU',
    expDate: '2026-09-18',
    dte: 18,
    strategy: 'BPS',
    legs: [leg(), leg({ symbol: 'MU   260918P00090000', strikePrice: 90, direction: 'Long', avgOpenPrice: 2.02 })],
    quantity: 5,
    identity: null,
    structureAmbiguous: false,
    structureBlockMessage: null,
    entryPriceEffect: 'Credit',
    creditReceived: 1260,
    currentValue: 1200,
    closeValue: 1200,
    closeNowPnl: 60,
    pnl: 60,
    pnlPct: 4.76,
    pnlReliable: true,
    intent: 'income',
    plOpen: null,
    targetPrice: 630,
    profitTarget: 0.5,
    maxRisk: 1240,
    hitTarget: false,
    needsClose: true,
    entryDte: 45,
    entryDate: '2026-08-01',
    accountNumber: 'ACCT-1',
    ivr: 50,
    iv: 40,
    hv30: 35,
    beta: 1.1,
    netDelta: -0.1,
    netVega: -0.2,
    pop: 80,
    hasGtc: true,
    gtcOrderId: 'gtc-1',
    gtcOrderPrice: 1.26,
    stopLossStatus: 'unknown',
    stopLossPrice: null,
    stopLossPolicy: null,
    stopLossDisplayPolicy: null,
    stopLossClassification: 'NO_STOP',
    stopLossOrderStatus: null,
    quoteWidthEvidence: null,
    stockPrice: 110,
    buffer: 13.6,
    putBufferPct: 13.6,
    callBufferPct: null,
    theta: 0.5,
    gamma: -0.02,
    earningsDate: null,
    snapshotHistory: [],
    ...overrides,
  } as Position;
}

describe('PI-0007 expiration gate (via getRecommendation)', () => {
  it('returns HOLD_TO_EXPIRATION when POP>75, delta within entry ceiling, buffer>6', () => {
    const pos = makePosition({ pop: 82, netDelta: -0.18, buffer: 9.5 });
    const rec = getRecommendation(pos, null);
    expect(rec.action).toBe('HOLD_TO_EXPIRATION');
    expect(rec.detail).toMatch(/statistically safe/i);
  });

  it('returns MANAGE when POP is at or below 75%, even with safe delta/buffer', () => {
    const pos = makePosition({ pop: 75, netDelta: -0.18, buffer: 9.5 });
    const rec = getRecommendation(pos, null);
    expect(rec.action).toBe('MANAGE');
    expect(rec.detail).toMatch(/POP.*below 75%/i);
  });

  it('returns MANAGE when POP is unknown (null)', () => {
    const pos = makePosition({ pop: null, netDelta: -0.18, buffer: 9.5 });
    const rec = getRecommendation(pos, null);
    expect(rec.action).toBe('MANAGE');
    expect(rec.detail).toMatch(/POP unknown/i);
  });

  it('returns MANAGE when delta has drifted past the BPS entry ceiling (0.30), even with high POP/buffer', () => {
    const pos = makePosition({ strategy: 'BPS', pop: 90, netDelta: -0.35, buffer: 9.5 });
    const rec = getRecommendation(pos, null);
    expect(rec.action).toBe('MANAGE');
    expect(rec.detail).toMatch(/drifted past 0.3 entry ceiling/i);
  });

  it('respects the IC entry ceiling (0.20) instead of the BPS/BCS 0.30 default', () => {
    const safeForBps = makePosition({ strategy: 'IC', pop: 90, netDelta: 0.25, buffer: 9.5 });
    const rec = getRecommendation(safeForBps, null);
    // 0.25 is within BPS/BCS's 0.30 ceiling but past IC's 0.20 ceiling
    expect(rec.action).toBe('MANAGE');
    expect(rec.detail).toMatch(/0.2 entry ceiling/);
  });

  it('does not block safety on an unknown (null) delta', () => {
    const pos = makePosition({ pop: 90, netDelta: null, buffer: 9.5 });
    const rec = getRecommendation(pos, null);
    expect(rec.action).toBe('HOLD_TO_EXPIRATION');
  });

  describe('buffer hysteresis', () => {
    it('requires buffer > 6% to ENTER the safe state when no prior snapshot exists', () => {
      const pos = makePosition({ pop: 90, netDelta: -0.1, buffer: 5.5, snapshotHistory: [] });
      const rec = getRecommendation(pos, null);
      expect(rec.action).toBe('MANAGE');
      expect(rec.detail).toMatch(/Buffer 5.5%.*below/i);
    });

    it('requires buffer > 6% to ENTER the safe state when the last snapshot was also unsafe (buffer <= 6)', () => {
      const pos = makePosition({
        pop: 90, netDelta: -0.1, buffer: 5.5,
        snapshotHistory: [snapshot({ buffer: 5.0 })],
      });
      const rec = getRecommendation(pos, null);
      expect(rec.action).toBe('MANAGE');
    });

    it('allows buffer to stay safe down to just above 4% once already in the safe state (last snapshot buffer > 6)', () => {
      const pos = makePosition({
        pop: 90, netDelta: -0.1, buffer: 4.5,
        snapshotHistory: [snapshot({ buffer: 8.0 })],
      });
      const rec = getRecommendation(pos, null);
      expect(rec.action).toBe('HOLD_TO_EXPIRATION');
    });

    it('exits the safe state once buffer drops to 4% or below, even if it was previously safe', () => {
      const pos = makePosition({
        pop: 90, netDelta: -0.1, buffer: 3.9,
        snapshotHistory: [snapshot({ buffer: 8.0 })],
      });
      const rec = getRecommendation(pos, null);
      expect(rec.action).toBe('MANAGE');
    });
  });

  describe('hard-exit paths remain untouched by the gate', () => {
    it('still returns CUT_LOSSES on a breached strike (buffer <= 0), regardless of POP/delta', () => {
      const pos = makePosition({ pop: 95, netDelta: -0.1, buffer: -1, needsClose: true });
      const rec = getRecommendation(pos, null);
      expect(rec.action).toBe('CUT_LOSSES');
      expect(rec.detail).toMatch(/breached/i);
    });

    it('does not evaluate the expiration gate at all when needsClose is false', () => {
      const pos = makePosition({ needsClose: false, pop: 10, netDelta: -0.5, buffer: 0.5, hitTarget: false, hasGtc: true, pnlPct: 5 });
      const rec = getRecommendation(pos, null);
      expect(rec.action).not.toBe('HOLD_TO_EXPIRATION');
      // With hasGtc true, low pnlPct, no trend, no hitTarget -> falls through to plain HOLD
      expect(rec.action).toBe('HOLD');
    });
  });
});

describe('PI-0010 shouldShowExpirationGateNote', () => {
  it('shows the note when a higher-priority signal (e.g. verify-stop MANAGE) is occupying the primary slot but the gate itself reads safe', () => {
    // High POP/safe buffer -- gate would say HOLD_TO_EXPIRATION on its own --
    // but the primary action is MANAGE because something else (stop
    // verification, in the real card) took priority in getRecommendation.
    const pos = makePosition({ pop: 82, netDelta: -0.18, buffer: 9.5, needsClose: true });
    expect(shouldShowExpirationGateNote(pos, 'MANAGE')).toBe(true);
  });

  it('does not show the note when the primary action already IS HOLD_TO_EXPIRATION (would be redundant)', () => {
    const pos = makePosition({ pop: 82, netDelta: -0.18, buffer: 9.5, needsClose: true });
    expect(shouldShowExpirationGateNote(pos, 'HOLD_TO_EXPIRATION')).toBe(false);
  });

  it('does not show the note when the gate itself reads unsafe, regardless of primary action', () => {
    const pos = makePosition({ pop: 40, netDelta: -0.18, buffer: 9.5, needsClose: true }); // low POP -> gate unsafe
    expect(shouldShowExpirationGateNote(pos, 'MANAGE')).toBe(false);
    expect(shouldShowExpirationGateNote(pos, 'CUT_LOSSES')).toBe(false);
  });

  it('does not show the note when needsClose is false, regardless of gate safety', () => {
    const pos = makePosition({ pop: 90, netDelta: -0.1, buffer: 20, needsClose: false });
    expect(shouldShowExpirationGateNote(pos, 'HOLD')).toBe(false);
  });

  it('agrees with getRecommendation on gate safety for the same position (no drift between the two code paths)', () => {
    const safePos = makePosition({ pop: 90, netDelta: -0.1, buffer: 9.5, needsClose: true });
    const rec = getRecommendation(safePos, null);
    expect(rec.action).toBe('HOLD_TO_EXPIRATION');
    // Since the primary action already IS HOLD_TO_EXPIRATION, the note
    // should NOT show -- this is the one case where "gate says safe" and
    // "show the note" correctly diverge, by design (no redundant display).
    expect(shouldShowExpirationGateNote(safePos, rec.action)).toBe(false);
  });
});
