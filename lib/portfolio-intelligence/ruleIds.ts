// lib/portfolio-intelligence/ruleIds.ts
//
// PI-0002: stable rule IDs. Every PortfolioObjective, from any producer
// (the portfolio-level evaluatePortfolioObjectives batch evaluator, or the
// per-position evaluatePositionObjective consolidated from TE-0006B), gets
// its ruleId from this single mapping. Deliberately a pure function of
// `type` -- not a proliferation of one ID per fine-grained trigger
// condition. Finer distinctions (e.g. "roll-soon" vs "place-gtc" vs "watch",
// all folded into MANAGE_POSITION) live in the objective's title/rationale/
// rulesTriggered, not in a separate rule ID. Future consumers (Decision
// History, Daily Briefing, Analytics, Autopilot, AI Advisor) can rely on
// these ten IDs being exhaustive and stable.

import type { PortfolioObjectiveType } from './types';

export type PortfolioObjectiveRuleId =
  | 'OBJ-CLOSE-FOR-PROFIT'
  | 'OBJ-MANAGE-21-DTE'
  | 'OBJ-REVIEW-THREATENED-POSITION'
  | 'OBJ-ROLL-POSITION'
  | 'OBJ-DEPLOY-IDLE-CASH'
  | 'OBJ-INCREASE-INCOME'
  | 'OBJ-REDUCE-CONCENTRATION'
  | 'OBJ-PRESERVE-BUYING-POWER'
  | 'OBJ-REVIEW-PENDING-ORDER'
  | 'OBJ-WAIT';

export const OBJECTIVE_RULE_ID: Record<PortfolioObjectiveType, PortfolioObjectiveRuleId> = {
  CLOSE_FOR_PROFIT: 'OBJ-CLOSE-FOR-PROFIT',
  MANAGE_POSITION: 'OBJ-MANAGE-21-DTE',
  REVIEW_THREATENED_POSITION: 'OBJ-REVIEW-THREATENED-POSITION',
  ROLL_POSITION: 'OBJ-ROLL-POSITION',
  DEPLOY_IDLE_CASH: 'OBJ-DEPLOY-IDLE-CASH',
  INCREASE_INCOME: 'OBJ-INCREASE-INCOME',
  REDUCE_CONCENTRATION: 'OBJ-REDUCE-CONCENTRATION',
  PRESERVE_BUYING_POWER: 'OBJ-PRESERVE-BUYING-POWER',
  REVIEW_PENDING_ORDER: 'OBJ-REVIEW-PENDING-ORDER',
  WAIT: 'OBJ-WAIT',
};
