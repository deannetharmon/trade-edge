// lib/scans/__tests__/cspQualification.test.ts
// CSP-WORKFLOW-0001 core-correction pass (BLOCKER-01) — focused pure tests
// proving market qualification and account eligibility are genuinely
// independent axes, and that Best-Opportunities eligibility requires BOTH
// strict market qualification (not the borderline-liquidity warning tier)
// AND verified account eligibility. No I/O, no React.

import { describe, it, expect } from 'vitest';
import {
  classifyCspLiquidity,
  classifyAccountEligibility,
  isAccountActionable,
  isMarketQualified,
  isBestOpportunitiesEligible,
  isModeQualified,
  isOverallCspQualified,
  type CspMarketQualification,
  type CspModeQualification,
} from '../cspQualification';

describe('isMarketQualified — market qualification alone, independent of account state', () => {
  it('QUALIFIED and QUALIFIED_WITH_LIQUIDITY_WARNING are both market-qualified', () => {
    expect(isMarketQualified('QUALIFIED')).toBe(true);
    expect(isMarketQualified('QUALIFIED_WITH_LIQUIDITY_WARNING')).toBe(true);
  });

  it('every DISQUALIFIED_* state is not market-qualified', () => {
    const disqualified: CspMarketQualification[] = [
      'DISQUALIFIED_INVALID_QUOTE', 'DISQUALIFIED_POOR_LIQUIDITY', 'DISQUALIFIED_IVR', 'DISQUALIFIED_EARNINGS',
      // CSP-WORKFLOW-RECONCILE-0002 — the two SQ-0001A foundation-gate states.
      'DISQUALIFIED_FOUNDATION_INELIGIBLE', 'DISQUALIFIED_FOUNDATION_INSUFFICIENT_EVIDENCE',
    ];
    for (const state of disqualified) expect(isMarketQualified(state)).toBe(false);
  });
});

describe('classifyAccountEligibility — required BLOCKER-01 state combinations', () => {
  it('market-qualified + eligible: sufficient verified capital produces ELIGIBLE', () => {
    const eligibility = classifyAccountEligibility({ requiredCash: 5000, availableCspCapital: 10000, accountSelected: true });
    expect(eligibility).toBe('ELIGIBLE');
  });

  it('market-qualified + insufficient capital: verified but too small produces INSUFFICIENT_CAPITAL, never ELIGIBLE', () => {
    const eligibility = classifyAccountEligibility({ requiredCash: 5000, availableCspCapital: 1000, accountSelected: true });
    expect(eligibility).toBe('INSUFFICIENT_CAPITAL');
    expect(eligibility).not.toBe('ELIGIBLE');
  });

  it('market-qualified + capital unverified: missing capital data produces CAPITAL_UNVERIFIED, never treated as unlimited/ELIGIBLE', () => {
    const eligibility = classifyAccountEligibility({ requiredCash: 5000, availableCspCapital: null, accountSelected: true });
    expect(eligibility).toBe('CAPITAL_UNVERIFIED');
    expect(eligibility).not.toBe('ELIGIBLE');
  });
});

describe('classifyCspLiquidity — borderline vs poor, both independently combinable with any account state', () => {
  it('borderline liquidity + eligible: width between strong and poor limits classifies BORDERLINE regardless of capital', () => {
    // midpoint 10, width 1.20 -> strongLimit=1.00, poorLimit=1.50 -> BORDERLINE
    const liquidity = classifyCspLiquidity(1.20, 10);
    expect(liquidity.liquidityClass).toBe('BORDERLINE');
    const eligibility = classifyAccountEligibility({ requiredCash: 1000, availableCspCapital: 5000, accountSelected: true });
    expect(eligibility).toBe('ELIGIBLE');
    // The two axes are computed by entirely separate functions taking no
    // shared input -- this test documents that combinability directly.
  });

  it('poor liquidity + eligible: width beyond the poor limit classifies POOR regardless of capital', () => {
    // midpoint 10, width 2.00 -> poorLimit=1.50 -> POOR
    const liquidity = classifyCspLiquidity(2.00, 10);
    expect(liquidity.liquidityClass).toBe('POOR');
    const eligibility = classifyAccountEligibility({ requiredCash: 1000, availableCspCapital: 5000, accountSelected: true });
    expect(eligibility).toBe('ELIGIBLE');
  });
});

