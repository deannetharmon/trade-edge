// features/portfolio/priorities/priority-types.ts

import type { PortfolioRecommendation, PortfolioRecommendationUrgency } from '../recommendations/recommendation-types';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

// A single ranked entry in the Daily Priority List. Everything here is
// derived deterministically from existing recommendation + health data plus
// a few raw position fields — no new market data, no AI, no persistence.
export interface PriorityItem {
  rank: number;                          // 1-based position in the sorted list
  positionId: string;                    // Position.key
  symbol: string;
  score: number;                         // 0-100 composite priority score
  urgency: PortfolioRecommendationUrgency;
  recommendationKind: PortfolioRecommendation['kind'];
  recommendationLabel: string;
  reason: string;                        // why this ranks where it does
  suggestedAction: string;               // carried from the recommendation
}

// Minimal shape the priority engine needs from each enriched position. The
// Portfolio page's Position objects already satisfy this after
// attachSnapshotHistory() attaches healthScore + recommendation + (PI-0002)
// portfolioObjective.
export interface PriorityPositionInput {
  key: string;
  symbol: string;
  dte: number | null;
  pnlPct: number | null;
  hitTarget?: boolean | null;
  needsClose?: boolean | null;
  earningsDate?: string | null;
  healthScore?: { score: number } | null;
  recommendation?: PortfolioRecommendation | null;
  // PI-0003: ranking now comes from the canonical PortfolioObjective via
  // prioritizePortfolioObjectives(), not this module's own composite-score
  // algorithm. Positions without one are excluded from ranking (nothing to
  // prioritize) -- see priority-engine.ts.
  objective?: PortfolioObjective | null;
}
