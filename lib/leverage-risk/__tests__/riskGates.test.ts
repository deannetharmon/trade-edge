import { describe, expect, it } from 'vitest';
import { evaluateLeverageRiskGates, hasBlockingLeverageRiskGate } from '../riskGates';

const policy = {
  maxPositionStressLossPctPortfolio: 5,
  maxUnderlyingGrossExposurePctPortfolio: 50,
  maxUnderlyingNetExposurePctPortfolio: 30,
};

describe('LEV-0001 hard risk gates', () => {
  it('blocks instead of score-penalizing a stress limit breach', () => {
    const gates = evaluateLeverageRiskGates({
      portfolioValue: 100_000,
      positionStressLoss: 6_000,
      underlyingExposure: {
        economicUnderlying: 'NVDA',
        grossBullishExposure: 20_000,
        grossBearishExposure: 0,
        grossExposure: 20_000,
        netDirectionalExposure: 20_000,
        capitalDeployed: 10_000,
      },
      policy,
    });
    expect(gates.find(g => g.id === 'position_stress_loss')).toMatchObject({ passed: false, actualPct: 6 });
    expect(hasBlockingLeverageRiskGate(gates)).toBe(true);
  });

  it('does not let offsetting net exposure hide excessive gross exposure', () => {
    const gates = evaluateLeverageRiskGates({
      portfolioValue: 100_000,
      positionStressLoss: 2_000,
      underlyingExposure: {
        economicUnderlying: 'NVDA',
        grossBullishExposure: 100_000,
        grossBearishExposure: 80_000,
        grossExposure: 180_000,
        netDirectionalExposure: 20_000,
        capitalDeployed: 130_000,
      },
      policy,
    });
    expect(gates.find(g => g.id === 'underlying_gross_exposure')?.passed).toBe(false);
    expect(gates.find(g => g.id === 'underlying_net_exposure')?.passed).toBe(true);
  });

  it('fails closed when required risk evidence is unavailable', () => {
    const gates = evaluateLeverageRiskGates({
      portfolioValue: 100_000,
      positionStressLoss: null,
      underlyingExposure: null,
      policy,
    });
    expect(gates.every(g => !g.passed)).toBe(true);
  });
});
