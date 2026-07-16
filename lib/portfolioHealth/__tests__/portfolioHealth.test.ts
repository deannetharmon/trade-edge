// lib/portfolioHealth/__tests__/portfolioHealth.test.ts
//
// PI-0011B: targeted tests for the deterministic Portfolio Health Score.
// Most tests isolate a single factor by zeroing every other factor's weight
// in a custom config, so the resulting score is a direct, checkable
// function of just that one factor's health impact.

import { describe, expect, it } from 'vitest';
import { calculatePortfolioHealthScore } from '../portfolioHealth';
import type { PortfolioHealthInput } from '../portfolioHealth';
import { DEFAULT_PORTFOLIO_HEALTH_CONFIG, type PortfolioHealthConfig } from '../config';

function makeInput(overrides: Partial<PortfolioHealthInput> = {}): PortfolioHealthInput {
  return {
    immediateActionsCount: 0,
    criticalPositionsCount: 0,
    totalPositionsCount: 10,
    earningsExposedPositionsCount: 0,
    buyingPowerUsedPct: 20,
    cashBalance: 1000,
    netLiquidity: 10000,
    maxSymbolConcentrationPct: 5,
    averagePositionHealth: 90,
    averageDecisionConfidence: 90,
    decisionReviewsNeedingFollowUpCount: 0,
    ...overrides,
  };
}

// Isolates exactly one factor by zeroing every weight except the one named,
// so score is a direct function of that factor's health impact:
// score === round((impact + 1) / 2 * 100).
function isolatingConfig(factor: keyof PortfolioHealthConfig['factorWeights']): PortfolioHealthConfig {
  const zeroed = Object.fromEntries(
    Object.keys(DEFAULT_PORTFOLIO_HEALTH_CONFIG.factorWeights).map((k) => [k, 0]),
  ) as unknown as PortfolioHealthConfig['factorWeights'];
  const factorWeights: PortfolioHealthConfig['factorWeights'] = { ...zeroed, [factor]: 1 };
  return { ...DEFAULT_PORTFOLIO_HEALTH_CONFIG, factorWeights };
}

describe('calculatePortfolioHealthScore: a fully healthy portfolio scores 100 and Healthy', () => {
  it('scores 100 with default weights when every factor is at its healthiest', () => {
    const input = makeInput({
      immediateActionsCount: 0,
      criticalPositionsCount: 0,
      earningsExposedPositionsCount: 0,
      buyingPowerUsedPct: 0,
      cashBalance: 0,
      netLiquidity: 10000,
      maxSymbolConcentrationPct: 0,
      averagePositionHealth: 100,
      averageDecisionConfidence: 100,
      decisionReviewsNeedingFollowUpCount: 0,
    });
    const result = calculatePortfolioHealthScore(input);
    expect(result.score).toBe(100);
    expect(result.status).toBe('Healthy');
    expect(result.negativeContributors).toHaveLength(0);
  });
});

describe('calculatePortfolioHealthScore: immediate actions factor', () => {
  it('is fully unhealthy (score 0) at or above the reference count', () => {
    const config = isolatingConfig('immediateActions');
    const result = calculatePortfolioHealthScore(makeInput({ immediateActionsCount: config.immediateActionsReferenceCount }), config);
    expect(result.score).toBe(0);
  });

  it('is fully healthy (score 100) with zero immediate actions', () => {
    const config = isolatingConfig('immediateActions');
    const result = calculatePortfolioHealthScore(makeInput({ immediateActionsCount: 0 }), config);
    expect(result.score).toBe(100);
  });
});

describe('calculatePortfolioHealthScore: critical positions factor', () => {
  it('scales down as distinct critical positions increase', () => {
    const config = isolatingConfig('criticalPositions');
    const few = calculatePortfolioHealthScore(makeInput({ criticalPositionsCount: 1 }), config).score;
    const many = calculatePortfolioHealthScore(makeInput({ criticalPositionsCount: config.criticalPositionsReferenceCount }), config).score;
    expect(many).toBeLessThan(few);
  });
});

