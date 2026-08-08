// lib/decision/strategy-thesis/cc.ts
// TE-0007C-RECONCILE-0001 — Covered Call foundation thesis.
//
// A Covered Call is not a new bet against the underlying; the investor
// already owns the shares. Writing the call sells the shares' upside for
// premium, so the foundation question is specifically: given current market
// evidence, is selling that upside consistent with the risk of having the
// shares called away? This is deliberately its own function, not a call
// into evaluateBcsThesis (which answers a different question -- whether a
// NEW undefined-risk short-call position is appropriate -- and not an
// inversion of evaluateBpsThesis (CC has no downside-threatened leg at
// all; the shares are already held regardless of this thesis's outcome).
//
// Domain read (mirrors the same directional polarity as BCS only because
// both concern selling calls, not because one is derived from the other):
// strong bullish evidence raises call-away risk and contradicts the "sell
// the upside" thesis -- the investor would be giving away the very
// upside the evidence says is likely. Bearish or range evidence lowers
// call-away risk and supports writing calls for premium income against
// shares that aren't expected to run. A chaotic setup provides no reliable
// basis for either read.
import type { DecisionHorizon } from '../../market-intelligence/horizon';
import type { MarketStateEvidence } from '../../market-intelligence/types';
import type { SetupClassificationResult } from '../setup-classifier';
import type { CcThesis } from './types';

export function evaluateCcThesis(
  horizon: DecisionHorizon,
  marketState: MarketStateEvidence,
  setup: SetupClassificationResult,
): CcThesis {
  const supportingEvidence = [...marketState.supportingEvidence];
  const contradictingEvidence = [...marketState.contradictingEvidence];

  let evidenceState: CcThesis['evidenceState'] = 'INSUFFICIENT';
  let callAwayRisk: CcThesis['callAwayRisk'] = 'UNKNOWN';

  if (setup.setup === 'NO_TRADE_CHAOTIC') {
    evidenceState = 'CONTRADICTORY';
    callAwayRisk = 'UNKNOWN';
    contradictingEvidence.push('Chaotic market state does not provide a reliable basis for writing calls against these shares.');
  } else if (marketState.direction === 'BULLISH') {
    evidenceState = 'CONTRADICTORY';
    callAwayRisk = 'HIGH';
    contradictingEvidence.push('Available market-state evidence favors continued upside, raising the risk these shares are called away before that upside is realized.');
  } else if (marketState.direction === 'BEARISH' || setup.setup === 'RANGE') {
    evidenceState = 'SUPPORTIVE';
    callAwayRisk = 'LOW';
    supportingEvidence.push('Foundation evidence does not favor continued upside, making call-away risk low and premium collection consistent with holding through this evidence.');
  }

  return {
    strategy: 'CC',
    horizon,
    callAwayRisk,
    marketState,
    setup,
    supportingEvidence,
    contradictingEvidence,
    evidenceState,
  };
}
