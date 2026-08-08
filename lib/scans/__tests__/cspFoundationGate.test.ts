// lib/scans/__tests__/cspFoundationGate.test.ts
// CSP-WORKFLOW-RECONCILE-0002 — required gating regression tests at the
// findAllCsp() layer, proving the SQ-0001A foundation integration:
//   1. bearish/chaotic underlying evidence can block CSP before contract
//      ranking (marketQualification, computed at discovery time, not at
//      scoring/ranking time);
//   2. premium/ROC cannot override that gate (a candidate with excellent
//      economics is still disqualified, and cspScore -- which never reads
//      marketQualification -- keeps scoring it on its own merits);
//   3. account-capital failure does not rewrite market eligibility (the two
//      axes stay independent, same invariant CSP-WORKFLOW-0001 already
//      established for IVR/earnings/liquidity, now proven for the
//      foundation gate too);
//   4. insufficient SQ-0001A evidence remains categorical (its own
//      qualification state, never folded into INELIGIBLE);
//   5. candidate identity/rule snapshots remain intact regardless of
//      foundation-gate outcome.
import { describe, it, expect } from 'vitest';
import { findAllCsp } from '../csp-finder';
import { DEFAULT_CSP_RULES } from '../constants';
import { calculateCspScore } from '../cspScore';
import { classifySetup } from '@/lib/decision/setup-classifier';
import { evaluateCspThesis } from '@/lib/decision/strategy-thesis/csp';
import { evaluateStrategyEligibility } from '@/lib/decision/strategy-eligibility';
import { calculateMarketFeatures } from '@/lib/market-intelligence/features';
import type { MarketStateEvidence, PointInTimeBar } from '@/lib/market-intelligence/types';
import type { EligibilityDecision } from '@/lib/decision/types';

function futureExpiration(daysOut = 35): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

// A single, generous, liquid, well-priced candidate -- the kind of contract
// that would otherwise win on every economic dimension (tight market,
// ample OI, strong premium/ROC).
function richCandidateChain() {
  const exp = futureExpiration();
  return {
    expirations: [exp],
    chains: {
      [exp]: [
        { strikePrice: 100, expirationDate: exp, optionType: 'P' as const, delta: -0.20, bid: 2.95, ask: 3.05, mid: 3.00, openInterest: 5000, occSymbol: 'RICH_100P_OCC' },
      ],
    },
  };
}

const bars = (count: number): PointInTimeBar[] => Array.from({ length: count }, (_, i) => ({
  t: i, o: 100 + i, h: 103 + i, l: 98 + i, c: 101 + i,
}));

