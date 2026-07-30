import type { DecisionHorizon } from '../../market-intelligence/horizon';
import type { MarketStateEvidence } from '../../market-intelligence/types';
import type { SetupClassificationResult } from '../setup-classifier';
import type { DirectionalSpreadThesis } from './types';

export function evaluateBcsThesis(
  horizon: DecisionHorizon,
  marketState: MarketStateEvidence,
  setup: SetupClassificationResult,
): DirectionalSpreadThesis {
  const supportingEvidence = [...marketState.supportingEvidence];
  const contradictingEvidence = [...marketState.contradictingEvidence];

  let evidenceState: DirectionalSpreadThesis['evidenceState'] = 'INSUFFICIENT';
  if (setup.setup === 'NO_TRADE_CHAOTIC') {
    evidenceState = 'CONTRADICTORY';
    contradictingEvidence.push('Chaotic market state does not establish controlled upside risk.');
  } else if (marketState.direction === 'BULLISH') {
    evidenceState = 'CONTRADICTORY';
    contradictingEvidence.push('Available market-state evidence threatens the upside side of a BCS.');
  } else if (marketState.direction === 'BEARISH' || setup.setup === 'RANGE') {
    evidenceState = 'SUPPORTIVE';
    supportingEvidence.push('Foundation evidence is compatible with controlled upside behavior.');
  }

  return {
    strategy: 'BCS',
    horizon,
    threatenedSide: 'UPSIDE',
    marketState,
    setup,
    supportingEvidence,
    contradictingEvidence,
    evidenceState,
  };
}
