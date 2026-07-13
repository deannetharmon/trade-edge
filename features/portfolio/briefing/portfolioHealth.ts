// features/portfolio/briefing/portfolioHealth.ts
//
// PI-0004D: Portfolio Health -- a single overall status for the Daily
// Portfolio Briefing. Deliberately NOT a new Portfolio Intelligence rule --
// it is a pure aggregation over the already-ranked canonical objective list
// (prioritizePortfolioObjectives sorts worst-first: critical > high >
// medium > low > informational, WAIT last). Reading objectives[0] is
// therefore sufficient; no re-scoring, no new thresholds, no duplicate
// business logic.

import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

export type PortfolioHealthLevel = 'healthy' | 'attention' | 'action';

export interface PortfolioHealthStatus {
  level: PortfolioHealthLevel;
  emoji: string;
  label: string;
}

const HEALTH_BY_LEVEL: Record<PortfolioHealthLevel, PortfolioHealthStatus> = {
  healthy: { level: 'healthy', emoji: '\u{1F7E2}', label: 'Healthy' },
  attention: { level: 'attention', emoji: '\u{1F7E1}', label: 'Needs Attention' },
  action: { level: 'action', emoji: '\u{1F534}', label: 'Action Required' },
};

// Empty/null input (no data loaded yet) intentionally reads as Healthy
// rather than Action Required -- absence of data is not evidence of a
// problem, and the component itself decides separately whether to show a
// loading state instead of this status.
export function derivePortfolioHealth(objectives: PortfolioObjective[] | null): PortfolioHealthStatus {
  if (!objectives || objectives.length === 0) return HEALTH_BY_LEVEL.healthy;

  const top = objectives[0];
  if (top.type === 'WAIT') return HEALTH_BY_LEVEL.healthy;
  if (top.priority === 'critical' || top.actionability === 'CRITICAL') return HEALTH_BY_LEVEL.action;
  if (top.priority === 'high' || top.actionability === 'ACTION_NEEDED') return HEALTH_BY_LEVEL.attention;
  return HEALTH_BY_LEVEL.healthy;
}
