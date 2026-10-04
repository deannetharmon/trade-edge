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
// Evidence is kept in four distinct classes (review round 2), and an unsupported state is never forced:
//   DECLINING        >= policy.technical.decliningMinBearishFamilies DISTINCT bearish feature groups are evidenced (RSI momentum,
//                    SMA50 relationship, SMA200 trend, relative strength). The groups are distinct measurements, NOT statistically
//                    independent signals (SMA50 and SMA200 are correlated). One contradicting signal is not DECLINING.
//   OVERSOLD         weekly RSI is at or below the depressed line AND at least one non-RSI group (SMA50 / SMA200 / relative
//                    strength) is bearish, stabilization is not established, and DECLINING is not established. RSI alone never
//                    produces OVERSOLD ("RSI alone must not determine state"): a depressed RSI with no non-RSI confirmation is
//                    NOT_ESTABLISHED. Whether a depressed RSI level alone should be OVERSOLD is an open specification question
//                    for Ian (see the policy-decisions document); no threshold is invented here.
//   NOT_ESTABLISHED  the domain IS evaluable but the evidence supports none of the four states: stabilization is contradicted
//                    by known evidence, yet deterioration is not multiply confirmed and the stock is not depressed. This is a
//                    taxonomy gap in Section 45.8 (reported for Ian); it fails the SETUP/ACTIONABLE requirement and is not
//                    INSUFFICIENT_DATA, because the evidence is present and unfavorable, not missing.
//   NOT_EVALUABLE    required evidence is unavailable and nothing independently established decides a state. Strict sufficiency is
//                    kept: when a required LEVEL metric is missing the STATE is never classified from partial evidence. Whatever
//                    adverse readings ARE independently evidenced are still reported as a TECHNICAL_ADVERSE_EVIDENCE_PRESENT
//                    reason (a trace, not a state), so the adverse evidence is never erased by missing data.
// OVERSOLD is a description of how depressed the stock is, not a buy signal: it never moves a candidate past WATCH.
// Monthly RSI and the distance from the 52-week high are supporting evidence only (carried on the reason).

import type { MetricSet } from '../metrics';
import type { ReasonCode } from '../reasonCodes';
import { blockingIds, metricsOf, readNumber } from './inputs';
import type { ComponentTrace, NumericRead } from './inputs';
import { QV_V1_0_POLICY } from './policy';
import { QV_REASON, qvReason } from './reasons';

export type TechnicalState = 'DECLINING' | 'OVERSOLD' | 'STABILIZING' | 'RECOVERING';
export type TechnicalResult = TechnicalState | 'NOT_ESTABLISHED' | 'NOT_EVALUABLE';

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
  /** Independent bearish families that are evidenced (each family counts once, however many of its readings are bearish). */
  readonly rsiMomentumBearish: boolean;
  readonly sma50Bearish: boolean;
  readonly sma200Bearish: boolean;
  readonly relativeStrengthBearish: boolean;
  readonly bearishFamilyCount: number;
  /** Bearish groups other than RSI momentum (SMA50, SMA200, relative strength): the confirmation OVERSOLD requires. */
  readonly nonRsiBearishGroups: number;
}

export interface TechnicalAssessment extends ComponentTrace {
  readonly result: TechnicalResult;
  readonly signals: TechnicalSignals | null;
  /** Direction metrics that were not VALID (reported even when the state is still established). */
  readonly missingDirectionMetricIds: readonly string[];
}

const P = QV_V1_0_POLICY.technical;
const IN = QV_V1_0_POLICY.inputs.technical;

const STATE_CODE: Record<TechnicalState | 'NOT_ESTABLISHED', string> = {
  NOT_ESTABLISHED: QV_REASON.TECHNICAL_STATE_NOT_ESTABLISHED,
  DECLINING: QV_REASON.TECHNICAL_DECLINING,
  OVERSOLD: QV_REASON.TECHNICAL_OVERSOLD,
  STABILIZING: QV_REASON.TECHNICAL_STABILIZING,
  RECOVERING: QV_REASON.TECHNICAL_RECOVERING,
};

function allTrue(values: readonly Evidenced[]): boolean {
  return values.every((value) => value === true);
}

/**
 * The state the evidence establishes, 'NOT_ESTABLISHED' when the evidence is present but supports none of the four states, or
 * null when required evidence is unavailable and nothing independently established decides a state.
 */
export function technicalStateOf(signals: TechnicalSignals): TechnicalState | 'NOT_ESTABLISHED' | null {
  if (allTrue([signals.weeklyRsiSlopePositive, signals.rsiChange4wPositive, signals.smaGapImproving, signals.relativeStrengthImproving])) return 'RECOVERING';
  const core: Evidenced[] = [signals.weeklyRsiSlopeNonNegative, signals.rsiChange4wNonNegative, signals.relativeStrengthNotWorsening];
  if (allTrue(core)) return 'STABILIZING';
  // Independently established adverse evidence stands even when other inputs are unavailable.
  if (signals.bearishFamilyCount >= P.decliningMinBearishFamilies) return 'DECLINING';
  // Depressed RSI CONFIRMED by non-RSI evidence, and not stabilized (contradicted OR not evidenced). OVERSOLD is never
  // constructive: it cannot pass WATCH. A depressed RSI with no non-RSI confirmation falls through (RSI alone decides nothing).
  if (signals.weeklyRsiDepressed && signals.nonRsiBearishGroups >= 1) return 'OVERSOLD';
  // One contradicting signal and nothing else adverse: evaluable, but no state is supported. Do not force one.
  if (core.indexOf(false) >= 0) return 'NOT_ESTABLISHED';
  // Nothing contradicts stabilization, but part of it cannot be evidenced: fail closed.
  return null;
}

