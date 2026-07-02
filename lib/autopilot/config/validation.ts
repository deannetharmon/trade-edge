// lib/autopilot/config/validation.ts

import type { AutopilotConfig, AutopilotGoal, AutopilotStrategy, PortfolioRiskPosture } from '../types';
import { DEFAULT_AUTOPILOT_CONFIG } from './defaults';

const STRATEGIES: AutopilotStrategy[] = ['BPS', 'BCS', 'IC', 'CSP', 'CC'];
const GOALS: AutopilotGoal[] = ['conserve', 'income', 'acquire', 'maximize'];
const POSTURES: PortfolioRiskPosture[] = ['conserve', 'steady', 'maximize'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function roundClamp(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clamp(value, fallback, min, max));
}

export function sanitizeAutopilotConfig(input: unknown): AutopilotConfig {
  const raw = isObject(input) ? input : {};
  const rawGoals = isObject(raw.perStrategyGoal) ? raw.perStrategyGoal : {};
  const rawThresholds = isObject(raw.thresholds) ? raw.thresholds : {};

  const perStrategyGoal = { ...DEFAULT_AUTOPILOT_CONFIG.perStrategyGoal };
  for (const strategy of STRATEGIES) {
    const maybeGoal = rawGoals[strategy];
    if (GOALS.includes(maybeGoal as AutopilotGoal)) {
      perStrategyGoal[strategy] = maybeGoal as AutopilotGoal;
    }
  }

  const maybePosture = raw.portfolioRiskPosture;
  const portfolioRiskPosture = POSTURES.includes(maybePosture as PortfolioRiskPosture)
    ? maybePosture as PortfolioRiskPosture
    : DEFAULT_AUTOPILOT_CONFIG.portfolioRiskPosture;

  return {
    perStrategyGoal,
    portfolioRiskPosture,
    thresholds: {
      perTradeMaxLossPctEquity: clamp(rawThresholds.perTradeMaxLossPctEquity, DEFAULT_AUTOPILOT_CONFIG.thresholds.perTradeMaxLossPctEquity, 0.25, 10),
      dailyLossPausePct: clamp(rawThresholds.dailyLossPausePct, DEFAULT_AUTOPILOT_CONFIG.thresholds.dailyLossPausePct, 0.25, 10),
      monthlyDrawdownDefensivePct: clamp(rawThresholds.monthlyDrawdownDefensivePct, DEFAULT_AUTOPILOT_CONFIG.thresholds.monthlyDrawdownDefensivePct, 1, 50),
      bpUtilizationMaxPct: clamp(rawThresholds.bpUtilizationMaxPct, DEFAULT_AUTOPILOT_CONFIG.thresholds.bpUtilizationMaxPct, 1, 100),
      bpUtilizationHighVixPct: clamp(rawThresholds.bpUtilizationHighVixPct, DEFAULT_AUTOPILOT_CONFIG.thresholds.bpUtilizationHighVixPct, 1, 100),
      singleTickerMaxPct: clamp(rawThresholds.singleTickerMaxPct, DEFAULT_AUTOPILOT_CONFIG.thresholds.singleTickerMaxPct, 1, 100),
      sectorMaxPct: clamp(rawThresholds.sectorMaxPct, DEFAULT_AUTOPILOT_CONFIG.thresholds.sectorMaxPct, 1, 100),
      maxEntriesPerDay: roundClamp(rawThresholds.maxEntriesPerDay, DEFAULT_AUTOPILOT_CONFIG.thresholds.maxEntriesPerDay, 0, 100),
      maxEntriesPerWeek: roundClamp(rawThresholds.maxEntriesPerWeek, DEFAULT_AUTOPILOT_CONFIG.thresholds.maxEntriesPerWeek, 0, 500),
      correlationSkipThreshold: clamp(rawThresholds.correlationSkipThreshold, DEFAULT_AUTOPILOT_CONFIG.thresholds.correlationSkipThreshold, 0, 1),
      ccIvrReplacementYieldPct: clamp(rawThresholds.ccIvrReplacementYieldPct, DEFAULT_AUTOPILOT_CONFIG.thresholds.ccIvrReplacementYieldPct, 0, 100),
      netEdgeFadeOffPeakPct: clamp(rawThresholds.netEdgeFadeOffPeakPct, DEFAULT_AUTOPILOT_CONFIG.thresholds.netEdgeFadeOffPeakPct, 0, 100),
      decisionConfidenceMinimum: clamp(rawThresholds.decisionConfidenceMinimum, DEFAULT_AUTOPILOT_CONFIG.thresholds.decisionConfidenceMinimum, 0, 100),
    },
    ccStockManagement: 'never-sell-escalate-on-thesis-break',
    killSwitchEnabled: typeof raw.killSwitchEnabled === 'boolean' ? raw.killSwitchEnabled : DEFAULT_AUTOPILOT_CONFIG.killSwitchEnabled,
    updatedAt: new Date().toISOString(),
  };
}