describe('calculatePortfolioHealthScore: earnings concentration factor', () => {
  it('is fully unhealthy at or above the reference fraction of exposed positions', () => {
    const config = isolatingConfig('earningsConcentration');
    const result = calculatePortfolioHealthScore(
      makeInput({ totalPositionsCount: 10, earningsExposedPositionsCount: Math.ceil(10 * config.earningsConcentrationReferenceFraction) }),
      config,
    );
    expect(result.score).toBe(0);
  });

  it('is neutral-safe (fully healthy) when there are no positions at all', () => {
    const config = isolatingConfig('earningsConcentration');
    const result = calculatePortfolioHealthScore(makeInput({ totalPositionsCount: 0, earningsExposedPositionsCount: 0 }), config);
    expect(result.score).toBe(100);
  });
});

describe('calculatePortfolioHealthScore: capital deployment factor', () => {
  it('scales down as buyingPowerUsedPct rises toward the reference', () => {
    const config = isolatingConfig('capitalDeployment');
    const low = calculatePortfolioHealthScore(makeInput({ buyingPowerUsedPct: 10 }), config).score;
    const high = calculatePortfolioHealthScore(makeInput({ buyingPowerUsedPct: config.capitalDeploymentReferencePct }), config).score;
    expect(high).toBeLessThan(low);
    expect(high).toBe(0);
  });

  it('uses the configured neutral default when buyingPowerUsedPct is unavailable', () => {
    const config = isolatingConfig('capitalDeployment');
    const result = calculatePortfolioHealthScore(makeInput({ buyingPowerUsedPct: null }), config);
    expect(result.score).toBe(Math.round(((config.missingDataHealthImpact + 1) / 2) * 100));
  });
});

describe('calculatePortfolioHealthScore: cash allocation factor', () => {
  it('scales down as idle cash pct rises toward the reference', () => {
    const config = isolatingConfig('cashAllocation');
    const low = calculatePortfolioHealthScore(makeInput({ cashBalance: 100, netLiquidity: 10000 }), config).score;
    const high = calculatePortfolioHealthScore(
      makeInput({ cashBalance: config.idleCashReferencePct * 100, netLiquidity: 10000 }),
      config,
    ).score;
    expect(high).toBeLessThan(low);
  });

  it('uses the configured neutral default when netLiquidity is unavailable', () => {
    const config = isolatingConfig('cashAllocation');
    const result = calculatePortfolioHealthScore(makeInput({ cashBalance: 100, netLiquidity: null }), config);
    expect(result.score).toBe(Math.round(((config.missingDataHealthImpact + 1) / 2) * 100));
  });
});

describe('calculatePortfolioHealthScore: sector concentration factor', () => {
  it('never moves the score even at its own isolating weight, since its default weight is 0 in real config and it is a fixed neutral impact', () => {
    // Note: sectorConcentration's impact is hardcoded to 0 (no real sector
    // data source exists -- see module doc), so isolating it should always
    // produce a perfectly neutral 50, regardless of any other input.
    const config = isolatingConfig('sectorConcentration');
    const result = calculatePortfolioHealthScore(makeInput(), config);
    expect(result.score).toBe(50);
  });

  it('has weight 0 in the real default config, so it never appears as a contributor', () => {
    const result = calculatePortfolioHealthScore(makeInput());
    const allContributorIds = [...result.positiveContributors, ...result.negativeContributors].map((c) => c.id);
    expect(allContributorIds).not.toContain('sectorConcentration');
  });
});

describe('calculatePortfolioHealthScore: position concentration factor', () => {
  it('scales down as the max single-symbol concentration rises toward the reference', () => {
    const config = isolatingConfig('positionConcentration');
    const low = calculatePortfolioHealthScore(makeInput({ maxSymbolConcentrationPct: 1 }), config).score;
    const high = calculatePortfolioHealthScore(makeInput({ maxSymbolConcentrationPct: config.positionConcentrationReferencePct }), config).score;
    expect(high).toBeLessThan(low);
  });
});

describe('calculatePortfolioHealthScore: average position health factor', () => {
  it('scores higher as average position health rises', () => {
    const config = isolatingConfig('averagePositionHealth');
    const weak = calculatePortfolioHealthScore(makeInput({ averagePositionHealth: 20 }), config).score;
    const strong = calculatePortfolioHealthScore(makeInput({ averagePositionHealth: 95 }), config).score;
    expect(strong).toBeGreaterThan(weak);
  });
});

