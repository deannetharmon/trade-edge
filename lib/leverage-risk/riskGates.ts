import type { EconomicExposureAggregate } from './types';

export interface LeverageRiskPolicy {
  maxPositionStressLossPctPortfolio: number;
  maxUnderlyingGrossExposurePctPortfolio: number;
  maxUnderlyingNetExposurePctPortfolio: number;
}

export interface LeverageRiskGate {
  id: 'position_stress_loss' | 'underlying_gross_exposure' | 'underlying_net_exposure';
  passed: boolean;
  actualPct: number | null;
  limitPct: number;
  reason: string;
}

const pct = (value: number, portfolioValue: number): number | null =>
  Number.isFinite(value) && Number.isFinite(portfolioValue) && portfolioValue > 0
    ? (value / portfolioValue) * 100
    : null;

export function evaluateLeverageRiskGates(input: {
  portfolioValue: number;
  positionStressLoss: number | null;
  underlyingExposure: EconomicExposureAggregate | null;
  policy: LeverageRiskPolicy;
}): LeverageRiskGate[] {
  const stressPct = input.positionStressLoss == null ? null : pct(input.positionStressLoss, input.portfolioValue);
  const grossPct = input.underlyingExposure == null ? null : pct(input.underlyingExposure.grossExposure, input.portfolioValue);
  const netPct = input.underlyingExposure == null ? null : pct(Math.abs(input.underlyingExposure.netDirectionalExposure), input.portfolioValue);

  const build = (
    id: LeverageRiskGate['id'],
    actualPct: number | null,
    limitPct: number,
    label: string,
  ): LeverageRiskGate => ({
    id,
    passed: actualPct != null && actualPct <= limitPct,
    actualPct,
    limitPct,
    reason: actualPct == null
      ? `${label} unavailable; risk gate fails closed.`
      : actualPct <= limitPct
        ? `${label} is within configured limit.`
        : `${label} exceeds configured limit.`,
  });

  return [
    build('position_stress_loss', stressPct, input.policy.maxPositionStressLossPctPortfolio, 'Position stress loss'),
    build('underlying_gross_exposure', grossPct, input.policy.maxUnderlyingGrossExposurePctPortfolio, 'Underlying gross exposure'),
    build('underlying_net_exposure', netPct, input.policy.maxUnderlyingNetExposurePctPortfolio, 'Underlying net exposure'),
  ];
}

export const hasBlockingLeverageRiskGate = (gates: LeverageRiskGate[]): boolean =>
  gates.some(gate => !gate.passed);
