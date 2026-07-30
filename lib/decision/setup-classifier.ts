import type { MarketStateEvidence } from '../market-intelligence/types';

export type SetupClassification =
  | 'BULLISH_CONTINUATION'
  | 'BEARISH_CONTINUATION'
  | 'BULLISH_REVERSAL'
  | 'BEARISH_REVERSAL'
  | 'RANGE'
  | 'TRANSITION_UNCERTAIN'
  | 'NO_TRADE_CHAOTIC';

export interface SetupClassificationResult {
  setup: SetupClassification;
  reasons: readonly string[];
}

/**
 * Foundation classifier only. This preserves the approved setup taxonomy and
 * deterministic decision trace without claiming empirically calibrated trading
 * thresholds. Strategy thesis/eligibility remains downstream.
 */
export function classifySetup(evidence: MarketStateEvidence): SetupClassificationResult {
  if (evidence.regime === 'CHAOTIC') {
    return { setup: 'NO_TRADE_CHAOTIC', reasons: ['Market-state regime is chaotic.'] };
  }

  if (evidence.regime === 'RANGE') {
    return { setup: 'RANGE', reasons: ['Market-state regime is range-bound.'] };
  }

  if (evidence.regime === 'TREND') {
    if (evidence.direction === 'BULLISH') {
      return {
        setup: evidence.maturity === 'DETERIORATING' ? 'BULLISH_REVERSAL' : 'BULLISH_CONTINUATION',
        reasons: [`Bullish trend evidence with ${evidence.maturity.toLowerCase()} maturity.`],
      };
    }
    if (evidence.direction === 'BEARISH') {
      return {
        setup: evidence.maturity === 'DETERIORATING' ? 'BEARISH_REVERSAL' : 'BEARISH_CONTINUATION',
        reasons: [`Bearish trend evidence with ${evidence.maturity.toLowerCase()} maturity.`],
      };
    }
  }

  return {
    setup: 'TRANSITION_UNCERTAIN',
    reasons: ['Market-state evidence does not establish a stable continuation, reversal, or range setup.'],
  };
}
