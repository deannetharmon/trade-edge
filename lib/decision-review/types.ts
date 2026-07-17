// lib/decision-review/types.ts
//
// PI-0008C: Decision Outcome Tracking V1.
//
// This module is deliberately separate from lib/decision-engine and
// lib/portfolio-intelligence -- it records what the Decision Engine already
// recommended and what happened next; it does not read scoring internals,
// does not feed anything back into selectManagementIntent() or
// evaluatePositionObjective(), and nothing here can change a recommendation.
// That boundary is the point of this ticket (see its "Constraints": no
// scoring change, no intent-selection change, no automatic learning, no
// automatic correctness determination) and matches the Decision Engine
// Constitution's II.7 "Boundaries over cleverness" -- a clean, one-way
// dependency (decision-review -> portfolio-intelligence's types, never the
// reverse) is a simpler and safer boundary than a clever shared model.

// ---------------------------------------------------------------------------
// Trader action vocabulary
// ---------------------------------------------------------------------------
export type TraderAction =
  | 'FOLLOWED_RECOMMENDATION'
  | 'HELD_POSITION'
  | 'TOOK_PROFIT'
  | 'CUT_LOSSES'
  | 'REDUCED_RISK'
  | 'ROLLED_POSITION'
  | 'ACCEPTED_ASSIGNMENT'
  | 'OTHER';

export const TRADER_ACTIONS: TraderAction[] = [
  'FOLLOWED_RECOMMENDATION',
  'HELD_POSITION',
  'TOOK_PROFIT',
  'CUT_LOSSES',
  'REDUCED_RISK',
  'ROLLED_POSITION',
  'ACCEPTED_ASSIGNMENT',
  'OTHER',
];

export const TRADER_ACTION_LABEL: Record<TraderAction, string> = {
  FOLLOWED_RECOMMENDATION: 'Followed Recommendation',
  HELD_POSITION: 'Held Position',
  TOOK_PROFIT: 'Took Profit',
  CUT_LOSSES: 'Cut Losses',
  REDUCED_RISK: 'Reduced Risk',
  ROLLED_POSITION: 'Rolled Position',
  ACCEPTED_ASSIGNMENT: 'Accepted Assignment',
  OTHER: 'Other',
};

// ---------------------------------------------------------------------------
// Outcome status
//
// V1 never sets or infers this automatically -- see this ticket's explicit
// "Do not automatically determine whether the engine was correct" and the
// Constitution's IX.3 ("mistakes are data, not shame") and VI.1 ("a good
// decision and a good outcome are not the same thing"). The trader alone
// chooses this value; every status below defaults to PENDING until they do.
// ---------------------------------------------------------------------------
export type DecisionOutcomeStatus =
  | 'PENDING'
  | 'FAVORABLE'
  | 'UNFAVORABLE'
  | 'NEUTRAL'
  | 'INSUFFICIENT_DATA';

export const DECISION_OUTCOME_STATUSES: DecisionOutcomeStatus[] = [
  'PENDING',
  'FAVORABLE',
  'UNFAVORABLE',
  'NEUTRAL',
  'INSUFFICIENT_DATA',
];

export const DECISION_OUTCOME_STATUS_LABEL: Record<DecisionOutcomeStatus, string> = {
  PENDING: 'Pending',
  FAVORABLE: 'Favorable',
  UNFAVORABLE: 'Unfavorable',
  NEUTRAL: 'Neutral',
  INSUFFICIENT_DATA: 'Insufficient Data',
};

// ---------------------------------------------------------------------------
// Evidence snapshot
//
// A plain, self-contained copy of the recommendation as it existed the
// moment this review was created -- deliberately NOT a live reference to a
// ManagementIntentResult (or to PortfolioRecommendation itself), and every
// field here is a primitive (string/number/null), not an object from
// managementIntent.ts's own type definitions. This is what "Snapshot
// integrity" (ticket #7) means in practice: this record must keep meaning
// exactly what it meant at creation time even if the live recommendation for
// this position changes on the next portfolio refresh, or if a future ticket
// retunes the Decision Quality Matrix entirely. See the Constitution's II.5
// ("no hidden state -- a recommendation must be reconstructable from its
// stated evidence alone") -- this snapshot is that evidence, frozen.
// ---------------------------------------------------------------------------
export interface DecisionReviewEvidenceSnapshot {
  managementIntent: string; // ManagementIntent, e.g. 'CUT_LOSSES' -- stored as a plain string, not the union type, so this record's shape never depends on managementIntent.ts's type changing
  label: string;
  primaryReason: string;
  reasons: string[];
  confidence: number; // recommendation.confidence, 0-100
  winnerScore: number | null;
  runnerUpIntent: string | null;
  runnerUpScore: number | null;
  margin: number | null;
  confidenceTier: string | null;
}

// ---------------------------------------------------------------------------
// Decision Review -- the canonical record
// ---------------------------------------------------------------------------
export interface DecisionReview {
  id: string; // stable review id, generated once at creation, never reused
  positionId: string; // Position.key
  symbol: string;
  strategy: string;

  recommendedAt: string; // ISO -- when the snapshotted recommendation was computed
  evidence: DecisionReviewEvidenceSnapshot; // frozen at creation, see doc above

  traderAction: TraderAction | null;
  traderActionAt: string | null;

  outcomeStatus: DecisionOutcomeStatus;
  realizedPnl: number | null;

  notes: string;

  createdAt: string;
  updatedAt: string;
}

// Keyed by DecisionReview.id -- same "fetch the whole store, key by a stable
// id" shape this codebase already uses for position-intent and
// position-snapshots (see app/api/position-intent/route.ts).
export type DecisionReviewStore = Record<string, DecisionReview>;

// Decision History view filters (ticket #6). ALL is the unfiltered view.
// PI-0008D adds NEEDS_FOLLOW_UP -- a reminder-only filter, see
// reviewsNeedingFollowUp() in decisionReview.ts.
export type DecisionHistoryFilter =
  | 'ALL'
  | 'PENDING'
  | 'FAVORABLE'
  | 'UNFAVORABLE'
  | 'FOLLOWED'
  | 'NOT_FOLLOWED'
  | 'NEEDS_FOLLOW_UP';

export const DECISION_HISTORY_FILTER_LABEL: Record<DecisionHistoryFilter, string> = {
  ALL: 'All',
  PENDING: 'Pending',
  FAVORABLE: 'Favorable',
  UNFAVORABLE: 'Unfavorable',
  FOLLOWED: 'Followed',
  NOT_FOLLOWED: 'Did Not Follow',
  NEEDS_FOLLOW_UP: 'Needs Follow-Up',
};
