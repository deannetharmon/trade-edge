// lib/scans/__tests__/cspQualificationState.test.ts

// QUAL-STATES-0001 phase 3 (Alan's fixtures): the CSP three-state derivation reads the candidate's own
// qualification states; account capital is a separate axis and never changes the state.

import { describe, expect, it } from 'vitest';
import { deriveCspQualification } from '../qualificationState';
import { describeGate } from '@/features/screener/components/QualificationBadge';
import type { ScreenResult, SpreadCandidate } from '../types';

function csp(over: Partial<SpreadCandidate> = {}, strategy = 'CSP'): ScreenResult {
  return {
    symbol: 'AMD', strategy, price: 100, ivr: 40, qualified: true, failReasons: [], checks: {} as never,
    bestCandidate: {
      strategy, cspMarketQualification: 'QUALIFIED', cspModeQualification: 'NOT_APPLICABLE', cspDeltaTargetPassing: true,
      cspAccountEligibility: 'ELIGIBLE', ...over,
    } as SpreadCandidate,
  } as ScreenResult;
}

describe('deriveCspQualification', () => {
  it('a market-qualified candidate with a passing delta and no targeted failure is Qualified', () => {
    expect(deriveCspQualification(csp())?.derivation.state).toBe('qualified');
  });

  it('QUALIFIED_WITH_LIQUIDITY_WARNING is Caution and carries the liquidity reason', () => {
    const r = deriveCspQualification(csp({ cspMarketQualification: 'QUALIFIED_WITH_LIQUIDITY_WARNING', cspLiquidityReason: 'Bid/ask width 12% of mid is borderline' } as never))!;
    expect(r.derivation).toMatchObject({ state: 'caution', warning: ['csp-market'] });
    expect(describeGate('csp-market', r.checks['csp-market'])).toBe('Bid/ask width 12% of mid is borderline');
  });

  it('market-qualified but outside the preferred delta range is Caution, not Disqualified', () => {
    const r = deriveCspQualification(csp({ cspDeltaTargetPassing: false }))!;
    expect(r.derivation).toMatchObject({ state: 'caution', warning: ['csp-delta'] });
    expect(describeGate('csp-delta', r.checks['csp-delta'])).toBe('delta outside the preferred range');
  });

  it('every DISQUALIFIED_* market state is Disqualified, with its own wording', () => {
    const expected: Record<string, string> = {
      DISQUALIFIED_IVR: 'IVR above the CSP risk cap',
      DISQUALIFIED_IVR_UNAVAILABLE: 'IV rank unavailable, so the IVR cap cannot be verified',
      DISQUALIFIED_EARNINGS: 'earnings on or within 10 days after expiry',
      DISQUALIFIED_POOR_LIQUIDITY: 'poor liquidity',
      DISQUALIFIED_INVALID_QUOTE: 'no valid quote',
      DISQUALIFIED_FOUNDATION_INELIGIBLE: 'market-state evidence contradicts a cash-secured put thesis',
      DISQUALIFIED_FOUNDATION_INSUFFICIENT_EVIDENCE: 'not enough market-state evidence for a cash-secured put thesis',
    };
    for (const [state, text] of Object.entries(expected)) {
      const r = deriveCspQualification(csp({ cspMarketQualification: state as never }))!;
      expect(r.derivation.state, state).toBe('disqualified');
      expect(describeGate('csp-market', r.checks['csp-market']), state).toBe(text);
    }
  });

  it('a failed targeted minimum is Disqualified and names the minimums that failed', () => {
    const r = deriveCspQualification(csp({ cspModeQualification: 'FAILED', cspModeQualificationReasons: ['POP 60.0% is below targeted minimum 70%'] }))!;
    expect(r.derivation).toMatchObject({ state: 'disqualified', failing: ['csp-mode'] });
    expect(r.checks['csp-mode'].reason).toContain('POP 60.0% is below targeted minimum 70%');
  });

  it('a delta outside the range does not soften a market disqualification; the failure wins', () => {
    const r = deriveCspQualification(csp({ cspMarketQualification: 'DISQUALIFIED_IVR', cspDeltaTargetPassing: false }))!;
    expect(r.derivation.state).toBe('disqualified');
    expect(r.derivation.warning).toEqual([]);
  });

  it('account capital is a separate axis: insufficient capital does not change the state', () => {
    expect(deriveCspQualification(csp({ cspAccountEligibility: 'INSUFFICIENT_CAPITAL' }))?.derivation.state).toBe('qualified');
    expect(deriveCspQualification(csp({ cspAccountEligibility: 'CAPITAL_UNVERIFIED' }))?.derivation.state).toBe('qualified');
  });

  it('returns null for non-CSP results and for a CSP with no market qualification', () => {
    expect(deriveCspQualification(csp({}, 'BPS'))).toBeNull();
    expect(deriveCspQualification(csp({ cspMarketQualification: undefined }))).toBeNull();
  });
});
