import type { DecisionTrace, ModelIdentity } from '../decision/types';
import type { PointInTimeMarketData } from '../market-intelligence/types';

export interface ReplayOptionLegInput {
  symbol: string;
  expiration: string;
  strike: number;
  optionType: 'CALL' | 'PUT';
  bid?: number;
  ask?: number;
  delta?: number;
  impliedVolatility?: number;
  openInterest?: number;
}

export interface ReplaySnapshot extends ModelIdentity {
  snapshotId: string;
  capturedAt: string;
  marketData: PointInTimeMarketData;
  eventKnowledge: readonly { eventType: string; effectiveAt: string; knownAt: string; source: string }[];
  optionLegs: readonly ReplayOptionLegInput[];
  ivRank?: number;
  decisionTrace?: DecisionTrace;
}

export interface OutcomeLabels {
  observedThrough: string;
  shortStrikeTouched?: boolean;
  maximumAdverseExcursion?: number;
  thesisBroken?: boolean;
  terminalContained?: boolean;
  firstBreakSide?: 'UPPER' | 'LOWER';
  realizedPnl?: number;
}
