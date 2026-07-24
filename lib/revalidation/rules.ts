// lib/revalidation/rules.ts
//
// MB-0001B: initial rule scaffolding for the Revalidation Engine.
//
// Coverage today, deliberately honest rather than complete:
//
//   HOLD_UNTIL_DTE    -- real rule. Fires when the position's current DTE
//                        (from RevalidationContext.position, already
//                        computed upstream) has reached or passed the
//                        commitment's targetDte.
//   WAIT_FOR_EARNINGS -- real rule. Fires when the subject's current
//                        PortfolioObjective now carries an 'earnings'
//                        review trigger -- the same existing signal
//                        lib/todaysPriorities/dashboard.ts's hasTrigger()
//                        already uses to route objectives into the
//                        Earnings Review bucket. No new earnings-proximity
//                        computation is introduced here.
//   MONITOR           -- real rule, conditional. A Monitor commitment carries
//                        an explicit `reviewAfter` field (see
//                        lib/trader-commitments/types.ts's MonitorCommitment)
//                        that separates two distinct, equally intentional
//                        states: `reviewAfter: null` is indefinite
//                        acknowledgment (the trader decided no re-review
//                        date applies) and stays silent forever, by design;
//                        a set `reviewAfter` date is active monitoring with
//                        an explicit re-review condition, and fires exactly
//                        once RevalidationContext.now reaches or passes it.
//                        This corrects the original foundation pass, which
//                        made MONITOR always-silent regardless of trader
//                        intent -- see
//                        docs/design/MB-0001B-Review-Conductor-Foundation.md's
//                        corrective-round addendum.
//
//   LET_THETA_WORK    -- NOT registered. A real rule would need a theta-
//                        decay/time-value-captured signal this codebase
//                        does not compute anywhere today (Remaining
//                        Opportunity, lib/portfolio-intelligence/
//                        remainingOpportunity.ts, is the closest existing
//                        candidate but was not in scope to wire into this
//                        foundation sprint). Leaving this kind unregistered
//                        is an explicit, disclosed gap -- not a placeholder
//                        function that always returns null pretending to
//                        have checked something.
//   GTC_WORKING       -- NOT registered. A real rule needs live broker
//                        order-status data, which this engine is
//                        deliberately forbidden from fetching (see the
//                        module doc in types.ts and this sprint's "no new
//                        market-data acquisition" constraint). Wiring this
//                        up is future work once an order-status feed is
//                        available to pass through RevalidationContext.
//
// Both gaps are surfaced explicitly in
// docs/design/MB-0001B-Review-Conductor-Foundation.md's Known Limitations.

import type { RevalidationChange, RevalidationContext, RevalidationRule, RevalidationRuleRegistry } from './types';
import type { TraderCommitment } from '@/lib/trader-commitments';

function hasEarningsTrigger(objective: RevalidationContext['objective']): boolean {
  return objective !== null && objective.reviewTriggers.some((trigger) => trigger.triggerType === 'earnings');
}

// Fires only when there is real position context to compare against --
// absent context is "insufficient information to evaluate", never treated
// as "nothing changed" or fabricated into "something changed".
const holdUntilDteRule: RevalidationRule = (commitment: TraderCommitment, context: RevalidationContext): RevalidationChange | null => {
  if (commitment.kind !== 'HOLD_UNTIL_DTE') return null;
  if (context.position === null) return null;

  if (context.position.dte > commitment.targetDte) return null;

  return {
    whatChanged: `${commitment.subject.label} has reached ${context.position.dte} DTE, at or past your target of ${commitment.targetDte} DTE.`,
    whyItMatters: 'The condition you set this commitment to wait for has now been met, so the original reason to keep waiting no longer applies on its own.',
    whyNow: `Current DTE (${context.position.dte}) is at or below your ${commitment.targetDte}-DTE target.`,
  };
};

const waitForEarningsRule: RevalidationRule = (commitment: TraderCommitment, context: RevalidationContext): RevalidationChange | null => {
  if (commitment.kind !== 'WAIT_FOR_EARNINGS') return null;
  if (!hasEarningsTrigger(context.objective)) return null;

  return {
    whatChanged: `${commitment.subject.label} now has an earnings event inside its review window.`,
    whyItMatters: 'This is exactly the event you set this commitment to wait for.',
    whyNow: 'The earnings review trigger is active as of this review.',
  };
};

// Silent when the commitment has no re-review date (indefinite
// acknowledgment) or the date hasn't arrived yet; fires exactly once
// `context.now` reaches or passes `reviewAfter`. See module doc above.
const monitorRule: RevalidationRule = (commitment: TraderCommitment, context: RevalidationContext): RevalidationChange | null => {
  if (commitment.kind !== 'MONITOR') return null;
  if (commitment.reviewAfter === null) return null;
  if (new Date(context.now).getTime() < new Date(commitment.reviewAfter).getTime()) return null;

  return {
    whatChanged: `${commitment.subject.label} has reached its scheduled re-review date (${commitment.reviewAfter}).`,
    whyItMatters: 'You chose to monitor this without acting, but set a date to revisit that decision. That date has arrived.',
    whyNow: `The re-review date you set (${commitment.reviewAfter}) is at or before today (${context.now}).`,
  };
};

export const DEFAULT_REVALIDATION_RULES: RevalidationRuleRegistry = {
  HOLD_UNTIL_DTE: holdUntilDteRule,
  WAIT_FOR_EARNINGS: waitForEarningsRule,
  MONITOR: monitorRule,
  // LET_THETA_WORK and GTC_WORKING intentionally omitted -- see module doc.
};
