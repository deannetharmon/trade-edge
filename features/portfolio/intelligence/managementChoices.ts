// features/portfolio/intelligence/managementChoices.ts
//
// PI-0005: Available Management Choices for the Position Intelligence panel.
// A static, presentation-only relabeling of the canonical recommendation
// `kind` (already decided by evaluatePositionObjective in
// lib/portfolio-intelligence) into the sprint's fixed action vocabulary
// (Hold, Harvest, Roll, Close, Accept Assignment, Monitor). No thresholds,
// no evaluation, no new decision -- `kind` is already final by the time this
// runs; this only decides which words describe it and which reasonable
// alternatives to show alongside it.

import type { PortfolioRecommendationKind } from '@/lib/portfolio-intelligence';

export interface ManagementChoices {
  preferred: string;
  alternatives: string[];
}

const CHOICES_BY_KIND: Record<PortfolioRecommendationKind, ManagementChoices> = {
  hold: { preferred: 'Hold', alternatives: ['Harvest', 'Roll', 'Close', 'Monitor'] },
  watch: { preferred: 'Monitor', alternatives: ['Hold', 'Roll', 'Close'] },
  'close-winner': { preferred: 'Harvest', alternatives: ['Hold', 'Roll'] },
  'close-loser': { preferred: 'Close', alternatives: ['Roll', 'Hold'] },
  'roll-soon': { preferred: 'Roll', alternatives: ['Close', 'Hold'] },
  'place-gtc': { preferred: 'Harvest', alternatives: ['Hold', 'Monitor'] },
  'let-expire': { preferred: 'Hold', alternatives: ['Close', 'Monitor'] },
  'earnings-risk': { preferred: 'Monitor', alternatives: ['Close', 'Roll', 'Hold'] },
  'assignment-risk': { preferred: 'Accept Assignment', alternatives: ['Roll', 'Close'] },
};

export function deriveManagementChoices(kind: PortfolioRecommendationKind): ManagementChoices {
  return CHOICES_BY_KIND[kind];
}
