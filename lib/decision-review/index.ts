// lib/decision-review/index.ts
//
// PI-0008C: Decision Outcome Tracking V1. See decisionReview.ts and types.ts
// module docs -- this is deliberately separate from lib/decision-engine and
// lib/portfolio-intelligence (records outcomes, never influences them).

export {
  createDecisionReviewId,
  buildEvidenceSnapshot,
  createDecisionReview,
  updateDecisionReview,
  parseDecisionReviewStore,
  upsertDecisionReview,
  latestReviewForPosition,
  allReviewsByRecency,
  filterDecisionReviews,
  reviewsNeedingFollowUp,
  isReviewNeedingFollowUp,
} from './decisionReview';
export type { CreateDecisionReviewInput, DecisionReviewPatch, PositionIdSet } from './decisionReview';

export {
  TRADER_ACTIONS,
  TRADER_ACTION_LABEL,
  DECISION_OUTCOME_STATUSES,
  DECISION_OUTCOME_STATUS_LABEL,
  DECISION_HISTORY_FILTER_LABEL,
} from './types';
export type {
  TraderAction,
  DecisionOutcomeStatus,
  DecisionReviewEvidenceSnapshot,
  DecisionReview,
  DecisionReviewStore,
  DecisionHistoryFilter,
} from './types';
