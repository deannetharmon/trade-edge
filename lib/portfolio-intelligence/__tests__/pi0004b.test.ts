// lib/portfolio-intelligence/__tests__/pi0004b.test.ts
//
// PI-0004B (Sprint 4B: Recommendation Intelligence Refinement) regression
// coverage for the two stories in this sprint:
//   Story 1 -- Actionability: earnings-risk objectives outside the review
//     window are real but not surfaced in Today's Priorities (the AMD
//     scenario from the sprint brief).
//   Story 2 -- Position Strategy / Assignment Preference: a Wheel position
//     with assignment preferred no longer gets a concentration
//     recommendation that implies abandoning the Wheel (the NVDA scenario).
// Plus a legacy-compatibility check: neither field is required, and callers
// that never set them get byte-identical pre-PI-0004B behavior.

import { describe, expect, it } from 'vitest';
import {
  computeCanonicalPortfolioPriorities,
  defaultActionabilityForPriority,
  evaluatePortfolioObjectives,
  evaluatePositionObjective,
} from '@/lib/portfolio-intelligence';
import { makeContext, makePortfolioState } from '../../../test/fixtures/portfolioIntelligenceFixtures';

const NOW = new Date('2026-07-11T13:00:00.000Z');

describe('PI-0004B: defaultActionabilityForPriority', () => {
  it('maps priority to the expected actionability tier', () => {
    expect(defaultActionabilityForPriority('critical')).toBe('CRITICAL');
    expect(defaultActionabilityForPriority('high')).toBe('ACTION_NEEDED');
    expect(defaultActionabilityForPriority('medium')).toBe('ACTION_NEEDED');
    expect(defaultActionabilityForPriority('low')).toBe('REVIEW_SOON');
    expect(defaultActionabilityForPriority('informational')).toBe('MONITOR');
  });
});

