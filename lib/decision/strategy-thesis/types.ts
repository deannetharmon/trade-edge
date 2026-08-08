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

// TE-0007C-RECONCILE-0001 — a Covered Call starts from a fundamentally
// different position than every other strategy here: the investor already
// owns the shares before the call is ever considered. CC's foundation
// question is not "is the underlying threatened" (there is no new capital
// at risk from writing the call itself) but "is selling upside against
// these already-owned shares consistent with current evidence, given the
// risk the shares get called away." That is genuinely CC-specific — not a
// BPS inversion, not a BCS relabel (BCS's question is about a new
// undefined-risk short-call position; CC's is about assignment risk on
// stock already held) — so it gets its own shape, keyed on call-away risk
// rather than a threatened side.
export interface CcThesis extends StrategyThesisBase {
  strategy: 'CC';
  /** Foundation-only, categorical read of assignment/call-away risk given
   * current market-state evidence -- never a calibrated probability.
   * 'UNKNOWN' when the setup evidence itself is chaotic or insufficient. */
  callAwayRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';
}

export type StrategyThesis = DirectionalSpreadThesis | IronCondorThesis | CspThesis | CcThesis;
