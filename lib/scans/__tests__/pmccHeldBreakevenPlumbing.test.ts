// lib/scans/__tests__/pmccHeldBreakevenPlumbing.test.ts

import { describe, expect, it } from 'vitest';
import { completeSession, createScanSession, PMCC_FAILURE_CODES, recordSymbolEvaluated, validateSessionData } from '../../screener/scanSession';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '../pmccConfig';
import { PMCC_DECISION_POLICY_VERSION } from '../pmccDecision';
import type { HeldPmccLongCandidate } from '../pmccHeldLeaps';
import { heldLongKey } from '../pmccHeldBreakeven';
import { summarizePmccLegRejections } from '../pmccAuditSummary';
import { runPmccProduction } from '../pmccProduction';
import { pairPmccCandidates } from '../pmccPairing';
import type { PmccChainLeg, PmccFailureCode, PmccPairingCriteria } from '../pmccTypes';

// PMCC-HELD-BREAKEVEN-0001 plumbing: allowlist exhaustiveness, session round trip, messages, key helper.
// (Commit 1 also carried a "basis accepted but not enforced" test; commit 2 removes it, as the floor now enforces.)
// The floor itself is tested in pmccHeldBreakeven.test.ts.

// Compile-time exhaustive: adding a PmccFailureCode member without adding it here is a tsc error.
const ALL_FAILURE_CODES: Record<PmccFailureCode, true> = {
  INVALID_OPTION_TYPE: true, UNDERLYING_MISMATCH: true, INVALID_OCC_IDENTITY: true, DUPLICATE_CONTRACT: true,
  DELTA_OUT_OF_RANGE: true, DTE_OUT_OF_RANGE: true, OPEN_INTEREST_BELOW_MINIMUM: true, INVALID_QUOTE: true,
  BID_ASK_TOO_WIDE: true, LONG_NOT_ITM: true, SHORT_NOT_OTM: true, LONG_EXPIRATION_NOT_LATER: true,
  LONG_STRIKE_NOT_BELOW_SHORT: true, NET_DEBIT_NOT_POSITIVE: true, NET_DEBIT_NOT_BELOW_WIDTH: true,
  INVALID_EXTRINSIC: true, INSUFFICIENT_DATA: true, COST_BASIS_UNAVAILABLE: true, SHORT_NOT_ABOVE_HELD_BREAKEVEN: true,
};

const asOf = new Date('2026-08-14T15:00:00.000Z');
const criteria: PmccPairingCriteria = {
  dte: { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 }, shortDelta: { min: 0.20, max: 0.30 },
  longOiMin: 100, shortOiMin: 100,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY, limits: DEFAULT_PMCC_PAIRING_LIMITS,
};
const snapshot = { asOf: asOf.toISOString(), marketSession: 'open' as const, criteria, decisionPolicyVersion: PMCC_DECISION_POLICY_VERSION };
const occ = (expiration: string, strike: number) => `GS${expiration.slice(2).replace(/-/g, '')}C${String(strike * 1000).padStart(8, '0')}`;
const leg = (role: 'long' | 'short', strike: number, overrides: Partial<PmccChainLeg> = {}): PmccChainLeg => {
  const expiration = role === 'long' ? '2027-06-18' : '2026-09-18';
  return {
    underlyingSymbol: 'GS', optionType: 'C', expiration, strike,
    delta: role === 'long' ? 0.8 : 0.25, openInterest: 500,
    bid: role === 'long' ? 320 : 8, ask: role === 'long' ? 322 : 8.2,
    occSymbol: occ(expiration, strike), quoteTimestamp: '2026-08-14T14:59:30.000Z', delayed: false, ...overrides,
  };
};
const context = { symbol: 'GS', price: 1037.55, ivr: 35, underlyingType: 'stock' as const };
const held: HeldPmccLongCandidate = {
  accountNumber: '5WT00001', positionKey: 'held-gs', underlyingSymbol: 'GS',
  occSymbol: occ('2027-06-18', 720), expiration: '2027-06-18', dte: 308, strike: 720, quantity: 1, avgOpenPrice: 345,
};

