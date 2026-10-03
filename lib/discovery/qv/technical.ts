// lib/discovery/qv/technical.ts

// LEAPS-QV-0001 Gate 3 (Section 45.8, assumption A5) -- Technical State.
//
// RSI alone never decides a state, and evidence that is merely present does not participate unless the rule uses it.
// The two constructive states need DIRECTION evidence (Section 45.8):
//   STABILIZING  weekly RSI slope not negative AND 4-week RSI change non-negative AND relative-strength deterioration no
//                longer accelerating. Price need not exceed SMA50.
//   RECOVERING   weekly RSI slope rising AND 4-week RSI change positive AND improving relationship to SMA50 AND improving
//                relative strength vs SPY.
// A LEVEL is never read as a direction: positive relative strength does not prove improving relative strength, and price
// above SMA50 does not prove an improving relationship to SMA50. The slope, the SMA50-gap change and the relative-strength
// change are separate contract metrics; the normalizer does not produce them yet, so today they are UNAVAILABLE and the
// affected classification FAILS CLOSED (RECOVERING is not established; STABILIZING is not established, so the domain is
// NOT_EVALUABLE unless known adverse evidence already classifies it DECLINING / OVERSOLD). Known adverse evidence stands.
//
// OVERSOLD is a description of how depressed the stock is, not a buy signal: it never moves a candidate past WATCH.
// Monthly RSI and the distance from the 52-week high are supporting evidence only (carried on the reason).

import type { MetricSet } from '../metrics';
import type { ReasonCode } from '../reasonCodes';
import { blockingIds, metricsOf, readNumber } from './inputs';
import type { ComponentTrace, NumericRead } from './inputs';
import { QV_V1_0_POLICY } from './policy';
import { QV_REASON, qvReason } from './reasons';

export type TechnicalState = 'DECLINING' | 'OVERSOLD' | 'STABILIZING' | 'RECOVERING';
export type TechnicalResult = TechnicalState | 'NOT_EVALUABLE';

/** true / false = evidenced; null = the direction evidence is not available (never read as either). */
export type Evidenced = boolean | null;

export interface TechnicalSignals {
  // STABILIZING core
  readonly weeklyRsiSlopeNonNegative: Evidenced;
  readonly rsiChange4wNonNegative: boolean;
  readonly relativeStrengthNotWorsening: Evidenced;
  // RECOVERING additions
  readonly weeklyRsiSlopePositive: Evidenced;
  readonly rsiChange4wPositive: boolean;
  readonly smaGapImproving: Evidenced;
  readonly relativeStrengthImproving: Evidenced;
  // level evidence used to separate DECLINING from OVERSOLD
  readonly weeklyRsiDepressed: boolean;
  readonly priceBelowSma50: boolean;
  readonly belowFallingSma200: boolean;
  readonly relativeStrengthNegative: boolean;
  readonly otherBearishCount: number;
}

export interface TechnicalAssessment extends ComponentTrace {
  readonly result: TechnicalResult;
  readonly signals: TechnicalSignals | null;
  /** Direction metrics that were not VALID (reported even when the state is still established). */
  readonly missingDirectionMetricIds: readonly string[];
}

const P = QV_V1_0_POLICY.technical;
const IN = QV_V1_0_POLICY.inputs.technical;

const STATE_CODE: Record<TechnicalState, string> = {
  DECLINING: QV_REASON.TECHNICAL_DECLINING,
  OVERSOLD: QV_REASON.TECHNICAL_OVERSOLD,
  STABILIZING: QV_REASON.TECHNICAL_STABILIZING,
  RECOVERING: QV_REASON.TECHNICAL_RECOVERING,
};

function allTrue(values: readonly Evidenced[]): boolean {
  return values.every((value) => value === true);
}

/** The state the evidence establishes, or null when it does not establish one (a required direction is unavailable). */
export function technicalStateOf(signals: TechnicalSignals): TechnicalState | null {
  if (allTrue([signals.weeklyRsiSlopePositive, signals.rsiChange4wPositive, signals.smaGapImproving, signals.relativeStrengthImproving])) return 'RECOVERING';
  const core: Evidenced[] = [signals.weeklyRsiSlopeNonNegative, signals.rsiChange4wNonNegative, signals.relativeStrengthNotWorsening];
  if (allTrue(core)) return 'STABILIZING';
  // Stabilization is contradicted by known evidence: DECLINING, or OVERSOLD when depressed with no other bearish confirmation.
  if (core.indexOf(false) >= 0) {
    if (signals.otherBearishCount < P.decliningMinOtherBearish && signals.weeklyRsiDepressed) return 'OVERSOLD';
    return 'DECLINING';
  }
  // Nothing contradicts stabilization, but part of it cannot be evidenced: not established, fail closed.
  return null;
}

const tri = (read: NumericRead, test: (value: number) => boolean): Evidenced => (read.value === null ? null : test(read.value));

