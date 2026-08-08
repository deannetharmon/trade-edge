// lib/scans/__tests__/ccFoundationGate.test.ts
// TE-0007C-RECONCILE-0001 — required gating regression tests at the
// findAllCoveredCalls() layer, mirroring cspFoundationGate.test.ts's proof
// shape for CC:
//   1. CC has a genuinely independent thesis evaluator (proven at the
//      lib/decision layer in sq0001-foundation.test.ts; re-proven here at
//      the finder layer via distinct marketQualification outcomes);
//   2. failed foundation/thesis eligibility blocks CC before ranking;
//   3. premium cannot override the thesis gate;
//   4. insufficient evidence remains categorical;
//   5. capacity (share ownership) and market eligibility are independent
//      axes — buying power/capacity never rewrites the foundation gate,
//      and the foundation gate never fabricates share ownership;
//   6. candidate identity remains stable regardless of gate outcome;
//   7. multiple qualified calls are retained where the chain supports it.
import { describe, it, expect } from 'vitest';
import { findAllCoveredCalls, findBestCoveredCall } from '../covered-call-finder';
import { computeCoveredCallCapacity } from '../covered-call-capacity';
import type { CcRulesType } from '../constants';
import { classifySetup } from '@/lib/decision/setup-classifier';
import { evaluateCcThesis } from '@/lib/decision/strategy-thesis/cc';
import { evaluateStrategyEligibility } from '@/lib/decision/strategy-eligibility';
import { calculateMarketFeatures } from '@/lib/market-intelligence/features';
import type { MarketStateEvidence, PointInTimeBar } from '@/lib/market-intelligence/types';
import type { EligibilityDecision } from '@/lib/decision/types';
import type { WheelChainLeg } from '@/lib/wheel/chainSearch';

const RULES: CcRulesType = {
  DELTA_MIN: 0.20, DELTA_MAX: 0.35,
  DTE_MIN: 21, DTE_MAX: 45,
  OI_MIN: 100, BID_ASK_MAX: 0.20,
};

type TestChain = { expirations: string[]; chains: Record<string, WheelChainLeg[]> };

function chainWithDte(dte: number): TestChain {
  const d = new Date();
  d.setDate(d.getDate() + dte);
  const expDate = d.toISOString().slice(0, 10);
  return {
    expirations: [expDate],
    chains: {
      [expDate]: [
        { strikePrice: 110, expirationDate: expDate, optionType: 'C', delta: 0.28, openInterest: 5000, bid: 2.95, ask: 3.05, mid: 3.00, occSymbol: 'RICH_110C_OCC' },
      ],
    },
  };
}

// Two eligible calls on the same underlying/expiration, both inside the
// delta/DTE window, so multi-candidate retention has something real to
// prove.
function twoCandidateChain(dte: number): TestChain {
  const d = new Date();
  d.setDate(d.getDate() + dte);
  const expDate = d.toISOString().slice(0, 10);
  return {
    expirations: [expDate],
    chains: {
      [expDate]: [
        { strikePrice: 110, expirationDate: expDate, optionType: 'C', delta: 0.22, openInterest: 500, bid: 2.00, ask: 2.10, mid: 2.05, occSymbol: 'CC_110C_OCC' },
        { strikePrice: 115, expirationDate: expDate, optionType: 'C', delta: 0.30, openInterest: 400, bid: 1.20, ask: 1.30, mid: 1.25, occSymbol: 'CC_115C_OCC' },
      ],
    },
  };
}

const bars = (count: number): PointInTimeBar[] => Array.from({ length: count }, (_, i) => ({
  t: i, o: 100 + i, h: 103 + i, l: 98 + i, c: 101 + i,
}));

const evidence = (overrides: Partial<MarketStateEvidence> = {}): MarketStateEvidence => ({
  direction: 'BEARISH',
  strength: 0.5,
  persistence: 0.8,
  regime: 'TREND',
  maturity: 'ESTABLISHED',
  uncertainty: 0.2,
  features: calculateMarketFeatures(bars(60)),
  supportingEvidence: [],
  contradictingEvidence: [],
  ...overrides,
});

