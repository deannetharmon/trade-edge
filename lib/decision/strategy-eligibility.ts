import type { DecisionHorizon } from '../market-intelligence/horizon';
import type { EligibilityDecision, EventRiskEvidence, ModelIdentity } from './types';
import type { StrategyThesis } from './strategy-thesis/types';

export interface EvaluateEligibilityInput extends ModelIdentity {
  horizon: DecisionHorizon;
  thesis: StrategyThesis;
  eventRisk: EventRiskEvidence;
}

/** Foundation gate. Contract economics are intentionally absent. */
export function evaluateStrategyEligibility(input: EvaluateEligibilityInput): EligibilityDecision {
  const reasonCodes: string[] = [];
  let status: EligibilityDecision['status'];

  if (input.thesis.evidenceState === 'INSUFFICIENT') {
    status = 'INSUFFICIENT_EVIDENCE';
    reasonCodes.push('THESIS_EVIDENCE_INSUFFICIENT');
  } else if (input.thesis.evidenceState === 'CONTRADICTORY') {
    status = 'INELIGIBLE';
    reasonCodes.push('THESIS_CONTRADICTORY');
  } else if (input.eventRisk.hasKnownBinaryEvent) {
    status = 'INELIGIBLE';
    reasonCodes.push('KNOWN_BINARY_EVENT_IN_HORIZON');
  } else {
    status = 'ELIGIBLE';
    reasonCodes.push('FOUNDATION_THESIS_SUPPORTIVE');
  }

  return {
    strategy: input.thesis.strategy,
    horizon: input.horizon,
    status,
    reasonCodes,
    modelVersion: input.modelVersion,
    configVersion: input.configVersion,
  };
}