export function assessTechnical(set: MetricSet): TechnicalAssessment {
  const weeklyRsi = readNumber(set, IN.weeklyRsi);
  const rsiChange = readNumber(set, IN.weeklyRsiChange);
  const price = readNumber(set, IN.price);
  const sma50 = readNumber(set, IN.sma50);
  const sma200 = readNumber(set, IN.sma200);
  const sma200Trend = readNumber(set, IN.sma200Trend);
  const relative = readNumber(set, IN.relativeStrength);
  const slope = readNumber(set, IN.weeklyRsiSlope);
  const gapChange = readNumber(set, IN.sma50GapChange);
  const relativeChange = readNumber(set, IN.relativeStrengthChange);
  const monthlyRsi = readNumber(set, IN.monthlyRsi);
  const distance = readNumber(set, IN.distanceFrom52wHigh);

  const level = [weeklyRsi, rsiChange, price, sma50, sma200, sma200Trend, relative];
  const direction = [slope, gapChange, relativeChange];
  const required = [IN.weeklyRsi, IN.weeklyRsiChange, IN.price, IN.sma50, IN.sma200, IN.sma200Trend, IN.relativeStrength, IN.weeklyRsiSlope, IN.sma50GapChange, IN.relativeStrengthChange];
  const missingDirection = blockingIds(direction);

  const levelBlocking = blockingIds(level);
  if (levelBlocking.length > 0) {
    return { result: 'NOT_EVALUABLE', signals: null, reasons: [], requiredMetricIds: required, blockingMetricIds: levelBlocking, missingDirectionMetricIds: missingDirection };
  }

  const belowSma50 = (price.value as number) < (sma50.value as number);
  const belowFallingSma200 = (price.value as number) < (sma200.value as number) && (sma200Trend.value as number) < 0;
  const relativeStrengthNegative = (relative.value as number) < 0;
  const relativeWorsening = relativeChange.value !== null && relativeChange.value < 0;
  const signals: TechnicalSignals = {
    weeklyRsiSlopeNonNegative: tri(slope, (v) => v >= 0),
    rsiChange4wNonNegative: (rsiChange.value as number) >= 0,
    relativeStrengthNotWorsening: tri(relativeChange, (v) => v >= 0),
    weeklyRsiSlopePositive: tri(slope, (v) => v > 0),
    rsiChange4wPositive: (rsiChange.value as number) > 0,
    smaGapImproving: tri(gapChange, (v) => v > 0),
    relativeStrengthImproving: tri(relativeChange, (v) => v > 0),
    weeklyRsiDepressed: (weeklyRsi.value as number) <= P.weeklyRsiDepressedMax,
    priceBelowSma50: belowSma50,
    belowFallingSma200,
    relativeStrengthNegative,
    otherBearishCount: [belowSma50, belowFallingSma200, relativeStrengthNegative, relativeWorsening].filter(Boolean).length,
  };
  const state = technicalStateOf(signals);

  const reasons: ReasonCode[] = [];
  if (state === null) {
    // Fail closed: the stabilization core cannot be evidenced. Named, never guessed.
    const unavailable = direction.filter((read) => read.value === null);
    reasons.push(qvReason(QV_REASON.DATA_TECHNICAL_DIRECTION_UNAVAILABLE, 'BLOCKING', metricsOf(unavailable), { affects: 'STABILIZING', metricIds: missingDirection }));
    return { result: 'NOT_EVALUABLE', signals, reasons, requiredMetricIds: required, blockingMetricIds: missingDirection, missingDirectionMetricIds: missingDirection };
  }

  reasons.push(
    qvReason(
      STATE_CODE[state],
      state === 'RECOVERING' || state === 'STABILIZING' ? 'SUPPORTS' : 'CONCERN',
      metricsOf([...level, ...direction, monthlyRsi.value === null ? null : monthlyRsi, distance.value === null ? null : distance]),
      {
        state,
        weeklyRsiSlopeNonNegative: signals.weeklyRsiSlopeNonNegative,
        rsiChange4wNonNegative: signals.rsiChange4wNonNegative,
        relativeStrengthNotWorsening: signals.relativeStrengthNotWorsening,
        smaGapImproving: signals.smaGapImproving,
        weeklyRsiDepressed: signals.weeklyRsiDepressed,
        otherBearishCount: signals.otherBearishCount,
        weeklyRsiDepressedMax: P.weeklyRsiDepressedMax,
      },
    ),
  );
  // RECOVERING (or the adverse states) not reachable because direction evidence is missing: say so, never imply it.
  if (missingDirection.length > 0 && state === 'STABILIZING') {
    reasons.push(
      qvReason(QV_REASON.DATA_TECHNICAL_DIRECTION_UNAVAILABLE, 'INFORMATIONAL', metricsOf(direction.filter((read) => read.value === null)), { affects: 'RECOVERING', metricIds: missingDirection }),
    );
  }
  return { result: state, signals, reasons, requiredMetricIds: required, blockingMetricIds: [], missingDirectionMetricIds: missingDirection };
}
