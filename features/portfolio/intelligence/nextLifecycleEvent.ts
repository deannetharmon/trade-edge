// features/portfolio/intelligence/nextLifecycleEvent.ts
//
// PI-0005: Next Expected Lifecycle Event for the Position Intelligence
// panel. A static lookup combining two already-canonical classifications --
// the existing lifecycle type (classifyPositionLifecycle, already used for
// Positions-tab section sorting) and the existing recommendation `kind`
// (evaluatePositionObjective) -- into a one-line summary. Not a prediction
// engine: no new signal is evaluated, this only picks which of a fixed set
// of phrases describes the already-decided lifecycle/recommendation pair.

import type { PortfolioRecommendationKind } from '@/lib/portfolio-intelligence';
import type { PositionLifecycleType } from '@/lib/portfolio/positionLifecycle';

const EVENT_BY_KIND: Record<PortfolioRecommendationKind, string> = {
  hold: 'Continue monitoring.',
  watch: 'Continue monitoring.',
  'close-winner': 'Harvest likely next.',
  'close-loser': 'Review closing or rolling defensively.',
  'roll-soon': 'Review before the management window closes.',
  'place-gtc': 'Continue monitoring; profit-target order pending.',
  'let-expire': 'Continue monitoring through expiration.',
  'earnings-risk': 'Earnings review approaching.',
  'assignment-risk': 'Prepare for assignment.',
  'verify-pricing': 'Refresh broker leg quotes and verify the marketable estimate.',
};

export function deriveNextLifecycleEvent(
  lifecycleType: PositionLifecycleType,
  kind: PortfolioRecommendationKind,
): string {
  // Already-assigned stock with no option legs left: the standard next step
  // in this app's Wheel methodology is writing a covered call against it,
  // regardless of which recommendation kind fired (there's rarely a
  // position-level "action" objective on bare assigned stock).
  if (lifecycleType === 'ASSIGNED_STOCK') return 'Covered call candidate after assignment.';
  return EVENT_BY_KIND[kind];
}
