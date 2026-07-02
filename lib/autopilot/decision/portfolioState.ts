// lib/autopilot/decision/portfolioState.ts

import type { AutopilotStrategy, PaperAccount, PaperPosition } from '../types';
import type { PortfolioStateSummary } from './types';

const STRATEGIES: AutopilotStrategy[] = ['BPS', 'BCS', 'IC', 'CSP', 'CC'];

function safeNumber(value: number | undefined | null): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function getPositionRisk(position: PaperPosition): number {
  return Math.max(0, safeNumber(position.theoreticalMaxLoss));
}

function calculateDrawdownPct(account: PaperAccount): number {
  if (account.peakBalance <= 0) return 0;
  return Math.max(
    0,
    ((account.peakBalance - account.currentBalance) / account.peakBalance) * 100,
  );
}

function calculateOpenRisk(account: PaperAccount): number {
  return account.openPositions.reduce((sum, position) => {
    return sum + getPositionRisk(position);
  }, 0);
}

function buildTickerExposure(account: PaperAccount): Record<string, number> {
  const exposure: Record<string, number> = {};

  for (const position of account.openPositions) {
    exposure[position.symbol] =
      (exposure[position.symbol] ?? 0) + getPositionRisk(position);
  }

  return exposure;
}

function buildStrategyExposure(
  account: PaperAccount,
): Record<AutopilotStrategy, number> {
  const exposure = STRATEGIES.reduce((acc, strategy) => {
    acc[strategy] = 0;
    return acc;
  }, {} as Record<AutopilotStrategy, number>);

  for (const position of account.openPositions) {
    exposure[position.strategy] += getPositionRisk(position);
  }

  return exposure;
}

export function buildPortfolioState(
  userId: string,
  account: PaperAccount,
): PortfolioStateSummary {
  const openRisk = calculateOpenRisk(account);

  return {
    userId,
    currentBalance: account.currentBalance,
    peakBalance: account.peakBalance,
    openPositionCount: account.openPositions.length,
    closedPositionCount: account.closedPositions.length,
    openRisk,
    openRiskPct:
      account.currentBalance > 0
        ? (openRisk / account.currentBalance) * 100
        : 0,
    drawdownPct: calculateDrawdownPct(account),
    tickerExposure: buildTickerExposure(account),
    strategyExposure: buildStrategyExposure(account),
    generatedAt: new Date().toISOString(),
  };
}
