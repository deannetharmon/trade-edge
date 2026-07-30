import type { DecisionHorizon } from '../../market-intelligence/horizon';
import type { MarketStateEvidence } from '../../market-intelligence/types';
import type { SetupClassificationResult } from '../setup-classifier';
import type { DirectionalSpreadThesis } from './types';

export function evaluateBpsThesis(
  horizon: DecisionHorizon,
  marketState: MarketStateEvidence,
  setup: SetupClassificationResult,
): DirectionalSpreadThesis {
  const supportingEvidence = [...marketState.supportingEvidence];
  const contradictingEvidence = [...marketState.contradictingEvidence];

  let evidenceState: DirectionalSpreadThesis['evidenceState'] = 'INSUFFICIENT';
  if (setup.setup === 'NO_TRADE_CHAOTIC') {
    evidenceState = 'CONTRADICTORY';
    contradictingEvidence.push('Chaotic market state does not establish controlled downside risk.');
  } else if (marketState.direction === 'BEARISH') {
    evidenceState = 'CONTRADICTORY';
    contradictingEvidence.push('Available market-state evidence threatens the downside side of a BPS.');
  } else if (marketState.direction === 'BULLISH' || setup.setup === 'RANGE') {
    evidenceState = 'SUPPORTIVE';
    supportingEvidence.push('Foundation evidence is compatible with controlled downside behavior.');
  }

  return {
    strategy: 'BPS',
    horizon,
    threatenedSide: 'DOWNSIDE',
    marketState,
    setup,
    supportingEvidence,
    contradictingEvidence,
    evidenceState,
  };
}
