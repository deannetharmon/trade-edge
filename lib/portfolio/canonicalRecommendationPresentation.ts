import type { PortfolioRecommendation, PortfolioRecommendationKind } from '@/lib/portfolio-intelligence';
import type { ActionType, Recommendation } from '@/lib/portfolio-data/types';

export function canonicalRecommendationToAction(kind: PortfolioRecommendationKind): ActionType {
  switch (kind) {
    case 'close-winner': return 'TAKE_PROFIT';
    case 'close-loser': return 'CUT_LOSSES';
    case 'roll-soon': return 'CLOSE_ROLL';
    case 'place-gtc': return 'PLACE_GTC';
    case 'watch': return 'WATCH';
    case 'earnings-risk':
    case 'assignment-risk':
    case 'verify-pricing': return 'MANAGE';
    case 'hold':
    case 'let-expire': return 'HOLD';
  }
}

export function canonicalRecommendationForCard(
  canonical: PortfolioRecommendation | null | undefined,
): Recommendation & { publicLabel: string } {
  if (!canonical) return {
    action: 'WATCH',
    detail: 'Canonical recommendation is unavailable. Refresh portfolio data before acting.',
    publicLabel: 'Recommendation Unavailable',
  };
  return {
    action: canonicalRecommendationToAction(canonical.kind),
    detail: canonical.suggestedAction || canonical.primaryReason,
    publicLabel: canonical.label,
  };
}

export interface CanonicalAiProjection {
  recommendation: 'HOLD' | 'CLOSE' | 'ROLL' | 'TAKE_PROFIT' | 'CUT_LOSSES' | 'WATCH' | 'MANAGE';
  confidence: 'LOW';
  summary: string;
  reasoning: string;
  risks: string[];
  catalysts: string[];
  deviatesFromRules: false;
  deviationNote: null;
}

export function projectCanonicalRecommendationForAi(canonical: PortfolioRecommendation): CanonicalAiProjection {
  const recommendation: CanonicalAiProjection['recommendation'] = (() => {
    switch (canonical.kind) {
      case 'close-winner': return 'TAKE_PROFIT';
      case 'close-loser': return 'CUT_LOSSES';
      case 'roll-soon': return 'ROLL';
      case 'hold':
      case 'let-expire': return 'HOLD';
      case 'watch': return 'WATCH';
      default: return 'MANAGE';
    }
  })();
  return {
    recommendation,
    confidence: 'LOW',
    summary: canonical.suggestedAction || canonical.primaryReason,
    reasoning: [canonical.primaryReason, ...canonical.supportingReasons].filter(Boolean).join(' '),
    risks: [],
    catalysts: [],
    deviatesFromRules: false,
    deviationNote: null,
  };
}

const CANONICAL_PRIORITY: Record<PortfolioRecommendationKind, number> = {
  'close-loser': 0,
  'assignment-risk': 1,
  'earnings-risk': 2,
  'verify-pricing': 3,
  'close-winner': 4,
  'roll-soon': 5,
  'place-gtc': 6,
  'watch': 7,
  'let-expire': 8,
  'hold': 9,
};

export function canonicalRecommendationPriority(recommendation: PortfolioRecommendation | null | undefined): number {
  return recommendation ? CANONICAL_PRIORITY[recommendation.kind] : 99;
}
