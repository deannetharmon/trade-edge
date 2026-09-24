import { describe, expect, it } from 'vitest';
import { evaluatePmccDecision, PMCC_DECISION_POLICY_VERSION, pmccDecisionRankEligible } from '../pmccDecision';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '../pmccConfig';
import type { PmccPairResult, PmccPairingCriteria, PmccQuoteQuality } from '../pmccTypes';

const criteria: PmccPairingCriteria = {
  dte: { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 },
  shortDelta: { min: 0.20, max: 0.35 },
  longOiMin: 100,
  shortOiMin: 100,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY,
  limits: DEFAULT_PMCC_PAIRING_LIMITS,
};

const quote = (status: PmccQuoteQuality['status'], readyInput: boolean): PmccQuoteQuality => ({
  bid: 10, ask: 10.2, midpoint: 10.1, width: 0.2, spreadPct: 1.98,
  quoteTimestamp: '2026-09-04T19:59:30.000Z', ageSeconds: 30, delayed: false,
  structurallyUsable: true, withinQualifyingWidth: true, readyInput, status,
  reason: status === 'market_closed' ? 'Regular market session is not open' : status === 'stale' ? 'Quote is stale' : 'Quote is actionable and fresh',
});

const pair = (entryMode: PmccPairResult['entryMode'], longQuote = quote('acceptable', true), shortQuote = quote('acceptable', true)): PmccPairResult => ({
  pairId: 'occ:LONG::occ:SHORT', symbol: 'NFLX', qualified: true, insufficientData: false,
  failureReasons: [], primaryFailureReason: null, orderingLabel: 'Contract order', entryMode,
  ...(entryMode === 'covered-short-call-against-held-leaps' ? { heldLongLeg: { accountNumber: 'redacted', positionKey: 'position-1', quantity: 1, occSymbol: 'NFLX270917C00070000' } } : {}),
  longLeg: { candidateId: 'occ:LONG', role: 'long', underlyingSymbol: 'NFLX', expiration: '2027-09-17', dte: 375, strike: 70, delta: 0.68, openInterest: 72, occSymbol: 'NFLX270917C00070000', quote: longQuote, executablePrice: 20, intrinsic: 8, extrinsic: 12 },
  shortLeg: { candidateId: 'occ:SHORT', role: 'short', underlyingSymbol: 'NFLX', expiration: '2026-10-09', dte: 32, strike: 83, delta: 0.31, openInterest: 208, occSymbol: 'NFLX261009C00083000', quote: shortQuote, executablePrice: 1.46, intrinsic: null, extrinsic: null },
  metrics: { netDebitPerShare: 18.54, strikeWidth: 13, widthMinusDebitPerShare: -5.54, widthMinusDebitPctOfDebit: -29.88, longIntrinsicPerShare: 8, longExtrinsicPerShare: 12, shortCreditToNetDebitPct: 7.87, shortCreditToLongExtrinsicPct: 12.17, netDelta: 0.37 },
});

