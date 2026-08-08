import type { DecisionHorizon } from '../../market-intelligence/horizon';
import type { MarketStateEvidence } from '../../market-intelligence/types';
import type { SetupClassificationResult } from '../setup-classifier';
import type { IronCondorThesis } from './types';

export function evaluateIcThesis(
  horizon: DecisionHorizon,
  marketState: MarketStateEvidence,
  setup: SetupClassificationResult,
): IronCondorThesis {
  const supportingEvidence = [...marketState.supportingEvidence];
  const contradictingEvidence = [...marketState.contradictingEvidence];

  let upperContainment: IronCondorThesis['upperContainment'] = 'INSUFFICIENT';
  let lowerContainment: IronCondorThesis['lowerContainment'] = 'INSUFFICIENT';
  let weakerSide: IronCondorThesis['weakerSide'] = 'UNKNOWN';
  let evidenceState: IronCondorThesis['evidenceState'] = 'INSUFFICIENT';

  if (setup.setup === 'RANGE') {
    upperContainment = 'SUPPORTIVE';
    lowerContainment = 'SUPPORTIVE';
    weakerSide = 'BALANCED';
    evidenceState = 'SUPPORTIVE';
    supportingEvidence.push('Range classification provides foundation evidence for two-sided containment.');
  } else if (setup.setup === 'NO_TRADE_CHAOTIC') {
    upperContainment = 'WEAK';
    lowerContainment = 'WEAK';
    weakerSide = 'BALANCED';
    evidenceState = 'CONTRADICTORY';
    contradictingEvidence.push('Chaotic market state conflicts with stable two-sided containment.');
  } else if (marketState.direction === 'BULLISH') {
    upperContainment = 'WEAK';
    weakerSide = 'UPPER';
    evidenceState = 'CONTRADICTORY';
    contradictingEvidence.push('Directional bullish evidence weakens upper containment.');
  } else if (marketState.direction === 'BEARISH') {
    lowerContainment = 'WEAK';
    weakerSide = 'LOWER';
    evidenceState = 'CONTRADICTORY';
    contradictingEvidence.push('Directional bearish evidence weakens lower containment.');
  }

  return {
    strategy: 'IC',
    horizon,
    marketState,
    setup,
    supportingEvidence,
    contradictingEvidence,
    evidenceState,
    upperContainment,
    lowerContainment,
    weakerSide,
  };
}
