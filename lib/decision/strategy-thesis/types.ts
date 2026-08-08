import type { Strategy } from '../types';
import type { DecisionHorizon } from '../../market-intelligence/horizon';
import type { MarketStateEvidence } from '../../market-intelligence/types';
import type { SetupClassificationResult } from '../setup-classifier';

export interface StrategyThesisBase {
  strategy: Strategy;
  horizon: DecisionHorizon;
  marketState: MarketStateEvidence;
  setup: SetupClassificationResult;
  supportingEvidence: readonly string[];
  contradictingEvidence: readonly string[];
  /** Foundation semantic only; never probability or production confidence. */
  evidenceState: 'SUPPORTIVE' | 'CONTRADICTORY' | 'INSUFFICIENT';
}

export interface DirectionalSpreadThesis extends StrategyThesisBase {
  strategy: 'BPS' | 'BCS';
  threatenedSide: 'DOWNSIDE' | 'UPSIDE';
}

export interface IronCondorThesis extends StrategyThesisBase {
  strategy: 'IC';
  upperContainment: 'SUPPORTIVE' | 'WEAK' | 'INSUFFICIENT';
  lowerContainment: 'SUPPORTIVE' | 'WEAK' | 'INSUFFICIENT';
  weakerSide: 'UPPER' | 'LOWER' | 'BALANCED' | 'UNKNOWN';
}

export type StrategyThesis = DirectionalSpreadThesis | IronCondorThesis;