describe('canonical PMCC decision', () => {
  it('keeps a held 0.68-delta LEAPS qualified at market close and explains the preference variance', () => {
    const decision = evaluatePmccDecision({ pair: pair('covered-short-call-against-held-leaps', quote('market_closed', false), quote('market_closed', false)), criteria, marketSession: 'closed' });
    expect(decision).toMatchObject({ policyVersion: PMCC_DECISION_POLICY_VERSION, qualification: 'QUALIFIED', readiness: 'MARKET_CLOSED', action: 'HELD_PMCC_REVIEW_ONLY' });
    expect(decision.gates.find(gate => gate.code === 'HELD_LONG_DELTA_PREFERENCE')?.explanation).toContain('0.02 below');
    expect(decision.gates.find(gate => gate.code === 'HELD_LONG_OI_PREFERENCE')?.status).toBe('warning');
    expect(pmccDecisionRankEligible(decision)).toBe(true);
  });

  it('disqualifies the same 0.68 delta when purchasing a new PMCC long', () => {
    const decision = evaluatePmccDecision({ pair: pair('new-pmcc'), criteria, marketSession: 'open' });
    expect(decision).toMatchObject({ qualification: 'DISQUALIFIED', action: 'BLOCKED' });
    expect(decision.gates).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'NEW_LONG_DELTA', status: 'fail' })]));
  });

  // PMCC-COMPARE-HELD-0001 (4ea75ed7): for a held long, only the short leg being sold gates readiness -- the long
  // leg is already owned, so its quote quality must never block reviewing the short call. This test previously put
  // the stale quote on the long leg; the stale evidence that matters for a held pair is the SHORT leg's.
  it('uses Wait/Monitor for a stale short-leg quote and excludes it from ranking', () => {
    const decision = evaluatePmccDecision({ pair: pair('covered-short-call-against-held-leaps', quote('acceptable', true), quote('stale', false)), criteria, marketSession: 'open' });
    expect(decision).toMatchObject({ qualification: 'QUALIFIED', readiness: 'WAIT_MONITOR', action: 'BLOCKED' });
    expect(pmccDecisionRankEligible(decision)).toBe(false);
  });

  it('does not gate a held pair on a stale long-leg quote (only the short leg being sold gates readiness)', () => {
    const decision = evaluatePmccDecision({ pair: pair('covered-short-call-against-held-leaps', quote('stale', false), quote('acceptable', true)), criteria, marketSession: 'open' });
    expect(decision.readiness).toBe('READY');
    expect(decision.gates.find(gate => gate.code === 'QUOTES_READY')?.status).toBe('pass');
  });

  it('still gates a new-entry pair on a stale long-leg quote (both legs are transacted)', () => {
    const decision = evaluatePmccDecision({ pair: pair('new-pmcc', quote('stale', false), quote('acceptable', true)), criteria, marketSession: 'open' });
    expect(decision.readiness).toBe('WAIT_MONITOR');
  });

  it('keeps a structural failure disqualified even when the market is closed', () => {
    const invalid = pair('covered-short-call-against-held-leaps', quote('market_closed', false), quote('market_closed', false));
    invalid.qualified = false;
    invalid.failureReasons = [{ code: 'LONG_STRIKE_NOT_BELOW_SHORT', message: 'Long strike must be below short strike' }];
    invalid.primaryFailureReason = invalid.failureReasons[0];
    const decision = evaluatePmccDecision({ pair: invalid, criteria, marketSession: 'closed' });
    expect(decision).toMatchObject({ qualification: 'DISQUALIFIED', readiness: 'MARKET_CLOSED', action: 'BLOCKED' });
    expect(pmccDecisionRankEligible(decision)).toBe(false);
  });

  // SCAN-ALIGN-0001F (F2): short delta is a hard filter at pairing (DELTA_OUT_OF_RANGE; asserted in
  // pmccPairing.test.ts and scanAlignF2DeltaHard.test.ts), so an out-of-window short never reaches a
  // decision. The NEW_SHORT_DELTA gate (a warning) is deleted in both modes.
  it('no NEW_SHORT_DELTA gate exists: delta is decided at pairing, not disclosed as a warning', () => {
    const offWindow = pair('new-pmcc');
    offWindow.longLeg = { ...offWindow.longLeg, delta: 0.75 };
    offWindow.shortLeg = { ...offWindow.shortLeg, delta: 0.45 };
    const held = pair('covered-short-call-against-held-leaps');
    held.shortLeg = { ...held.shortLeg, delta: 0.45 };
    [offWindow, held, pair('new-pmcc'), pair('covered-short-call-against-held-leaps')].forEach(candidate => {
      const decision = evaluatePmccDecision({ pair: candidate, criteria, marketSession: 'open' });
      expect(decision.gates.map(g => g.code)).not.toContain('NEW_SHORT_DELTA');
    });
    // The decision layer no longer second-guesses the short delta: it neither warns nor disqualifies.
    expect(evaluatePmccDecision({ pair: offWindow, criteria, marketSession: 'open' }).qualification).toBe('QUALIFIED');
  });

  // PMCC-HEALTH-CHECK-0002: EXTRINSIC_RATIO
  describe('EXTRINSIC_RATIO', () => {
    function pairWithRatio(shortExtrinsic: number, shortDte: number, longExtrinsic: number, longDte: number, entryMode: 'new-pmcc' | 'covered-short-call-against-held-leaps' = 'new-pmcc') {
      const p = pair(entryMode);
      p.shortLeg = { ...p.shortLeg, extrinsic: shortExtrinsic, dte: shortDte };
      // delta: 0.75 keeps this within criteria.longDelta (0.70-0.85) so
      // NEW_LONG_DELTA (an unrelated gate) never disqualifies these tests --
      // the default fixture's 0.68 deliberately fails new-pmcc mode to test
      // a different scenario elsewhere in this file.
      p.longLeg = { ...p.longLeg, extrinsic: longExtrinsic, dte: longDte, delta: 0.75 };
      return p;
    }

    it('reports unavailable, not a false warning, when either leg\u2019s extrinsic is null', () => {
      const p = pair('new-pmcc'); // default fixture has shortLeg.extrinsic: null
      const decision = evaluatePmccDecision({ pair: p, criteria, marketSession: 'open' });
      expect(decision.gates.find(g => g.code === 'EXTRINSIC_RATIO')?.status).toBe('unavailable');
    });

    it('exactly 1.00 (the pass/warning boundary) is a pass, not a warning', () => {
      // shortDailyRate = 1/30 = 0.03333; longDailyRate = 10/300 = 0.03333 -> ratio = 1.0 exactly
      const p = pairWithRatio(1, 30, 10, 300);
      const decision = evaluatePmccDecision({ pair: p, criteria, marketSession: 'open' });
      const gate = decision.gates.find(g => g.code === 'EXTRINSIC_RATIO');
      expect(gate?.status).toBe('pass');
      expect(gate?.observedValue).toBe('1.00');
    });

    it('just below 1.00 is a warning, not a pass', () => {
      const p = pairWithRatio(0.99, 30, 10, 300); // ratio ~0.99
      const decision = evaluatePmccDecision({ pair: p, criteria, marketSession: 'open' });
      const gate = decision.gates.find(g => g.code === 'EXTRINSIC_RATIO');
      expect(gate?.status).toBe('warning');
      expect(gate?.explanation).toContain('below 1.00');
      expect(gate?.explanation).not.toContain('well below');
    });

    it('exactly 0.50 (the two-tier boundary) is the milder warning tier, not the stronger one', () => {
      // shortDailyRate = 0.5/30; longDailyRate = 1/30 -> ratio = 0.5 exactly
      const p = pairWithRatio(0.5, 30, 1, 30);
      const decision = evaluatePmccDecision({ pair: p, criteria, marketSession: 'open' });
      const gate = decision.gates.find(g => g.code === 'EXTRINSIC_RATIO');
      expect(gate?.status).toBe('warning');
      expect(gate?.explanation).toContain('below 1.00');
      expect(gate?.explanation).not.toContain('well below');
    });

    it('just below 0.50 escalates to the stronger warning tier', () => {
      const p = pairWithRatio(0.49, 30, 1, 30);
      const decision = evaluatePmccDecision({ pair: p, criteria, marketSession: 'open' });
      const gate = decision.gates.find(g => g.code === 'EXTRINSIC_RATIO');
      expect(gate?.status).toBe('warning');
      expect(gate?.explanation).toContain('well below');
    });

    it('a genuinely extreme ratio still renders a real, readable number, not something confusing', () => {
      // Very short DTE short leg against a very cheap, long-dated LEAP.
      const p = pairWithRatio(5, 1, 0.10, 365);
      const decision = evaluatePmccDecision({ pair: p, criteria, marketSession: 'open' });
      const gate = decision.gates.find(g => g.code === 'EXTRINSIC_RATIO');
      expect(gate?.status).toBe('pass');
      expect(typeof gate?.observedValue).toBe('string');
      expect(gate?.explanation).toContain('$5.000/day');
      expect(gate?.explanation).toMatch(/\$0\.000\d*\/day/);
    });

    it('behaves identically in held and new modes', () => {
      const newDecision = evaluatePmccDecision({ pair: pairWithRatio(0.3, 30, 1, 30, 'new-pmcc'), criteria, marketSession: 'open' });
      const heldDecision = evaluatePmccDecision({ pair: pairWithRatio(0.3, 30, 1, 30, 'covered-short-call-against-held-leaps'), criteria, marketSession: 'open' });
      expect(newDecision.gates.find(g => g.code === 'EXTRINSIC_RATIO')?.status)
        .toBe(heldDecision.gates.find(g => g.code === 'EXTRINSIC_RATIO')?.status);
    });

    it('a warning-tier ratio never disqualifies the decision on its own', () => {
      const p = pairWithRatio(0.1, 30, 1, 30); // well below 0.5
      const decision = evaluatePmccDecision({ pair: p, criteria, marketSession: 'open' });
      expect(decision.qualification).toBe('QUALIFIED');
    });
  });

  // PMCC-HEALTH-CHECK-0002: LEAP_APPROACHING_DANGER_ZONE
  describe('LEAP_APPROACHING_DANGER_ZONE', () => {
    function pairWithLeapDte(dte: number, entryMode: 'new-pmcc' | 'covered-short-call-against-held-leaps' = 'new-pmcc') {
      const p = pair(entryMode);
      // delta: 0.75 -- see the matching comment in pairWithRatio above.
      p.longLeg = { ...p.longLeg, dte, delta: 0.75 };
      return p;
    }

    it('exactly 90 DTE (the pass/warning boundary) is already the approaching-tier warning', () => {
      const decision = evaluatePmccDecision({ pair: pairWithLeapDte(90), criteria, marketSession: 'open' });
      const gate = decision.gates.find(g => g.code === 'LEAP_APPROACHING_DANGER_ZONE');
      expect(gate?.status).toBe('warning');
      expect(gate?.explanation).toContain('approaching');
    });

    it('91 DTE (just past the boundary) passes cleanly', () => {
      const decision = evaluatePmccDecision({ pair: pairWithLeapDte(91), criteria, marketSession: 'open' });
      expect(decision.gates.find(g => g.code === 'LEAP_APPROACHING_DANGER_ZONE')?.status).toBe('pass');
    });

    it('exactly 60 DTE (the two-tier boundary) is already the urgent tier', () => {
      const decision = evaluatePmccDecision({ pair: pairWithLeapDte(60), criteria, marketSession: 'open' });
      const gate = decision.gates.find(g => g.code === 'LEAP_APPROACHING_DANGER_ZONE');
      expect(gate?.status).toBe('warning');
      expect(gate?.explanation).toContain('accelerates meaningfully');
    });

    it('61 DTE is the milder approaching tier, not urgent', () => {
      const decision = evaluatePmccDecision({ pair: pairWithLeapDte(61), criteria, marketSession: 'open' });
      const gate = decision.gates.find(g => g.code === 'LEAP_APPROACHING_DANGER_ZONE');
      expect(gate?.status).toBe('warning');
      expect(gate?.explanation).toContain('approaching');
      expect(gate?.explanation).not.toContain('accelerates meaningfully');
    });

    it('behaves identically in held and new modes', () => {
      const newDecision = evaluatePmccDecision({ pair: pairWithLeapDte(45, 'new-pmcc'), criteria, marketSession: 'open' });
      const heldDecision = evaluatePmccDecision({ pair: pairWithLeapDte(45, 'covered-short-call-against-held-leaps'), criteria, marketSession: 'open' });
      expect(newDecision.gates.find(g => g.code === 'LEAP_APPROACHING_DANGER_ZONE')?.status)
        .toBe(heldDecision.gates.find(g => g.code === 'LEAP_APPROACHING_DANGER_ZONE')?.status);
    });

    it('a warning-tier LEAP DTE never disqualifies the decision on its own', () => {
      const decision = evaluatePmccDecision({ pair: pairWithLeapDte(45), criteria, marketSession: 'open' });
      expect(decision.qualification).toBe('QUALIFIED');
    });
  });
});