function foundationDecision(state: MarketStateEvidence): EligibilityDecision {
  const setup = classifySetup(state);
  const thesis = evaluateCcThesis('CORE', state, setup);
  return evaluateStrategyEligibility({
    thesis, horizon: thesis.horizon, eventRisk: { hasKnownBinaryEvent: false },
    modelVersion: 'sq0001-foundation', configVersion: 'research-v1',
  });
}

const BULLISH_HIGH_CALLAWAY = foundationDecision(evidence({ direction: 'BULLISH' }));
const INSUFFICIENT = foundationDecision(evidence({ direction: 'UNCERTAIN', regime: 'TRANSITION' }));
const SUPPORTIVE = foundationDecision(evidence({ direction: 'BEARISH' }));

// 500 shares -> 5 gross covered contracts, no existing exposure.
const fullCapacity = computeCoveredCallCapacity(500, 0, 0, 90);

describe('findAllCoveredCalls — SQ-0001A foundation gate (TE-0007C-RECONCILE-0001)', () => {
  it('bullish (high call-away risk) underlying evidence blocks CC before contract ranking', () => {
    expect(BULLISH_HIGH_CALLAWAY.status).toBe('INELIGIBLE');
    const result = findAllCoveredCalls(chainWithDte(30), {
      rules: RULES, capacity: fullCapacity, stockPrice: 100, underlyingSymbol: 'TEST',
      foundationEligibility: BULLISH_HIGH_CALLAWAY,
    });
    expect(result.results.length).toBe(1); // still discovered, never hidden
    expect(result.results[0].marketQualification).toBe('DISQUALIFIED_FOUNDATION_INELIGIBLE');
  });

  it('a candidate with no foundation evidence supplied is unaffected -- existing findBestCoveredCall callers keep current behavior', () => {
    const all = findAllCoveredCalls(chainWithDte(30), {
      rules: RULES, capacity: fullCapacity, stockPrice: 100, underlyingSymbol: 'TEST',
    });
    expect(all.results[0].marketQualification).toBe('QUALIFIED');
    const best = findBestCoveredCall(chainWithDte(30), { rules: RULES, capacity: fullCapacity, stockPrice: 100 });
    expect(best).not.toBeNull();
  });

  it('premium cannot override the foundation gate -- excellent economics, still disqualified', () => {
    const gated = findAllCoveredCalls(chainWithDte(30), {
      rules: RULES, capacity: fullCapacity, stockPrice: 100, underlyingSymbol: 'TEST',
      foundationEligibility: BULLISH_HIGH_CALLAWAY,
    });
    const c = gated.results[0].candidate;
    expect(c.ccPremiumPerContract).toBeGreaterThan(0);
    expect(c.ccPeriodYieldOnShares).toBeGreaterThan(0);
    // Excellent premium/yield does not change the gate outcome.
    expect(gated.results[0].marketQualification).toBe('DISQUALIFIED_FOUNDATION_INELIGIBLE');
  });

  it('insufficient SQ-0001A evidence remains categorical -- distinct from DISQUALIFIED_FOUNDATION_INELIGIBLE', () => {
    expect(INSUFFICIENT.status).toBe('INSUFFICIENT_EVIDENCE');
    const result = findAllCoveredCalls(chainWithDte(30), {
      rules: RULES, capacity: fullCapacity, stockPrice: 100, underlyingSymbol: 'TEST',
      foundationEligibility: INSUFFICIENT,
    });
    expect(result.results[0].marketQualification).toBe('DISQUALIFIED_FOUNDATION_INSUFFICIENT_EVIDENCE');
    expect(result.results[0].marketQualification).not.toBe('DISQUALIFIED_FOUNDATION_INELIGIBLE');
  });

  it('a supportive foundation decision does not itself qualify a candidate that fails the existing hard contract gates', () => {
    // Strike (110) sits below stock price 200 -- fails the existing
    // never-select-below-stock-price gate regardless of foundation state.
    const result = findAllCoveredCalls(chainWithDte(30), {
      rules: RULES, capacity: fullCapacity, stockPrice: 200, underlyingSymbol: 'TEST',
      foundationEligibility: SUPPORTIVE,
    });
    expect(result.results.length).toBe(0);
  });

  it('candidate identity remains stable regardless of foundation-gate outcome', () => {
    const gated = findAllCoveredCalls(chainWithDte(30), {
      rules: RULES, capacity: fullCapacity, stockPrice: 100, underlyingSymbol: 'TEST',
      foundationEligibility: BULLISH_HIGH_CALLAWAY,
    });
    const ungated = findAllCoveredCalls(chainWithDte(30), {
      rules: RULES, capacity: fullCapacity, stockPrice: 100, underlyingSymbol: 'TEST',
    });
    expect(gated.results[0].candidateId).toBe(ungated.results[0].candidateId);
    // 'RICH_110C_OCC' is a synthetic test label, not a real OCC symbol, so
    // this correctly falls to the composite fallback identity -- same
    // convention documented in csp-finder-multicandidate.test.ts's NKE
    // fixture. The point being proven is stability across gate outcomes,
    // not which identity form is used.
    expect(gated.results[0].candidateId).toBe('composite:CC:TEST:' + gated.results[0].candidate.expiration + ':C:110');
    expect(gated.results[0].candidate.credit).toBe(ungated.results[0].candidate.credit);
    expect(gated.results[0].marketQualification).not.toBe(ungated.results[0].marketQualification);
  });

  it('multiple qualified calls on the same underlying are retained, not collapsed to one -- candidate universe, not single-best', () => {
    const result = findAllCoveredCalls(twoCandidateChain(30), {
      rules: RULES, capacity: fullCapacity, stockPrice: 100, underlyingSymbol: 'TEST',
    });
    expect(result.results.length).toBe(2);
    const strikes = result.results.map(r => r.candidate.shortStrike).sort((a, b) => a - b);
    expect(strikes).toEqual([110, 115]);
    const ids = result.results.map(r => r.candidateId);
    expect(new Set(ids).size).toBe(2); // distinct, stable identities
  });

  it('share capacity and market eligibility are independent axes -- the foundation gate never reads capacity, and capacity math never reads foundation state', () => {
    // ccMarketQualificationFor is computed purely from foundationEligibility;
    // proven here by holding the underlying/contract fixed and varying only
    // capacity share count, confirming marketQualification is unaffected.
    const highCapacity = computeCoveredCallCapacity(1000, 0, 0, 90);
    const lowCapacity = computeCoveredCallCapacity(200, 0, 0, 90); // still > 0, still scans
    const withHighCapacity = findAllCoveredCalls(chainWithDte(30), {
      rules: RULES, capacity: highCapacity, stockPrice: 100, underlyingSymbol: 'TEST',
      foundationEligibility: SUPPORTIVE,
    });
    const withLowCapacity = findAllCoveredCalls(chainWithDte(30), {
      rules: RULES, capacity: lowCapacity, stockPrice: 100, underlyingSymbol: 'TEST',
      foundationEligibility: SUPPORTIVE,
    });
    expect(withHighCapacity.results[0].marketQualification).toBe('QUALIFIED');
    expect(withLowCapacity.results[0].marketQualification).toBe('QUALIFIED');
    // Only the contract quantity/premium totals differ with capacity --
    // never the market-qualification axis.
    expect(withHighCapacity.results[0].candidate.ccAvailableCoveredContracts).toBe(10);
    expect(withLowCapacity.results[0].candidate.ccAvailableCoveredContracts).toBe(2);
  });

  it('buying power / capital never creates CC capacity -- capacity derives from sharesOwned alone, and zero shares means zero contracts regardless of any other input', () => {
    // computeCoveredCallCapacity has no buying-power/capital parameter at
    // all -- this test proves 0 shares always floors to 0 available
    // contracts, with no fallback path that could substitute cash for
    // share ownership.
    const noShares = computeCoveredCallCapacity(0, 0, 0, null);
    expect(noShares.grossCoveredContracts).toBe(0);
    expect(noShares.availableCoveredContracts).toBe(0);

    const result = findAllCoveredCalls(chainWithDte(30), {
      rules: RULES, capacity: noShares, stockPrice: 100, underlyingSymbol: 'TEST',
      foundationEligibility: SUPPORTIVE,
    });
    expect(result.results.length).toBe(0); // no shares -> no candidate, full stop
  });
});
