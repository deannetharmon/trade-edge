// lib/discovery/qv/technical.ts

// LEAPS-QV-0001 Gate 3 (Section 45.8, assumption A5) -- Technical State.
//
// RSI alone never decides a state. The state is a confluence of weekly RSI direction, price against SMA50 and SMA200, the
// SMA200 trend and 126-day relative strength versus SPY. OVERSOLD is a description of how depressed the stock is, not a
// buy signal: it is never enough to move a candidate past WATCH.
//
// Monthly RSI and the distance from the 52-week high are supporting evidence: carried on the reason when they are VALID,
// never required, never decisive. Everything in the decision comes from the required inputs, and a missing required input
// makes the domain NOT_EVALUABLE -- a stock is never classified from partial evidence.

import type { MetricSet } from '../metrics';
import type { ReasonCode } from '../reasonCodes';
import { blockingIds, metricsOf, readNumber } from './inputs';
import type { ComponentTrace } from './inputs';
import { QV_V1_0_POLICY } from './policy';
import { QV_REASON, qvReason } from './reasons';

export type TechnicalState = 'DECLINING' | 'OVERSOLD' | 'STABILIZING' | 'RECOVERING';
export type TechnicalResult = TechnicalState | 'NOT_EVALUABLE';

export interface TechnicalSignals {
  readonly weeklyRsiRising: boolean;
  readonly weeklyRsiNotFalling: boolean;
  readonly priceAboveSma50: boolean;
  readonly priceBelowSma50: boolean;
  readonly belowFallingSma200: boolean;
  readonly sma200NotFalling: boolean;
  readonly relativeStrengthNegative: boolean;
  readonly relativeStrengthNonNegative: boolean;
  readonly weeklyRsiDepressed: boolean;
  readonly otherBearishCount: number;
}

export interface TechnicalAssessment extends ComponentTrace {
  readonly result: TechnicalResult;
  readonly signals: TechnicalSignals | null;
}

const P = QV_V1_0_POLICY.technical;
const IN = QV_V1_0_POLICY.inputs.technical;

const STATE_CODE: Record<TechnicalState, string> = {
  DECLINING: QV_REASON.TECHNICAL_DECLINING,
  OVERSOLD: QV_REASON.TECHNICAL_OVERSOLD,
  STABILIZING: QV_REASON.TECHNICAL_STABILIZING,
  RECOVERING: QV_REASON.TECHNICAL_RECOVERING,
};

export function technicalStateOf(signals: TechnicalSignals): TechnicalState {
  // Positive inflection: RSI rising, price back above its SMA50, and the longer picture is not still deteriorating.
  if (signals.weeklyRsiRising && signals.priceAboveSma50 && (signals.sma200NotFalling || signals.relativeStrengthNonNegative)) return 'RECOVERING';
  // Deterioration has stopped: weekly RSI is no longer falling. Price need not be above SMA50.
  if (signals.weeklyRsiNotFalling) return 'STABILIZING';
  // RSI is still falling. Depressed without any other bearish confirmation is OVERSOLD; every other case is DECLINING.
  if (signals.otherBearishCount < P.decliningMinOtherBearish && signals.weeklyRsiDepressed) return 'OVERSOLD';
  return 'DECLINING';
}

export function assessTechnical(set: MetricSet): TechnicalAssessment {
  const weeklyRsi = readNumber(set, IN.weeklyRsi);
  const rsiChange = readNumber(set, IN.weeklyRsiChange);
  const price = readNumber(set, IN.price);
  const sma50 = readNumber(set, IN.sma50);
  const sma200 = readNumber(set, IN.sma200);
  const sma200Trend = readNumber(set, IN.sma200Trend);
  const relative = readNumber(set, IN.relativeStrength);
  const monthlyRsi = readNumber(set, IN.monthlyRsi);
  const distance = readNumber(set, IN.distanceFrom52wHigh);

  const required = [IN.weeklyRsi, IN.weeklyRsiChange, IN.price, IN.sma50, IN.sma200, IN.sma200Trend, IN.relativeStrength];
  const blocking = blockingIds([weeklyRsi, rsiChange, price, sma50, sma200, sma200Trend, relative]);
  if (blocking.length > 0) {
    return { result: 'NOT_EVALUABLE', signals: null, reasons: [], requiredMetricIds: required, blockingMetricIds: blocking };
  }

  const change = rsiChange.value as number;
  const last = price.value as number;
  const trend = sma200Trend.value as number;
  const relativeReturn = relative.value as number;
  const belowSma50 = last < (sma50.value as number);
  const belowFallingSma200 = last < (sma200.value as number) && trend < 0;
  const relativeStrengthNegative = relativeReturn < 0;
  const signals: TechnicalSignals = {
    weeklyRsiRising: change > 0,
    weeklyRsiNotFalling: change >= 0,
    priceAboveSma50: last > (sma50.value as number),
    priceBelowSma50: belowSma50,
    belowFallingSma200,
    sma200NotFalling: trend >= 0,
    relativeStrengthNegative,
    relativeStrengthNonNegative: !relativeStrengthNegative,
    weeklyRsiDepressed: (weeklyRsi.value as number) <= P.weeklyRsiDepressedMax,
    otherBearishCount: [belowSma50, belowFallingSma200, relativeStrengthNegative].filter(Boolean).length,
  };
  const state = technicalStateOf(signals);

  const reasons: ReasonCode[] = [
    qvReason(
      STATE_CODE[state],
      state === 'RECOVERING' || state === 'STABILIZING' ? 'SUPPORTS' : 'CONCERN',
      metricsOf([weeklyRsi, rsiChange, price, sma50, sma200, sma200Trend, relative, monthlyRsi.value === null ? null : monthlyRsi, distance.value === null ? null : distance]),
      {
        state,
        weeklyRsiRising: signals.weeklyRsiRising,
        priceAboveSma50: signals.priceAboveSma50,
        sma200NotFalling: signals.sma200NotFalling,
        relativeStrengthNonNegative: signals.relativeStrengthNonNegative,
        weeklyRsiDepressed: signals.weeklyRsiDepressed,
        otherBearishCount: signals.otherBearishCount,
        weeklyRsiDepressedMax: P.weeklyRsiDepressedMax,
      },
    ),
  ];

  return { result: state, signals, reasons, requiredMetricIds: required, blockingMetricIds: [] };
}