/**
 * The adverse readings that ARE independently evidenced by the inputs that are available, as one trace reason (null when none).
 * Used when the state cannot be classified: the missing data is reported, and so is the adverse evidence it did not erase.
 */
function adverseTrace(
  price: NumericRead, sma50: NumericRead, sma200: NumericRead, sma200Trend: NumericRead, relative: NumericRead,
  rsiChange: NumericRead, slope: NumericRead, gapChange: NumericRead, relativeChange: NumericRead,
): ReasonCode | null {
  const readings: string[] = [];
  const used: NumericRead[] = [];
  const note = (name: string, ...reads: NumericRead[]): void => {
    readings.push(name);
    reads.forEach((read) => used.push(read));
  };
  if (rsiChange.value !== null && rsiChange.value < 0) note('RSI_4W_CHANGE_NEGATIVE', rsiChange);
  if (slope.value !== null && slope.value < 0) note('RSI_WEEKLY_SLOPE_NEGATIVE', slope);
  if (price.value !== null && sma50.value !== null && price.value < sma50.value) note('PRICE_BELOW_SMA50', price, sma50);
  if (gapChange.value !== null && gapChange.value < 0) note('SMA50_GAP_WORSENING', gapChange);
  if (price.value !== null && sma200.value !== null && sma200Trend.value !== null && price.value < sma200.value && sma200Trend.value < 0) {
    note('PRICE_BELOW_FALLING_SMA200', price, sma200, sma200Trend);
  }
  if (relative.value !== null && relative.value < 0) note('RELATIVE_STRENGTH_NEGATIVE', relative);
  if (relativeChange.value !== null && relativeChange.value < 0) note('RELATIVE_STRENGTH_WORSENING', relativeChange);
  if (readings.length === 0) return null;
  return qvReason(QV_REASON.TECHNICAL_ADVERSE_EVIDENCE_PRESENT, 'CONCERN', metricsOf(used), { readings, classified: false });
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
    // Strict sufficiency: no state from partial evidence. The independently evidenced adverse readings are still reported.
    const trace = adverseTrace(price, sma50, sma200, sma200Trend, relative, rsiChange, slope, gapChange, relativeChange);
    return { result: 'NOT_EVALUABLE', signals: null, reasons: trace ? [trace] : [], requiredMetricIds: required, blockingMetricIds: levelBlocking, missingDirectionMetricIds: missingDirection };
  }

  const belowSma50 = (price.value as number) < (sma50.value as number);
  const belowFallingSma200 = (price.value as number) < (sma200.value as number) && (sma200Trend.value as number) < 0;
  const relativeStrengthNegative = (relative.value as number) < 0;
  const relativeWorsening = relativeChange.value !== null && relativeChange.value < 0;
  const rsiMomentumBearish = (slope.value !== null && slope.value < 0) || (rsiChange.value as number) < 0;
  const sma50Bearish = belowSma50 || (gapChange.value !== null && gapChange.value < 0);
  const relativeStrengthBearish = relativeStrengthNegative || relativeWorsening;
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
    rsiMomentumBearish,
    sma50Bearish,
    sma200Bearish: belowFallingSma200,
    relativeStrengthBearish,
    bearishFamilyCount: [rsiMomentumBearish, sma50Bearish, belowFallingSma200, relativeStrengthBearish].filter(Boolean).length,
    nonRsiBearishGroups: [sma50Bearish, belowFallingSma200, relativeStrengthBearish].filter(Boolean).length,
  };
  const state = technicalStateOf(signals);

  const reasons: ReasonCode[] = [];
  if (state === null) {
    // Fail closed: the stabilization core cannot be evidenced. Named, never guessed.
    const unavailable = direction.filter((read) => read.value === null);
    reasons.push(qvReason(QV_REASON.DATA_TECHNICAL_DIRECTION_UNAVAILABLE, 'BLOCKING', metricsOf(unavailable), { affects: 'STABILIZING', metricIds: missingDirection }));
    const trace = adverseTrace(price, sma50, sma200, sma200Trend, relative, rsiChange, slope, gapChange, relativeChange);
    if (trace) reasons.push(trace);
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
        nonRsiBearishGroups: signals.nonRsiBearishGroups,
        bearishFamilyCount: signals.bearishFamilyCount,
        rsiMomentumBearish: signals.rsiMomentumBearish,
        sma50Bearish: signals.sma50Bearish,
        sma200Bearish: signals.sma200Bearish,
        relativeStrengthBearish: signals.relativeStrengthBearish,
        decliningMinBearishFamilies: P.decliningMinBearishFamilies,
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
