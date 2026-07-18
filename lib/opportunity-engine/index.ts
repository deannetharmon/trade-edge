// lib/opportunity-engine/index.ts
//
// OE-0001: Opportunity Engine Foundation public barrel. See
// docs/design/OE-0001-Opportunity-Engine-Foundation.md.

export { evaluateOpportunityCandidate } from './evaluateOpportunityCandidate';
export type {
  EvaluateOpportunityCandidateArgs,
  EvaluateOpportunityCandidateResult,
} from './evaluateOpportunityCandidate';

export { rankOpportunityCandidates } from './rankOpportunityCandidates';

export {
  decisionAnalysisToOpportunityCandidate,
  decisionAnalysesToOpportunityCandidates,
} from './adapters/decisionAnalysisAdapter';
export type {
  DecisionAnalysisAdapterOptions,
  DecisionAnalysisBatchAdapterResult,
} from './adapters/decisionAnalysisAdapter';

export { OE_RULE_IDS } from './ruleIds';
export type { OpportunityRuleId } from './ruleIds';

export type {
  OpportunityCandidate,
  OpportunityCandidateSource,
  OpportunityContext,
  OpportunityDisposition,
  OpportunityRecommendation,
} from './types';
