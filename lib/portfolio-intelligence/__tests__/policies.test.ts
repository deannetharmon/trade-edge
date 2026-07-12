// lib/portfolio-intelligence/__tests__/policies.test.ts
//
// PI-0003: policy separation. Confirms the two policy objects are distinct,
// carry the expected (unchanged from pre-PI-0003) default values, and that
// evaluatePositionObjective() actually reads from them rather than
// re-hardcoding its own numbers.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PORTFOLIO_RISK_POLICY, DEFAULT_POSITION_MANAGEMENT_POLICY, evaluatePositionObjective } from '@/lib/portfolio-intelligence';

describe('PI-0003: policy separation', () => {
  it('PositionManagementPolicy and PortfolioRiskPolicy are distinct objects with no overlapping field names', () => {
    const positionKeys = Object.keys(DEFAULT_POSITION_MANAGEMENT_POLICY);
    const riskKeys = Object.keys(DEFAULT_PORTFOLIO_RISK_POLICY);
    const overlap = positionKeys.filter((k) => riskKeys.includes(k));
    expect(overlap).toEqual([]);
  });

  it('position management policy preserves the exact values evaluatePositionObjective used before PI-0003', () => {
    expect(DEFAULT_POSITION_MANAGEMENT_POLICY.profitTargetPct).toBe(50);
    expect(DEFAULT_POSITION_MANAGEMENT_POLICY.dteReviewThreshold).toBe(21);
    expect(DEFAULT_POSITION_MANAGEMENT_POLICY.materialLossPct).toBe(-100);
    expect(DEFAULT_POSITION_MANAGEMENT_POLICY.weakHealthLossPct).toBe(-50);
    expect(DEFAULT_POSITION_MANAGEMENT_POLICY.weakHealthScoreThreshold).toBe(50);
  });

  it('watch threshold (watchHealthScoreThreshold) is set and used to trigger OBJ-WATCH-POSITION', () => {
    expect(DEFAULT_POSITION_MANAGEMENT_POLICY.watchHealthScoreThreshold).toBe(75);

    const { objective } = evaluatePositionObjective({
      symbol: 'AMD',
      strategy: 'BPS',
      dte: 30,
      pnlPct: 5,
      buffer: 8,
      hasGtc: true,
      healthScore: { positionId: 'p1', symbol: 'AMD', score: 65, grade: 'watch', summary: '', factors: [], computedAt: new Date().toISOString() },
    });
    expect(objective).not.toBeNull();
    expect(objective!.ruleId).toBe('OBJ-WATCH-POSITION');
  });

  it('action threshold (actionHealthScoreThreshold) is set as a distinct, more severe value than watch', () => {
    expect(DEFAULT_POSITION_MANAGEMENT_POLICY.actionHealthScoreThreshold).toBe(40);
    expect(DEFAULT_POSITION_MANAGEMENT_POLICY.actionHealthScoreThreshold).toBeLessThan(
      DEFAULT_POSITION_MANAGEMENT_POLICY.watchHealthScoreThreshold,
    );
  });

  it('portfolio risk policy preserves the exact values already used across the codebase (matches AutopilotThresholds defaults)', () => {
    expect(DEFAULT_PORTFOLIO_RISK_POLICY.maxBuyingPowerUtilizationPct).toBe(65);
    expect(DEFAULT_PORTFOLIO_RISK_POLICY.defensiveDrawdownPct).toBe(8);
    expect(DEFAULT_PORTFOLIO_RISK_POLICY.maxSymbolConcentrationPct).toBe(10);
    expect(DEFAULT_PORTFOLIO_RISK_POLICY.maxSectorConcentrationPct).toBe(25);
  });

  it('portfolio risk policy candidateMaterialLossPct is deliberately different from position policy materialLossPct', () => {
    // Documents the PI-0002 decision this policy split now makes explicit:
    // the portfolio-level batch evaluator's threatened-position severity
    // (-200, "2x credit loss stop") is intentionally not the same number as
    // the position-level card evaluator's (-100, TE-0006B parity).
    expect(DEFAULT_PORTFOLIO_RISK_POLICY.candidateMaterialLossPct).toBe(-200);
    expect(DEFAULT_PORTFOLIO_RISK_POLICY.candidateMaterialLossPct).not.toBe(DEFAULT_POSITION_MANAGEMENT_POLICY.materialLossPct);
  });

  it('candidate risk policy field exists and is documented (not yet enforced)', () => {
    expect(DEFAULT_PORTFOLIO_RISK_POLICY.maxNewCandidateRiskPct).toBe(10);
  });
});
