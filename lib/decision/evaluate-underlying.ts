import { getDecisionHorizon } from '../market-intelligence/horizon';
import { buildMarketStateEvidence } from '../market-intelligence/market-state';
import type { PointInTimeMarketData } from '../market-intelligence/types';
import { evaluateEventRisk, type KnownMarketEvent } from './event-risk';
import { classifySetup } from './setup-classifier';
import { evaluateBpsThesis } from './strategy-thesis/bps';
import { evaluateBcsThesis } from './strategy-thesis/bcs';
import { evaluateIcThesis } from './strategy-thesis/ic';
import type { StrategyThesis } from './strategy-thesis/types';
import { evaluateStrategyEligibility } from './strategy-eligibility';
import type { DecisionTrace, EligibilityDecision, ModelIdentity } from './types';

export interface EvaluateUnderlyingInput extends ModelIdentity {
  symbol: string;
  evaluatedAt: string;
  dte: number;
  marketData: PointInTimeMarketData;
  events: readonly KnownMarketEvent[];
}

export interface UnderlyingDecisionFoundation {
  trace: DecisionTrace;
  theses: readonly StrategyThesis[];
  eligibility: readonly EligibilityDecision[];
}

export function evaluateUnderlyingFoundation(input: EvaluateUnderlyingInput): UnderlyingDecisionFoundation {
  const horizon = getDecisionHorizon(input.dte);
  const marketState = buildMarketStateEvidence(input.marketData.bars);
  const setup = classifySetup(marketState);
  const horizonEnd = new Date(Date.parse(input.evaluatedAt) + input.dte * 86_400_000).toISOString();
  const eventRisk = evaluateEventRisk({ evaluatedAt: input.evaluatedAt, horizonEnd, events: input.events });

  const theses: StrategyThesis[] = [
    evaluateBpsThesis(horizon, marketState, setup),
    evaluateBcsThesis(horizon, marketState, setup),
    evaluateIcThesis(horizon, marketState, setup),
  ];

  const eligibility = theses.map(thesis => evaluateStrategyEligibility({
    thesis,
    horizon,
    eventRisk,
    modelVersion: input.modelVersion,
    configVersion: input.configVersion,
  }));

  return {
    theses,
    eligibility,
    trace: {
      symbol: input.symbol,
      evaluatedAt: input.evaluatedAt,
      horizon,
      setup: setup.setup === 'TRANSITION_UNCERTAIN' ? 'TRANSITION'
        : setup.setup === 'NO_TRADE_CHAOTIC' ? 'CHAOTIC'
        : setup.setup,
      eventRisk,
      eligibility,
      modelVersion: input.modelVersion,
      configVersion: input.configVersion,
    },
  };
}
