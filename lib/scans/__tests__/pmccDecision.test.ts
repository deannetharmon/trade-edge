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
  requireDebitBelowWidth: true,
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

  it('uses Wait/Monitor for stale evidence and excludes it from ranking', () => {
    const decision = evaluatePmccDecision({ pair: pair('covered-short-call-against-held-leaps', quote('stale', false)), criteria, marketSession: 'open' });
    expect(decision).toMatchObject({ qualification: 'QUALIFIED', readiness: 'WAIT_MONITOR', action: 'BLOCKED' });
    expect(pmccDecisionRankEligible(decision)).toBe(false);
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
});
