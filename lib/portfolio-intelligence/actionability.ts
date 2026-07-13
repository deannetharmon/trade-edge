// lib/portfolio-intelligence/actionability.ts
//
// PI-0004B: shared, small helper for deriving an objective's default
// Actionability from its priority, used by every producer
// (evaluatePortfolioObjectives.ts, objectives/positionObjective.ts,
// prioritizePortfolioObjectives.ts's synthesizeWaitObjective) so the
// priority -> actionability mapping lives in exactly one place.
//
// This is a *default* -- individual rules that have their own dedicated
// actionability logic (currently: earnings-risk in positionObjective.ts,
// gated against DEFAULT_POSITION_MANAGEMENT_POLICY.earningsReviewWindowDays)
// compute their own value instead of calling this function. Everything else
// -- assignment-risk, close-loser, close-winner, roll-soon, place-gtc,
// let-expire, watch, concentration, buying-power, idle-cash, income,
// pending-order -- was already actionable the moment it fired (no separate
// "review window" concept applies), so priority is a sufficient proxy for
// actionability for those rules today.
import type { PortfolioObjectiveActionability, PortfolioObjectivePriority } from './types';

export function defaultActionabilityForPriority(priority: PortfolioObjectivePriority): PortfolioObjectiveActionability {
  switch (priority) {
    case 'critical':
      return 'CRITICAL';
    case 'high':
    case 'medium':
      return 'ACTION_NEEDED';
    case 'low':
      return 'REVIEW_SOON';
    case 'informational':
      return 'MONITOR';
    default:
      return 'REVIEW_SOON';
  }
}
