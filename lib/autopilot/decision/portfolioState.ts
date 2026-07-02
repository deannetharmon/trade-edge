// lib/autopilot/decision/portfolioState.ts

import type { AutopilotStrategy, PaperAccount } from '../types';
import type { PortfolioStateSummary } from './types';

const STRATEGIES: AutopilotStrategy[] = ['BPS', 'BCS', 'IC', 'CSP', 'CC'];

function drawdownPct(account: PaperAccount): number {
  if (account.peakBalance <= 0) return 0;
  return Math.max(0, ((account.peakBalance - account.currentBalance) / account.peakBalance) * 100);
}

function openRisk(account: PaperAccount): number {
  return account.openPositions.reduce((sum, position) => sum + Math.max(0, position.theoreticalMaxLoss), 0);
}

export function buildPortfolioState(userId: string, account: PaperAccount): PortfolioStateSummary {
  const risk = openRisk(account);
  const tickerExposure: Record<string, number> = {};
  const strategyExposure = STRATEGIES.reduce((acc, strategy) => {
    acc[strategy] = 0;
    return acc;
  }, {} as Record<AutopilotStrategy, number>);

  for (const position of account.openPositions) {
    tickerExposure[position.symbol] = (tickerExposure[position.symbol] ?? 0) + Math.max(0, position.theoreticalMaxLoss);
    strategyExposure[position.strategy] += Math.max(0, position.theoreticalMaxLoss);
  }

  return {
    userId,
    currentBalance: account.currentBalance,
    peakBalance: account.peakBalance,
    openPositionCount: account.openPositions.length,
    closedPositionCount: account.closedPositions.length,
    openRisk: risk,
    openRiskPct: account.currentBalance > 0 ? (risk / account.currentBalance) * 100 : 0,
    drawdownPct: drawdownPct(account),
    tickerExposure,
    strategyExposure,
    generatedAt: new Date().toISOString(),
  };
}