describe('isBestOpportunitiesEligible — strict market qualification AND verified account eligibility, for every required state', () => {
  it('QUALIFIED + ELIGIBLE is Best-Opportunities-eligible', () => {
    expect(isBestOpportunitiesEligible('QUALIFIED', 'ELIGIBLE')).toBe(true);
  });

  it('QUALIFIED + INSUFFICIENT_CAPITAL is NOT Best-Opportunities-eligible (but is still market-qualified)', () => {
    expect(isMarketQualified('QUALIFIED')).toBe(true);
    expect(isBestOpportunitiesEligible('QUALIFIED', 'INSUFFICIENT_CAPITAL')).toBe(false);
  });

  it('QUALIFIED + CAPITAL_UNVERIFIED is NOT Best-Opportunities-eligible (but is still market-qualified)', () => {
    expect(isMarketQualified('QUALIFIED')).toBe(true);
    expect(isBestOpportunitiesEligible('QUALIFIED', 'CAPITAL_UNVERIFIED')).toBe(false);
  });

  it('QUALIFIED + ACCOUNT_UNSELECTED is NOT Best-Opportunities-eligible (but is still market-qualified)', () => {
    expect(isMarketQualified('QUALIFIED')).toBe(true);
    expect(isBestOpportunitiesEligible('QUALIFIED', 'ACCOUNT_UNSELECTED')).toBe(false);
  });

  it('QUALIFIED_WITH_LIQUIDITY_WARNING (borderline liquidity) + ELIGIBLE is still NOT Best-Opportunities-eligible -- the warning tier is strictly excluded even with perfect capital', () => {
    expect(isMarketQualified('QUALIFIED_WITH_LIQUIDITY_WARNING')).toBe(true);
    expect(isBestOpportunitiesEligible('QUALIFIED_WITH_LIQUIDITY_WARNING', 'ELIGIBLE')).toBe(false);
  });

  it('DISQUALIFIED_POOR_LIQUIDITY (poor liquidity) + ELIGIBLE is NOT Best-Opportunities-eligible -- market disqualification always wins regardless of capital', () => {
    expect(isMarketQualified('DISQUALIFIED_POOR_LIQUIDITY')).toBe(false);
    expect(isBestOpportunitiesEligible('DISQUALIFIED_POOR_LIQUIDITY', 'ELIGIBLE')).toBe(false);
  });

  it('isAccountActionable mirrors strict ELIGIBLE only, independent of market state', () => {
    expect(isAccountActionable('ELIGIBLE')).toBe(true);
    expect(isAccountActionable('INSUFFICIENT_CAPITAL')).toBe(false);
    expect(isAccountActionable('CAPITAL_UNVERIFIED')).toBe(false);
    expect(isAccountActionable('ACCOUNT_UNSELECTED')).toBe(false);
    expect(isAccountActionable('STRATEGY_NOT_PERMITTED')).toBe(false);
  });
});

// CSP-WORKFLOW-0001 core-correction pass — canonical CSP mode qualification,
// a third axis independent of market qualification and account eligibility.
// Filter mode never imposes a mode-narrowing threshold (NOT_APPLICABLE
// always passes); only a confirmed Targeted scan can produce PASSED/FAILED.
describe('isModeQualified — mode qualification alone, independent of market/account state', () => {
  it('NOT_APPLICABLE (Filter/Rank -- no mode-narrowing threshold confirmed) is mode-qualified', () => {
    expect(isModeQualified('NOT_APPLICABLE')).toBe(true);
  });

  it('PASSED (a confirmed Targeted candidate that met its POP/OTM/ROC threshold) is mode-qualified', () => {
    expect(isModeQualified('PASSED')).toBe(true);
  });

  it('FAILED (a confirmed Targeted candidate that missed its threshold) is NOT mode-qualified', () => {
    expect(isModeQualified('FAILED')).toBe(false);
  });
});

describe('isOverallCspQualified — market-qualified AND mode-qualified, the two axes combined', () => {
  it('market-qualified + Targeted PASSED + (account eligibility evaluated separately) is overall qualified', () => {
    expect(isOverallCspQualified('QUALIFIED', 'PASSED')).toBe(true);
  });

  it('market-qualified + Targeted FAILED is NOT overall qualified, even though market structure is fine', () => {
    expect(isMarketQualified('QUALIFIED')).toBe(true);
    expect(isOverallCspQualified('QUALIFIED', 'FAILED')).toBe(false);
  });

  it('market-qualified + NOT_APPLICABLE (Filter/Rank, no mode gate) is overall qualified -- unchanged behavior for non-Targeted modes', () => {
    expect(isOverallCspQualified('QUALIFIED', 'NOT_APPLICABLE')).toBe(true);
    expect(isOverallCspQualified('QUALIFIED_WITH_LIQUIDITY_WARNING', 'NOT_APPLICABLE')).toBe(true);
  });

  it('market-disqualified is NEVER overall qualified regardless of mode result -- market disqualification always wins', () => {
    const disqualified: CspMarketQualification[] = [
      'DISQUALIFIED_INVALID_QUOTE', 'DISQUALIFIED_POOR_LIQUIDITY', 'DISQUALIFIED_IVR', 'DISQUALIFIED_EARNINGS',
    ];
    const modeStates: CspModeQualification[] = ['NOT_APPLICABLE', 'PASSED', 'FAILED'];
    for (const market of disqualified) {
      for (const mode of modeStates) {
        expect(isOverallCspQualified(market, mode)).toBe(false);
      }
    }
  });
});

describe('isBestOpportunitiesEligible — the mode-qualification parameter, defaulted and explicit', () => {
  it('defaults modeQualification to NOT_APPLICABLE when the caller omits it -- unchanged behavior for callers that have not adopted mode qualification', () => {
    expect(isBestOpportunitiesEligible('QUALIFIED', 'ELIGIBLE')).toBe(true);
  });

  it('QUALIFIED + ELIGIBLE + Targeted PASSED is Best-Opportunities-eligible', () => {
    expect(isBestOpportunitiesEligible('QUALIFIED', 'ELIGIBLE', 'PASSED')).toBe(true);
  });

  it('QUALIFIED + ELIGIBLE + Targeted FAILED is NOT Best-Opportunities-eligible, even though market and account both pass', () => {
    expect(isBestOpportunitiesEligible('QUALIFIED', 'ELIGIBLE', 'FAILED')).toBe(false);
  });
});