describe('calculatePortfolioHealthScore: average decision confidence factor', () => {
  it('scores higher as average decision confidence rises', () => {
    const config = isolatingConfig('averageDecisionConfidence');
    const low = calculatePortfolioHealthScore(makeInput({ averageDecisionConfidence: 10 }), config).score;
    const high = calculatePortfolioHealthScore(makeInput({ averageDecisionConfidence: 95 }), config).score;
    expect(high).toBeGreaterThan(low);
  });
});

describe('calculatePortfolioHealthScore: decision review follow-up factor', () => {
  it('is fully unhealthy at or above the reference count', () => {
    const config = isolatingConfig('decisionReviewFollowUp');
    const result = calculatePortfolioHealthScore(
      makeInput({ decisionReviewsNeedingFollowUpCount: config.decisionReviewFollowUpReferenceCount }),
      config,
    );
    expect(result.score).toBe(0);
  });
});

describe('calculatePortfolioHealthScore: status thresholds', () => {
  it('assigns Healthy/Needs Attention/Action Required per the configured cutoffs', () => {
    const config = isolatingConfig('averagePositionHealth');
    expect(calculatePortfolioHealthScore(makeInput({ averagePositionHealth: 100 }), config).status).toBe('Healthy');
    expect(calculatePortfolioHealthScore(makeInput({ averagePositionHealth: 60 }), config).status).toBe('Needs Attention');
    expect(calculatePortfolioHealthScore(makeInput({ averagePositionHealth: 0 }), config).status).toBe('Action Required');
  });
});

describe('calculatePortfolioHealthScore: contributors', () => {
  it('produces both positive and negative contributors, correctly ordered, capped at maxContributors', () => {
    const config: PortfolioHealthConfig = { ...DEFAULT_PORTFOLIO_HEALTH_CONFIG, maxContributors: 2 };
    const input = makeInput({
      // Healthy signals
      immediateActionsCount: 0,
      criticalPositionsCount: 0,
      averagePositionHealth: 100,
      // Unhealthy signals
      buyingPowerUsedPct: config.capitalDeploymentReferencePct,
      decisionReviewsNeedingFollowUpCount: config.decisionReviewFollowUpReferenceCount,
      maxSymbolConcentrationPct: config.positionConcentrationReferencePct,
    });
    const result = calculatePortfolioHealthScore(input, config);
    expect(result.positiveContributors.length).toBeLessThanOrEqual(2);
    expect(result.negativeContributors.length).toBeLessThanOrEqual(2);
    expect(result.positiveContributors.some((c) => c.id === 'immediateActions' || c.id === 'criticalPositions' || c.id === 'averagePositionHealth')).toBe(true);
    expect(result.negativeContributors.some((c) => c.id === 'capitalDeployment' || c.id === 'decisionReviewFollowUp' || c.id === 'positionConcentration')).toBe(true);
  });

  it('produces no contributors in either direction when every factor sits exactly at its midpoint', () => {
    // Every value below is chosen to land each factor's penalty at exactly
    // 0.5 (impact exactly 0) -- deliberately not rounded, since rounding to
    // the nearest integer count would nudge a factor's penalty away from
    // 0.5 and past the 0.15 contributor-inclusion threshold.
    const config: PortfolioHealthConfig = { ...DEFAULT_PORTFOLIO_HEALTH_CONFIG };
    const input = makeInput({
      immediateActionsCount: config.immediateActionsReferenceCount / 2,
      criticalPositionsCount: config.criticalPositionsReferenceCount / 2,
      totalPositionsCount: 10,
      earningsExposedPositionsCount: (10 * config.earningsConcentrationReferenceFraction) / 2,
      buyingPowerUsedPct: config.capitalDeploymentReferencePct / 2,
      cashBalance: (config.idleCashReferencePct / 2) * 100,
      netLiquidity: 10000,
      maxSymbolConcentrationPct: config.positionConcentrationReferencePct / 2,
      averagePositionHealth: 50,
      averageDecisionConfidence: 50,
      decisionReviewsNeedingFollowUpCount: config.decisionReviewFollowUpReferenceCount / 2,
    });
    const result = calculatePortfolioHealthScore(input, config);
    expect(result.positiveContributors).toHaveLength(0);
    expect(result.negativeContributors).toHaveLength(0);
  });
});