describe('PMCC-HELD-BREAKEVEN-0001 plumbing', () => {
  it('lists every PmccFailureCode member in the session-validation allowlist (and nothing else)', () => {
    const expected = Object.keys(ALL_FAILURE_CODES).sort();
    expect(Array.from(PMCC_FAILURE_CODES).sort()).toEqual(expected);
    expect(PMCC_FAILURE_CODES.has('COST_BASIS_UNAVAILABLE')).toBe(true);
    expect(PMCC_FAILURE_CODES.has('SHORT_NOT_ABOVE_HELD_BREAKEVEN')).toBe(true);
  });

  it('round-trips a held result carrying either new code through validateSessionData', () => {
    const base = runPmccProduction(
      { shortExpirations: [], longExpirations: [], chains: {} }, context, snapshot,
      { adapt: () => ({ longLegs: [leg('long', 720)], shortLegs: [leg('short', 1070)] }), pair: pairPmccCandidates },
      [held],
    );
    for (const code of ['COST_BASIS_UNAVAILABLE', 'SHORT_NOT_ABOVE_HELD_BREAKEVEN'] as const) {
      // Shape a floor-failed held result the way a floor would leave it: unqualified pair, failed decision.
      const result = JSON.parse(JSON.stringify(base[0]));
      const reason = { code, message: `test ${code}` };
      result.qualified = false;
      result.pmccPair.qualified = false;
      result.pmccPair.failureReasons = [reason];
      result.pmccPair.primaryFailureReason = reason;
      // A floor-failed pair is retained as a near miss, so the counts move with it.
      Object.assign(result.pmccPairingCounts, {
        qualifiedPairsBeforeRetention: 0, qualifiedPairsRetained: 0, nearMissPairsBeforeRetention: 1, nearMissPairsRetained: 1,
      });
      result.pmccDecision.qualification = 'DISQUALIFIED';
      result.pmccDecision.action = 'BLOCKED';
      result.pmccDecision.gates.push({ code: `STRUCTURE_${code}`, status: 'fail', explanation: reason.message, observedValue: code, threshold: 'PMCC structural rules', policySource: 'pmccPairing' });
      let session = createScanSession({ mode: 'filter', requestedStrategy: 'pmcc', scope: { universeSymbols: ['GS'], eligibleSymbols: ['GS'] }, pmccSnapshot: snapshot });
      session = completeSession(recordSymbolEvaluated(session, 'GS', [result]));
      expect(validateSessionData(JSON.parse(JSON.stringify(session)))).toMatchObject({ valid: true });
      // Sensitivity: an unknown code still fails, so the pass above is not vacuous.
      const bogus = JSON.parse(JSON.stringify(session));
      bogus.results[0].pmccPair.failureReasons[0].code = 'NOT_A_REAL_CODE';
      bogus.results[0].pmccPair.primaryFailureReason.code = 'NOT_A_REAL_CODE';
      expect(validateSessionData(bogus)).toMatchObject({ valid: false, errors: expect.arrayContaining(['INVALID_PMCC_RESULT']) });
    }
  });

  it('has audit-summary messages for both new codes', () => {
    const summary = summarizePmccLegRejections([
      { role: 'long', occSymbol: 'x', strike: 1, expiration: '2027-06-18', reasons: [{ code: 'COST_BASIS_UNAVAILABLE', message: 'detail a' }, { code: 'SHORT_NOT_ABOVE_HELD_BREAKEVEN', message: 'detail b' }] },
    ]);
    expect(summary.map(item => item.code).sort()).toEqual(['COST_BASIS_UNAVAILABLE', 'SHORT_NOT_ABOVE_HELD_BREAKEVEN']);
    expect(summary.every(item => item.message.length > 0 && !item.message.startsWith('detail'))).toBe(true);
  });

  it('heldLongKey matches the identity pairing derives (space-padded OCC and case normalize)', () => {
    expect(heldLongKey('GS    270618C00720000')).toBe('occ:GS270618C00720000');
    expect(heldLongKey('gs270618c00720000')).toBe('occ:GS270618C00720000');
  });
});
