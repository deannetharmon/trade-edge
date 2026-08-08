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

// CSP-WORKFLOW-RECONCILE-0002 — a cash-secured put is mechanically a single
// short put: the position is threatened by the same downside evidence as a
// BPS's short leg, but it is a genuinely distinct strategy (no long leg, no
// defined max loss, different capital/assignment mechanics), so it gets its
// own thesis shape rather than being reclassified as a BPS. Kept separate
// from DirectionalSpreadThesis (whose `strategy` union is deliberately
// closed to 'BPS' | 'BCS') so a CSP thesis can never be silently accepted
// wherever a spread thesis is expected.
export interface CspThesis extends StrategyThesisBase {
  strategy: 'CSP';
  threatenedSide: 'DOWNSIDE';
}

export type StrategyThesis = DirectionalSpreadThesis | IronCondorThesis | CspThesis;
