// lib/autopilot/decision/riskGateEngine.ts

import type { AutopilotCandidate, AutopilotConfig } from '../types';
import type { PortfolioStateSummary, RiskGateResult } from './types';

function pass(rule: string, message: string): RiskGateResult {
  return { passed: true, rule, message, severity: 'info' };
}

function warn(rule: string, message: string): RiskGateResult {
  return { passed: true, rule, message, severity: 'warning' };
}

function block(rule: string, message: string): RiskGateResult {
  return { passed: false, rule, message, severity: 'block' };
}

export function evaluateRiskGates(
  candidate: AutopilotCandidate,
  config: AutopilotConfig,
  portfolio: PortfolioStateSummary,
): RiskGateResult[] {
  const gates: RiskGateResult[] = [];

  const maxLoss = Math.max(0, candidate.theoreticalMaxLoss);
  const maxAllowedLoss =
    portfolio.currentBalance *
    (config.thresholds.perTradeMaxLossPctEquity / 100);

  if (maxLoss <= maxAllowedLoss) {
    gates.push(pass('per_trade_max_loss', 'Max loss is within configured limit.'));
  } else {
    gates.push(block('per_trade_max_loss', 'Max loss exceeds configured limit.'));
  }

  if (portfolio.drawdownPct < config.thresholds.monthlyDrawdownDefensivePct) {
    gates.push(pass('drawdown', 'Drawdown is below defensive threshold.'));
  } else {
    gates.push(block('drawdown', 'Drawdown circuit breaker is active.'));
  }

  const currentTickerRisk = portfolio.tickerExposure[candidate.symbol] ?? 0;
  const projectedTickerRisk = currentTickerRisk + maxLoss;
  const tickerLimit =
    portfolio.currentBalance *
    (config.thresholds.singleTickerMaxPct / 100);

  if (projectedTickerRisk <= tickerLimit) {
    gates.push(pass('single_ticker', 'Ticker exposure is within configured limit.'));
  } else {
    gates.push(block('single_ticker', 'Ticker exposure exceeds configured limit.'));
  }

  const correlationPenalty = candidate.correlationPenalty ?? 0;
  const correlationLimit = config.thresholds.correlationSkipThreshold * 100;

  if (correlationPenalty <= correlationLimit) {
    gates.push(pass('correlation', 'Correlation penalty is within threshold.'));
  } else {
    gates.push(block('correlation', 'Correlation penalty exceeds threshold.'));
  }

  if (!candidate.sector) {
    gates.push(warn('sector_metadata', 'Sector metadata missing; sector cap cannot be fully evaluated yet.'));
  } else {
    gates.push(pass('sector_metadata', 'Sector metadata present.'));
  }

  return gates;
}

export function hasBlockingRiskGate(gates: RiskGateResult[]): boolean {
  return gates.some((gate) => !gate.passed);
}

export function summarizeRiskGateReasons(gates: RiskGateResult[]): string[] {
  return gates
    .filter((gate) => !gate.passed || gate.severity === 'warning')
    .map((gate) => `${gate.rule}: ${gate.message}`);
}
