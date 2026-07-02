// lib/autopilot/decision/portfolioState.ts

<<<<<<< HEAD
<<<<<<< HEAD
import type { AutopilotStrategy, PaperAccount, PaperPosition } from '../types';
=======
import type { AutopilotStrategy, PaperAccount } from '../types';
>>>>>>> 4b4a52f32dafad8f9373409920c5ba10eccf3d3a
=======
import type { AutopilotStrategy, PaperAccount, PaperPosition } from '../types';
>>>>>>> 7b8e977c4d7187a14e0733137390d657ab54f03c
import type { PortfolioStateSummary } from './types';

const STRATEGIES: AutopilotStrategy[] = ['BPS', 'BCS', 'IC', 'CSP', 'CC'];

<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 7b8e977c4d7187a14e0733137390d657ab54f03c
function safeNumber(value: number | undefined | null): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function getPositionRisk(position: PaperPosition): number {
  return Math.max(0, safeNumber(position.theoreticalMaxLoss));
}

function calculateDrawdownPct(account: PaperAccount): number {
<<<<<<< HEAD
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
=======
function drawdownPct(account: PaperAccount): number {
=======
>>>>>>> 7b8e977c4d7187a14e0733137390d657ab54f03c
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

<<<<<<< HEAD
export function buildPortfolioState(userId: string, account: PaperAccount): PortfolioStateSummary {
  const risk = openRisk(account);
  const tickerExposure: Record<string, number> = {};
  const strategyExposure = STRATEGIES.reduce((acc, strategy) => {
>>>>>>> 4b4a52f32dafad8f9373409920c5ba10eccf3d3a
=======
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
>>>>>>> 7b8e977c4d7187a14e0733137390d657ab54f03c
    acc[strategy] = 0;
    return acc;
  }, {} as Record<AutopilotStrategy, number>);

  for (const position of account.openPositions) {
<<<<<<< HEAD
<<<<<<< HEAD
    exposure[position.strategy] += getPositionRisk(position);
  }

  return exposure;
}

export function buildPortfolioState(
  userId: string,
  account: PaperAccount,
): PortfolioStateSummary {
  const openRisk = calculateOpenRisk(account);

=======
    tickerExposure[position.symbol] = (tickerExposure[position.symbol] ?? 0) + Math.max(0, position.theoreticalMaxLoss);
    strategyExposure[position.strategy] += Math.max(0, position.theoreticalMaxLoss);
  }

>>>>>>> 4b4a52f32dafad8f9373409920c5ba10eccf3d3a
=======
    exposure[position.strategy] += getPositionRisk(position);
  }

  return exposure;
}

export function buildPortfolioState(
  userId: string,
  account: PaperAccount,
): PortfolioStateSummary {
  const openRisk = calculateOpenRisk(account);

>>>>>>> 7b8e977c4d7187a14e0733137390d657ab54f03c
  return {
    userId,
    currentBalance: account.currentBalance,
    peakBalance: account.peakBalance,
    openPositionCount: account.openPositions.length,
    closedPositionCount: account.closedPositions.length,
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 7b8e977c4d7187a14e0733137390d657ab54f03c
    openRisk,
    openRiskPct:
      account.currentBalance > 0
        ? (openRisk / account.currentBalance) * 100
        : 0,
    drawdownPct: calculateDrawdownPct(account),
    tickerExposure: buildTickerExposure(account),
    strategyExposure: buildStrategyExposure(account),
<<<<<<< HEAD
=======
    openRisk: risk,
    openRiskPct: account.currentBalance > 0 ? (risk / account.currentBalance) * 100 : 0,
    drawdownPct: drawdownPct(account),
    tickerExposure,
    strategyExposure,
>>>>>>> 4b4a52f32dafad8f9373409920c5ba10eccf3d3a
=======
>>>>>>> 7b8e977c4d7187a14e0733137390d657ab54f03c
    generatedAt: new Date().toISOString(),
  };
}
