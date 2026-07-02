// lib/autopilot/config/defaults.ts

import type { AutopilotConfig } from '../types';

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
