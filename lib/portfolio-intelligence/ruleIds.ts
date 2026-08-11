// lib/portfolio-intelligence/ruleIds.ts
//
// PI-0003: expanded from PI-0002's one-rule-ID-per-objective-type scheme.
// Rule IDs now describe WHY an objective fired; Objective Types describe
// WHAT kind of objective it is. Multiple rule IDs can map to the same
// objective type (e.g. OBJ-ASSIGNMENT-RISK, OBJ-EARNINGS-RISK, and
// OBJ-CLOSE-LOSER are all REVIEW_THREATENED_POSITION). Each objective
// producer sets its own ruleId explicitly per triggering branch -- there is
// no longer a single type->id lookup, since that was exactly the "not
// expressive enough" problem PI-0003 called out.
//
// RULE_ID_OBJECTIVE_TYPE is the reverse mapping (rule ID -> the one type it
// belongs to), used for validation/tests and by any consumer that needs to
// know an objective's type from its rule ID alone. The
// PortfolioObjectiveRuleId type itself lives in types.ts (it's a field on
// PortfolioObjective), imported here rather than redeclared.

import type { PortfolioObjectiveRuleId, PortfolioObjectiveType } from './types';

export const RULE_ID_OBJECTIVE_TYPE: Record<PortfolioObjectiveRuleId, PortfolioObjectiveType> = {
  'OBJ-CLOSE-FOR-PROFIT': 'CLOSE_FOR_PROFIT',
  'OBJ-MANAGE-21-DTE': 'MANAGE_POSITION',
  'OBJ-PLACE-GTC': 'MANAGE_POSITION',
  'OBJ-LET-EXPIRE': 'MANAGE_POSITION',
  'OBJ-WATCH-POSITION': 'MANAGE_POSITION',
  'OBJ-VERIFY-PRICING': 'MANAGE_POSITION',
  'OBJ-ROLL-POSITION': 'ROLL_POSITION',
  'OBJ-ASSIGNMENT-RISK': 'REVIEW_THREATENED_POSITION',
  'OBJ-EARNINGS-RISK': 'REVIEW_THREATENED_POSITION',
  'OBJ-CLOSE-LOSER': 'REVIEW_THREATENED_POSITION',
  'OBJ-DEPLOY-IDLE-CASH': 'DEPLOY_IDLE_CASH',
  'OBJ-INCREASE-INCOME': 'INCREASE_INCOME',
  'OBJ-REDUCE-CONCENTRATION': 'REDUCE_CONCENTRATION',
  'OBJ-PRESERVE-BUYING-POWER': 'PRESERVE_BUYING_POWER',
  'OBJ-REVIEW-PENDING-ORDER': 'REVIEW_PENDING_ORDER',
  'OBJ-WAIT': 'WAIT',
};

export function isRuleIdConsistentWithType(ruleId: PortfolioObjectiveRuleId, type: PortfolioObjectiveType): boolean {
  return RULE_ID_OBJECTIVE_TYPE[ruleId] === type;
}
