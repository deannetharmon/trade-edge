// lib/autopilot/config.ts

import type { AutopilotConfig } from './types';

export const DEFAULT_AUTOPILOT_CONFIG: AutopilotConfig = {
  perStrategyGoal: {
    BPS: 'income',
    BCS: 'income',
    IC: 'income',
    CSP: 'acquire',
    CC: 'income',
  },
  portfolioRiskPosture: 'steady',
  thresholds: {
    perTradeMaxLossPctEquity: 2.5,
    dailyLossPausePct: 2,
    monthlyDrawdownDefensivePct: 8,
    bpUtilizationMaxPct: 65,
    bpUtilizationHighVixPct: 50,
    singleTickerMaxPct: 10,
    sectorMaxPct: 25,
    maxEntriesPerDay: 3,
    maxEntriesPerWeek: 10,
    correlationSkipThreshold: 0.65,
    ccIvrReplacementYieldPct: 12,
    netEdgeFadeOffPeakPct: 25,
    decisionConfidenceMinimum: 70,
  },
  ccStockManagement: 'never-sell-escalate-on-thesis-break',
  killSwitchEnabled: false,
  updatedAt: new Date(0).toISOString(),
};

export function mergeAutopilotConfig(partial?: Partial<AutopilotConfig> | null): AutopilotConfig {
  if (!partial) return { ...DEFAULT_AUTOPILOT_CONFIG, updatedAt: new Date().toISOString() };

  return {
    ...DEFAULT_AUTOPILOT_CONFIG,
    ...partial,
    perStrategyGoal: {
      ...DEFAULT_AUTOPILOT_CONFIG.perStrategyGoal,
      ...(partial.perStrategyGoal ?? {}),
    },
    thresholds: {
      ...DEFAULT_AUTOPILOT_CONFIG.thresholds,
      ...(partial.thresholds ?? {}),
    },
    ccStockManagement: 'never-sell-escalate-on-thesis-break',
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
  };
}

export function sanitizeAutopilotConfig(input: unknown): AutopilotConfig {
  const next = mergeAutopilotConfig(typeof input === 'object' && input ? input as Partial<AutopilotConfig> : null);

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

  next.thresholds.perTradeMaxLossPctEquity = clamp(next.thresholds.perTradeMaxLossPctEquity, 0.25, 10);
  next.thresholds.dailyLossPausePct = clamp(next.thresholds.dailyLossPausePct, 0.25, 10);
  next.thresholds.monthlyDrawdownDefensivePct = clamp(next.thresholds.monthlyDrawdownDefensivePct, 1, 50);
  next.thresholds.bpUtilizationMaxPct = clamp(next.thresholds.bpUtilizationMaxPct, 1, 100);
  next.thresholds.bpUtilizationHighVixPct = clamp(next.thresholds.bpUtilizationHighVixPct, 1, 100);
  next.thresholds.singleTickerMaxPct = clamp(next.thresholds.singleTickerMaxPct, 1, 100);
  next.thresholds.sectorMaxPct = clamp(next.thresholds.sectorMaxPct, 1, 100);
  next.thresholds.maxEntriesPerDay = Math.round(clamp(next.thresholds.maxEntriesPerDay, 0, 100));
  next.thresholds.maxEntriesPerWeek = Math.round(clamp(next.thresholds.maxEntriesPerWeek, 0, 500));
  next.thresholds.correlationSkipThreshold = clamp(next.thresholds.correlationSkipThreshold, 0, 1);
  next.thresholds.ccIvrReplacementYieldPct = clamp(next.thresholds.ccIvrReplacementYieldPct, 0, 100);
  next.thresholds.netEdgeFadeOffPeakPct = clamp(next.thresholds.netEdgeFadeOffPeakPct, 0, 100);
  next.thresholds.decisionConfidenceMinimum = clamp(next.thresholds.decisionConfidenceMinimum, 0, 100);
  next.updatedAt = new Date().toISOString();

  return next;
}
