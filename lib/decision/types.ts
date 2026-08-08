import type { DecisionHorizon } from '../market-intelligence/horizon';

export type Strategy = 'BPS' | 'BCS' | 'IC';
export type EligibilityStatus = 'ELIGIBLE' | 'INELIGIBLE' | 'INSUFFICIENT_EVIDENCE';
export type SetupClassification = 'BULLISH_CONTINUATION' | 'BEARISH_CONTINUATION' | 'BULLISH_REVERSAL' | 'BEARISH_REVERSAL' | 'RANGE' | 'TRANSITION' | 'CHAOTIC';

export interface ModelIdentity {
  modelVersion: string;
  configVersion: string;
}

export interface EventRiskEvidence {
  hasKnownBinaryEvent: boolean;
  eventType?: string;
  effectiveAt?: string;
  knownAt?: string;
  source?: string;
}

export interface EligibilityDecision extends ModelIdentity {
  strategy: Strategy;
  horizon: DecisionHorizon;
  status: EligibilityStatus;
  reasonCodes: readonly string[];
}

export interface DecisionTrace extends ModelIdentity {
  symbol: string;
  evaluatedAt: string;
  horizon: DecisionHorizon;
  setup: SetupClassification;
  eventRisk: EventRiskEvidence;
  eligibility: readonly EligibilityDecision[];
}
