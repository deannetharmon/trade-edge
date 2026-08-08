// lib/decision/strategy-thesis/csp.ts
// CSP-WORKFLOW-RECONCILE-0002 — CSP-specific foundation thesis.
//
// A cash-secured put shares BPS's downside-threatened directional profile
// (both are net-short-put exposures), but this is deliberately its own
// function rather than a call-through to evaluateBpsThesis: BPS is a
// defined-risk credit spread with a purchased long put beneath the short
// strike, while CSP carries undefined downside risk down to zero with no
// long leg and is secured by cash, not a spread width. Those are different
// enough products that their theses must be independently reviewable and
// independently correctable without one accidentally dragging the other's
// language or thresholds along.
import type { DecisionHorizon } from '../../market-intelligence/horizon';
import type { MarketStateEvidence } from '../../market-intelligence/types';
import type { SetupClassificationResult } from '../setup-classifier';
import type { CspThesis } from './types';

export function evaluateCspThesis(
  horizon: DecisionHorizon,
  marketState: MarketStateEvidence,
  setup: SetupClassificationResult,
): CspThesis {
  const supportingEvidence = [...marketState.supportingEvidence];
  const contradictingEvidence = [...marketState.contradictingEvidence];

  let evidenceState: CspThesis['evidenceState'] = 'INSUFFICIENT';
  if (setup.setup === 'NO_TRADE_CHAOTIC') {
    evidenceState = 'CONTRADICTORY';
    contradictingEvidence.push('Chaotic market state does not establish controlled downside risk for a cash-secured put.');
  } else if (marketState.direction === 'BEARISH') {
    evidenceState = 'CONTRADICTORY';
    contradictingEvidence.push('Available market-state evidence threatens the undefined downside of a cash-secured put.');
  } else if (marketState.direction === 'BULLISH' || setup.setup === 'RANGE') {
    evidenceState = 'SUPPORTIVE';
    supportingEvidence.push('Foundation evidence is compatible with accepting assignment risk on this underlying.');
  }

  return {
    strategy: 'CSP',
    horizon,
    threatenedSide: 'DOWNSIDE',
    marketState,
    setup,
    supportingEvidence,
    contradictingEvidence,
    evidenceState,
  };
}
