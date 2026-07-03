// features/portfolio/recommendations/recommendation-types.ts

import type { PositionHealthScore } from '../health/health-types';

export type PortfolioRecommendationKind =
  | 'hold'
  | 'watch'
  | 'close-winner'
  | 'close-loser'
  | 'roll-soon'
  | 'place-gtc'
  | 'let-expire'
  | 'earnings-risk'
  | 'assignment-risk';

export type PortfolioRecommendationUrgency = 'low' | 'medium' | 'high' | 'critical';

export interface PortfolioRecommendation {
  positionId: string;
  symbol: string;
  kind: PortfolioRecommendationKind;
  label: string;
  urgency: PortfolioRecommendationUrgency;
  confidence: number;
  primaryReason: string;
  supportingReasons: string[];
  suggestedAction: string;
  computedAt: string;
}

export interface PortfolioRecommendationInput {
  positionId?: string;
  key?: string;
  symbol: string;
  strategy?: string | null;
  dte?: number | null;
  pnlPct?: number | null;
  pnl?: number | null;
  creditReceived?: number | null;
  hitTarget?: boolean | null;
  needsClose?: boolean | null;
  hasGtc?: boolean | null;
  buffer?: number | null;
  earningsDate?: string | null;
  expDate?: string | null;
  healthScore?: PositionHealthScore | null;
}