const evidence = (overrides: Partial<MarketStateEvidence> = {}): MarketStateEvidence => ({
  direction: 'BULLISH',
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

// Builds a real EligibilityDecision the same way production wiring would --
// through the actual thesis + eligibility functions, not a hand-built stub.
function foundationDecision(state: MarketStateEvidence): EligibilityDecision {
  const setup = classifySetup(state);
  const thesis = evaluateCspThesis('CORE', state, setup);
  return evaluateStrategyEligibility({
    thesis, horizon: thesis.horizon, eventRisk: { hasKnownBinaryEvent: false },
    modelVersion: 'sq0001-foundation', configVersion: 'research-v1',
  });
}

const BEARISH = foundationDecision(evidence({ direction: 'BEARISH' }));
const CHAOTIC = foundationDecision(evidence({ direction: 'UNCERTAIN', regime: 'CHAOTIC' }));
const INSUFFICIENT = foundationDecision(evidence({ direction: 'UNCERTAIN', regime: 'TRANSITION' }));
const SUPPORTIVE = foundationDecision(evidence({ direction: 'BULLISH' }));

describe('findAllCsp — SQ-0001A foundation gate (CSP-WORKFLOW-RECONCILE-0002)', () => {
  it('bearish underlying evidence blocks CSP before contract ranking', () => {
    expect(BEARISH.status).toBe('INELIGIBLE');
    const result = findAllCsp(richCandidateChain(), 100, {
      rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'TEST',
      foundationEligibility: BEARISH,
    });
    expect(result.results.length).toBe(1); // still discovered, never hidden
    expect(result.results[0].marketQualification).toBe('DISQUALIFIED_FOUNDATION_INELIGIBLE');
    expect(result.results[0].accountActionable).toBe(false);
  });

  it('a chaotic setup blocks CSP the same way', () => {
    expect(CHAOTIC.status).toBe('INELIGIBLE');
    const result = findAllCsp(richCandidateChain(), 100, {
      rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'TEST',
      foundationEligibility: CHAOTIC,
    });
    expect(result.results[0].marketQualification).toBe('DISQUALIFIED_FOUNDATION_INELIGIBLE');
  });

  it('a candidate with no foundation evidence supplied is unaffected -- existing callers keep current behavior', () => {
    const result = findAllCsp(richCandidateChain(), 100, {
      rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'TEST',
    });
    expect(result.results[0].marketQualification).toBe('QUALIFIED');
  });

  it('premium/ROC cannot override the foundation gate -- the candidate is excellent economically and still disqualified, while cspScore keeps scoring it independently', () => {
    const gated = findAllCsp(richCandidateChain(), 100, {
      rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'TEST',
      foundationEligibility: BEARISH,
    });
    const c = gated.results[0].candidate;
    // Excellent economics: strong ROC, strong POP, ample OI, tight market.
    expect(c.roc).toBeGreaterThan(2);
    expect(c.pop).toBeGreaterThan(75);
    // Yet the gate still disqualifies the candidate at the market layer.
    expect(gated.results[0].marketQualification).toBe('DISQUALIFIED_FOUNDATION_INELIGIBLE');
    expect(gated.results[0].accountActionable).toBe(false);

    // cspScore is entirely independent of marketQualification -- it never
    // reads it, so a gated candidate's contract-quality score is computed
    // exactly the same as an ungated one. The gate lives in
    // marketQualification, not in the score, and nothing about a high
    // score can push marketQualification back to QUALIFIED.
    const score = calculateCspScore({
      pop: c.pop, otmPct: 20, periodRocPct: c.roc, annualizedRocPct: c.annualizedRoc,
      liquidityClass: 'STRONG', openInterest: c.shortOI ?? null, oiMin: DEFAULT_CSP_RULES.OI_MIN,
      technicalFit: 80, ivr: 50, earningsWithinExpiration: false,
    });
    expect(score.scoreStatus).toBe('AVAILABLE');
    expect(score.total).not.toBeNull();
    // The gate outcome is unchanged by the fact that this scored well.
    expect(gated.results[0].marketQualification).toBe('DISQUALIFIED_FOUNDATION_INELIGIBLE');
  });

  it('account-capital failure does not rewrite market eligibility -- a foundation-supportive, market-qualified candidate that is unaffordable stays QUALIFIED at the market layer', () => {
    expect(SUPPORTIVE.status).toBe('ELIGIBLE');
    const result = findAllCsp(richCandidateChain(), 100, {
      rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'TEST',
      foundationEligibility: SUPPORTIVE,
      capital: { accountSelected: true, accountId: 'acct-1', optionBuyingPower: 100, cashBalance: 100 }, // far too little
    });
    expect(result.results[0].accountEligibility).toBe('INSUFFICIENT_CAPITAL');
    // Market qualification is untouched by the capital failure.
    expect(result.results[0].marketQualification).toBe('QUALIFIED');
  });

  it('a foundation-ineligible candidate that is also unaffordable reports both states independently -- neither axis masks the other', () => {
    const result = findAllCsp(richCandidateChain(), 100, {
      rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'TEST',
      foundationEligibility: BEARISH,
      capital: { accountSelected: true, accountId: 'acct-1', optionBuyingPower: 100, cashBalance: 100 },
    });
    expect(result.results[0].marketQualification).toBe('DISQUALIFIED_FOUNDATION_INELIGIBLE');
    expect(result.results[0].accountEligibility).toBe('INSUFFICIENT_CAPITAL');
  });

  it('insufficient SQ-0001A evidence remains categorical -- its own state, never conflated with DISQUALIFIED_FOUNDATION_INELIGIBLE', () => {
    expect(INSUFFICIENT.status).toBe('INSUFFICIENT_EVIDENCE');
    const result = findAllCsp(richCandidateChain(), 100, {
      rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'TEST',
      foundationEligibility: INSUFFICIENT,
    });
    expect(result.results[0].marketQualification).toBe('DISQUALIFIED_FOUNDATION_INSUFFICIENT_EVIDENCE');
    expect(result.results[0].marketQualification).not.toBe('DISQUALIFIED_FOUNDATION_INELIGIBLE');
  });

  it('a supportive foundation decision does not itself qualify a candidate that fails on liquidity/IVR/earnings -- the gate only ever adds a disqualification, never removes one', () => {
    const exp = futureExpiration();
    const poorLiquidityChain = {
      expirations: [exp],
      chains: {
        [exp]: [
          { strikePrice: 100, expirationDate: exp, optionType: 'P' as const, delta: -0.20, bid: 2.00, ask: 4.00, mid: 3.00, openInterest: 5000, occSymbol: 'WIDE_OCC' },
        ],
      },
    };
    const result = findAllCsp(poorLiquidityChain, 100, {
      rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'TEST',
      foundationEligibility: SUPPORTIVE,
    });
    expect(result.results[0].marketQualification).toBe('DISQUALIFIED_POOR_LIQUIDITY');
  });

  it('candidate identity and rule-snapshot-relevant fields remain intact regardless of foundation-gate outcome', () => {
    const rules = DEFAULT_CSP_RULES;
    const gated = findAllCsp(richCandidateChain(), 100, {
      rules, contracts: 1, underlyingSymbol: 'TEST', foundationEligibility: BEARISH,
    });
    const ungated = findAllCsp(richCandidateChain(), 100, {
      rules, contracts: 1, underlyingSymbol: 'TEST',
    });
    // Identity is computed purely from the discovered contract, not from
    // the foundation-gate outcome.
    expect(gated.results[0].candidateId).toBe(ungated.results[0].candidateId);
    expect(gated.results[0].candidate.shortOccSymbol).toBe(ungated.results[0].candidate.shortOccSymbol);
    expect(gated.results[0].candidate.shortStrike).toBe(ungated.results[0].candidate.shortStrike);
    expect(gated.results[0].candidate.expiration).toBe(ungated.results[0].candidate.expiration);
    // The candidate's own economics are identical too -- only marketQualification differs.
    expect(gated.results[0].candidate.credit).toBe(ungated.results[0].candidate.credit);
    expect(gated.results[0].marketQualification).not.toBe(ungated.results[0].marketQualification);
  });
});
