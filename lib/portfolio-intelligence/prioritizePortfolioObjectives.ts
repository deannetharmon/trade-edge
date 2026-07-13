// lib/portfolio-intelligence/prioritizePortfolioObjectives.ts
//
// PI-0003: the canonical priority engine. Supersedes TE-0006C's bespoke
// composite-score ranking (features/portfolio/priorities/) -- that module
// is now a re-export shim delegating here, the same pattern PI-0002 used
// for TE-0006A/B. This is the ONE ranking engine for portfolio priorities,
// used by evaluatePortfolioObjectives() internally and by any external
// caller combining objectives from multiple sources (position-level,
// portfolio-level, pending-order).
//
// Ranking order (three deterministic keys, no random component):
//   1. priority (critical > high > medium > low > informational)
//   2. category -- a fixed tier per objective type, matching the stated
//      general order: critical risk / threatened positions > time-sensitive
//      management > harvest profits > pending-order issues > portfolio
//      construction > buying-power preservation > idle-cash deployment >
//      increase income > wait
//   3. urgency, then confidence descending, as a final tie-break
//
// A deploy-cash or increase-income objective can never outrank a critical
// threatened-position objective: that's enforced structurally by both (a)
// DEPLOY_IDLE_CASH/INCREASE_INCOME never being assigned 'critical' priority
// by any producer, and (b) their category tier sitting below
// REVIEW_THREATENED_POSITION's regardless of priority ties.

import type { PortfolioObjective, PortfolioObjectivePriority, PortfolioObjectiveType, PortfolioObjectiveUrgency } from './types';

const PRIORITY_RANK: Record<PortfolioObjectivePriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  informational: 4,
};

const URGENCY_RANK: Record<PortfolioObjectiveUrgency, number> = {
  now: 0,
  today: 1,
  this_week: 2,
  monitor: 3,
  none: 4,
};

// Category order: critical risk / threatened positions -> time-sensitive
// management -> harvest profits -> pending-order issues -> portfolio
// construction -> buying-power preservation -> idle-cash deployment ->
// increase income -> wait. Portfolio construction (REDUCE_CONCENTRATION)
// now ranks explicitly ahead of buying-power preservation
// (PRESERVE_BUYING_POWER), which ranks ahead of idle-cash deployment,
// which ranks ahead of increase-income -- a finer split than PI-0002's
// four-tier version, per PI-0003's explicit ordering.
const CATEGORY_RANK: Record<PortfolioObjectiveType, number> = {
  REVIEW_THREATENED_POSITION: 0,
  MANAGE_POSITION: 1,
  ROLL_POSITION: 1,
  CLOSE_FOR_PROFIT: 2,
  REVIEW_PENDING_ORDER: 3,
  REDUCE_CONCENTRATION: 4,
  PRESERVE_BUYING_POWER: 5,
  DEPLOY_IDLE_CASH: 6,
  INCREASE_INCOME: 7,
  WAIT: 8,
};

const NEUTRAL_IMPACT = {
  direction: 'neutral' as const,
  magnitude: 'low' as const,
  explanation: 'No material effect on this dimension.',
};

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// Synthesized when a caller has zero objectives to show -- portfolio-level
// standalone (evaluatePortfolioObjectives() called with nothing to flag) or
// the full combined multi-source list (adapter-level). Identical shape
// either way: "wait" is a legitimate outcome, not an error state.
export function synthesizeWaitObjective(generatedAt: string): PortfolioObjective {
  return {
    id: createId('objective'),
    createdAt: generatedAt,
    version: 'portfolio-objective-v1',
    type: 'WAIT',
    ruleId: 'OBJ-WAIT',
    title: 'No action required',
    summary: 'No position, order, or portfolio-level condition currently justifies action.',
    priority: 'informational',
    urgency: 'none',
    actionability: 'MONITOR',
    confidence: 90,
    status: 'informational',
    source: 'portfolio_state',
    subject: { type: 'portfolio', label: 'Portfolio' },
    rationale: 'No open position is threatened, past its profit target, or past its DTE review threshold; no pending order needs review; concentration, buying-power utilization, drawdown, idle cash, and income are all within configured ranges. Waiting is the correct action today -- there is nothing to force.',
    supportingEvidence: [],
    concerns: [],
    portfolioImpact: NEUTRAL_IMPACT,
    incomeImpact: NEUTRAL_IMPACT,
    riskImpact: NEUTRAL_IMPACT,
    capitalImpact: NEUTRAL_IMPACT,
    reviewTriggers: [
      { id: 'next-evaluation', label: 'Next portfolio evaluation', triggerType: 'manual', explanation: 'Re-evaluate on the next scheduled portfolio review or when portfolio/position/order data changes.' },
    ],
    metadata: {
      executionAllowed: false,
      paperExecutionAllowed: false,
      rulesEvaluated: ['no_conditions_met'],
      rulesTriggered: ['no_conditions_met'],
    },
  };
}

// The canonical priority engine. Pure: same input always produces the same
// ordering (aside from each objective's own non-deterministic `id`, which
// is never part of the sort key). Empty input -> a single WAIT objective.
export function prioritizePortfolioObjectives(
  objectives: PortfolioObjective[],
  generatedAt: string = new Date().toISOString(),
): PortfolioObjective[] {
  if (objectives.length === 0) {
    return [synthesizeWaitObjective(generatedAt)];
  }

  return [...objectives].sort((a, b) => {
    const priorityDelta = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priorityDelta !== 0) return priorityDelta;

    const categoryDelta = CATEGORY_RANK[a.type] - CATEGORY_RANK[b.type];
    if (categoryDelta !== 0) return categoryDelta;

    const urgencyDelta = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (urgencyDelta !== 0) return urgencyDelta;

    return b.confidence - a.confidence;
  });
}