// ---------------------------------------------------------------------------
// Story 1 -- AMD earnings scenario
// ---------------------------------------------------------------------------
describe('PI-0004B / AMD regression: earnings actionability gating', () => {
  // Healthy position, low delta implied by a comfortable buffer, earnings
  // before expiration but 25 calendar days out -- outside the 10-day
  // earningsReviewWindowDays policy. Matches the sprint brief's AMD example
  // exactly: a true fact (earnings before expiration) that isn't actionable
  // yet.
  const healthyAmdOutsideWindow = {
    positionId: 'pos_amd',
    symbol: 'AMD',
    strategy: 'BPS',
    dte: 30,
    pnlPct: 10,
    buffer: 8,
    hasGtc: true,
    earningsDate: '2026-08-05', // 25 days from NOW
    expDate: '2026-08-20',
  };

  it('earnings-risk is still detected (internal) but tagged MONITOR outside the review window', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(healthyAmdOutsideWindow, NOW);
    expect(legacyRecommendation.kind).toBe('earnings-risk');
    expect(objective).not.toBeNull();
    expect(objective!.actionability).toBe('MONITOR');
  });

  it('promotes to REVIEW_SOON once earnings fall inside the review window', () => {
    const { objective } = evaluatePositionObjective(
      { ...healthyAmdOutsideWindow, earningsDate: '2026-07-18' }, // 7 days from NOW
      NOW,
    );
    expect(objective).not.toBeNull();
    expect(objective!.actionability).toBe('REVIEW_SOON');
  });

  it('Today\'s Priorities does not surface the AMD recommendation while outside the review window', () => {
    const result = computeCanonicalPortfolioPriorities(
      [healthyAmdOutsideWindow],
      {},
      [],
      [],
      NOW,
    );
    expect(result.positionObjectiveCount).toBe(0);
    expect(result.objectives.some((o) => o.ruleId === 'OBJ-EARNINGS-RISK')).toBe(false);
    // Nothing else qualifies either -- falls back to the canonical WAIT.
    expect(result.objectives).toHaveLength(1);
    expect(result.objectives[0].type).toBe('WAIT');
  });

  it('Today\'s Priorities surfaces the recommendation once the review window opens', () => {
    const result = computeCanonicalPortfolioPriorities(
      [{ ...healthyAmdOutsideWindow, earningsDate: '2026-07-18' }],
      {},
      [],
      [],
      NOW,
    );
    expect(result.positionObjectiveCount).toBe(1);
    expect(result.objectives.some((o) => o.ruleId === 'OBJ-EARNINGS-RISK')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Story 2 -- NVDA Wheel scenario
// ---------------------------------------------------------------------------
describe('PI-0004B / NVDA regression: Wheel-aware concentration', () => {
  it('keeps the concentration warning but does not recommend reducing a Wheel+PREFER position below the hard-breach tier', () => {
    const context = makeContext({
      portfolio: makePortfolioState({
        symbolConcentrationPct: { NVDA: 13 }, // above 10% limit, below 15% hard-breach tier
        maxSymbolConcentrationPct: 10,
        symbolWheelDominance: { NVDA: 1 },
      }),
    });
    const objective = evaluatePortfolioObjectives(context).find((o) => o.type === 'REDUCE_CONCENTRATION');

    expect(objective).toBeDefined(); // concentration recommendation remains
    expect(objective!.concerns.length).toBeGreaterThan(0); // warning preserved
    expect(objective!.rationale).toContain('continue managing the Wheel');
    expect(objective!.rationale.toLowerCase()).toContain('avoid opening additional nvda');
    expect(objective!.rationale).not.toContain('consider trimming');
    // Explicitly reassures the trader this is NOT a "reduce/abandon" recommendation.
    expect(objective!.rationale).toContain('does not recommend reducing or abandoning it');
  });

  it('still recommends reducing exposure once a hard portfolio risk rule (1.5x breach) is hit, even for a Wheel position', () => {
    const context = makeContext({
      portfolio: makePortfolioState({
        symbolConcentrationPct: { NVDA: 20 }, // >= 15% hard-breach tier (10 * 1.5)
        maxSymbolConcentrationPct: 10,
        symbolWheelDominance: { NVDA: 1 },
      }),
    });
    const objective = evaluatePortfolioObjectives(context).find((o) => o.type === 'REDUCE_CONCENTRATION');

    expect(objective).toBeDefined();
    expect(objective!.priority).toBe('high');
    expect(objective!.rationale).toContain('consider trimming');
  });

  it('full pipeline: a Wheel CSP with high NVDA concentration keeps the warning, does not suggest abandoning the Wheel, and discourages further NVDA deployment', () => {
    const result = computeCanonicalPortfolioPriorities(
      [{ positionId: 'pos_nvda_csp', symbol: 'NVDA', strategy: 'CSP', dte: 30, pnlPct: 15, buffer: 8, hasGtc: true }], // healthy CSP -> no per-position objective
      { netLiquidity: 100000 },
      [{ symbol: 'NVDA', maxRisk: 13000, positionStrategy: 'WHEEL', assignmentPreference: 'PREFER' }], // 13% concentration
      [],
      NOW,
    );

    const concentration = result.objectives.find((o) => o.type === 'REDUCE_CONCENTRATION');
    expect(concentration).toBeDefined(); // concentration recommendation remains
    expect(concentration!.rationale).toContain('does not recommend reducing or abandoning it');
    expect(concentration!.rationale).toContain('continue managing the Wheel');
    expect(concentration!.rationale.toLowerCase()).toContain('avoid opening additional nvda');
  });
});

// ---------------------------------------------------------------------------
// Legacy compatibility -- no Position Strategy / Assignment Preference set
// ---------------------------------------------------------------------------
describe('PI-0004B: legacy positions with no Position Strategy remain backward-compatible', () => {
  it('a symbol with no symbolWheelDominance data gets the unchanged, pre-PI-0004B concentration rationale', () => {
    const context = makeContext({
      portfolio: makePortfolioState({
        symbolConcentrationPct: { MU: 13 },
        maxSymbolConcentrationPct: 10,
        // symbolWheelDominance intentionally omitted -- legacy caller.
      }),
    });
    const objective = evaluatePortfolioObjectives(context).find((o) => o.type === 'REDUCE_CONCENTRATION');

    expect(objective).toBeDefined();
    expect(objective!.rationale).toContain('consider trimming, avoiding new entries on this symbol, or diversifying');
  });

  it('a position input with no positionStrategy/assignmentPreference fields evaluates exactly as before PI-0004B', () => {
    const result = computeCanonicalPortfolioPriorities(
      [{ positionId: 'pos_legacy', symbol: 'MU', strategy: 'BPS', dte: 25, pnlPct: 55, buffer: 8, hasGtc: true }], // close-winner, unrelated to concentration
      { netLiquidity: 100000 },
      [{ symbol: 'MU', maxRisk: 13000 }], // no positionStrategy/assignmentPreference -> 13% concentration, non-Wheel language
      [],
      NOW,
    );

    expect(result.objectives.some((o) => o.type === 'CLOSE_FOR_PROFIT')).toBe(true);
    const concentration = result.objectives.find((o) => o.type === 'REDUCE_CONCENTRATION');
    expect(concentration).toBeDefined();
    expect(concentration!.rationale).toContain('consider trimming');
  });
});
