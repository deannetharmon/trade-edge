// lib/discovery/qv/quality.ts

// LEAPS-QV-0001 Gate 3 (Section 45.3) -- Quality.
//
// Quality is multidimensional: durability (revenue), profitability (operating margin), cash generation (FCF), balance
// sheet (Net Debt / EBITDA) and capital efficiency (ROIC-v1). No single positive metric establishes it.
//
// Adverse evidence that is already known stands even when other inputs are missing (a non-positive operating margin
// fails Quality whether or not ROIC is available). Missing evidence is never a pass: if Quality is not failed by what is
// known and any aspect cannot be evaluated, the result is NOT_EVALUABLE.

import type { MetricSet } from '../metrics';
import type { ReasonCode } from '../reasonCodes';
import { classifyFcfPattern, fcfPatternIsMaterialWeakness } from './fcf';
import type { FcfPattern } from './fcf';
import { blockingIds, metricsOf, readFcfHistory, readNumber } from './inputs';
import type { ComponentTrace } from './inputs';
import { QV_V1_0_POLICY } from './policy';
import { QV_REASON, qvReason } from './reasons';

export type QualityResult = 'PASS' | 'FAIL' | 'NOT_EVALUABLE';
export type StrengthBand = 'STRONG' | 'ACCEPTABLE' | 'WEAK';
export type LeverageBand = 'STRONG' | 'ACCEPTABLE' | 'ELEVATED' | 'HIGH';

export type QualityWeakness = 'REVENUE' | 'ROIC' | 'FCF' | 'LEVERAGE';

export interface QualityAssessment extends ComponentTrace {
  readonly result: QualityResult;
  readonly revenueBand: StrengthBand | null;
  readonly operatingMarginPositive: boolean | null;
  readonly fcfPattern: FcfPattern;
  readonly roicBand: StrengthBand | null;
  readonly leverageBand: LeverageBand | null;
  readonly weaknesses: readonly QualityWeakness[];
}

const P = QV_V1_0_POLICY.quality;
const IN = QV_V1_0_POLICY.inputs.quality;

export function revenueBandOf(cagrPct: number): StrengthBand {
  if (cagrPct >= P.revenueCagrStrongMinPct) return 'STRONG';
  if (cagrPct >= P.revenueCagrAcceptableMinPct) return 'ACCEPTABLE';
  return 'WEAK';
}

export function roicBandOf(roicPct: number): StrengthBand {
  if (roicPct >= P.roicStrongMinPct) return 'STRONG';
  if (roicPct >= P.roicAcceptableMinPct) return 'ACCEPTABLE';
  return 'WEAK';
}

export function leverageBandOf(netDebtToEbitda: number): LeverageBand {
  if (netDebtToEbitda <= P.leverageStrongMax) return 'STRONG';
  if (netDebtToEbitda <= P.leverageAcceptableMax) return 'ACCEPTABLE';
  if (netDebtToEbitda <= P.leverageElevatedMax) return 'ELEVATED';
  return 'HIGH';
}

const REVENUE_CODE: Record<StrengthBand, string> = {
  STRONG: QV_REASON.QUALITY_REVENUE_STRONG,
  ACCEPTABLE: QV_REASON.QUALITY_REVENUE_ACCEPTABLE,
  WEAK: QV_REASON.QUALITY_REVENUE_WEAK,
};
const ROIC_CODE: Record<StrengthBand, string> = {
  STRONG: QV_REASON.QUALITY_ROIC_STRONG,
  ACCEPTABLE: QV_REASON.QUALITY_ROIC_ACCEPTABLE,
  WEAK: QV_REASON.QUALITY_ROIC_WEAK,
};
const LEVERAGE_CODE: Record<LeverageBand, string> = {
  STRONG: QV_REASON.QUALITY_LEVERAGE_STRONG,
  ACCEPTABLE: QV_REASON.QUALITY_LEVERAGE_ACCEPTABLE,
  ELEVATED: QV_REASON.QUALITY_LEVERAGE_ELEVATED,
  HIGH: QV_REASON.QUALITY_LEVERAGE_HIGH,
};

export function assessQuality(set: MetricSet): QualityAssessment {
  const margin = readNumber(set, IN.operatingMargin);
  const revenue = readNumber(set, IN.revenueCagr);
  const fcf = readNumber(set, IN.fcf);
  const roic = readNumber(set, IN.roic);
  const leverage = readNumber(set, IN.leverage);
  // FCF history is read only when it matters: a positive TTM figure needs none.
  const needsHistory = fcf.value !== null && fcf.value <= 0;
  const history = needsHistory ? readFcfHistory(set, IN.fcfHistory, P.fcfHistoryYears) : null;

  const reasons: ReasonCode[] = [];
  const required: string[] = [IN.operatingMargin, IN.revenueCagr, IN.fcf, IN.roic, IN.leverage];
  if (needsHistory) required.push(IN.fcfHistory);

  // --- aspects ---
  const operatingMarginPositive = margin.value === null ? null : margin.value > P.operatingMarginRequiredAbovePct;
  const revenueBand = revenue.value === null ? null : revenueBandOf(revenue.value);
  const roicBand = roic.value === null ? null : roicBandOf(roic.value);
  const leverageBand = leverage.value === null ? null : leverageBandOf(leverage.value);
  const fcfPattern = classifyFcfPattern(fcf.value, history ? history.points : null);

  if (operatingMarginPositive !== null) {
    reasons.push(
      qvReason(
        operatingMarginPositive ? QV_REASON.QUALITY_OPERATING_MARGIN_POSITIVE : QV_REASON.QUALITY_OPERATING_MARGIN_NON_POSITIVE,
        operatingMarginPositive ? 'SUPPORTS' : 'BLOCKING',
        [margin.metric],
        { requiredAbovePct: P.operatingMarginRequiredAbovePct },
      ),
    );
  }
  if (revenueBand) {
    reasons.push(
      qvReason(REVENUE_CODE[revenueBand], revenueBand === 'WEAK' ? 'CONCERN' : 'SUPPORTS', [revenue.metric], {
        band: revenueBand,
        strongMinPct: P.revenueCagrStrongMinPct,
        acceptableMinPct: P.revenueCagrAcceptableMinPct,
      }),
    );
  }
  if (roicBand) {
    reasons.push(
      qvReason(ROIC_CODE[roicBand], roicBand === 'WEAK' ? 'CONCERN' : 'SUPPORTS', [roic.metric], {
        band: roicBand,
        strongMinPct: P.roicStrongMinPct,
        acceptableMinPct: P.roicAcceptableMinPct,
      }),
    );
  }
  if (leverageBand) {
    reasons.push(
      qvReason(LEVERAGE_CODE[leverageBand], leverageBand === 'HIGH' || leverageBand === 'ELEVATED' ? 'CONCERN' : 'SUPPORTS', [leverage.metric], {
        band: leverageBand,
        strongMax: P.leverageStrongMax,
        acceptableMax: P.leverageAcceptableMax,
        elevatedMax: P.leverageElevatedMax,
      }),
    );
  }
  if (fcfPattern === 'POSITIVE') {
    reasons.push(qvReason(QV_REASON.QUALITY_FCF_POSITIVE, 'SUPPORTS', [fcf.metric]));
  } else if (fcfPattern === 'NEGATIVE_TEMPORARY') {
    reasons.push(qvReason(QV_REASON.QUALITY_FCF_NEGATIVE_TEMPORARY, 'CONCERN', [fcf.metric].concat(history ? [history.metric] : []), { pattern: fcfPattern }));
  } else if (fcfPattern === 'NEGATIVE_PERSISTENT') {
    reasons.push(qvReason(QV_REASON.QUALITY_FCF_NEGATIVE_PERSISTENT, 'CONCERN', [fcf.metric].concat(history ? [history.metric] : []), { pattern: fcfPattern }));
  } else if (fcfPattern === 'DETERIORATING_INTO_NEGATIVE') {
    reasons.push(qvReason(QV_REASON.QUALITY_FCF_DETERIORATING, 'CONCERN', [fcf.metric].concat(history ? [history.metric] : []), { pattern: fcfPattern }));
  }

  // --- material weaknesses (assumption A4) ---
  const weaknesses: QualityWeakness[] = [];
  if (revenueBand === 'WEAK') weaknesses.push('REVENUE');
  if (roicBand === 'WEAK') weaknesses.push('ROIC');
  if (fcfPatternIsMaterialWeakness(fcfPattern)) weaknesses.push('FCF');
  if (leverageBand === 'HIGH') weaknesses.push('LEVERAGE');
  const otherThanLeverage = weaknesses.filter((weakness) => weakness !== 'LEVERAGE').length;

  // --- blockers: aspects that cannot be evaluated ---
  const blocking = blockingIds([margin, revenue, roic, leverage, fcf]);
  if (needsHistory && fcfPattern === 'NOT_EVALUABLE') blocking.push(IN.fcfHistory);
  const blockingMetricIds = blocking.sort();

  // --- result: known adverse evidence first, then evaluability ---
  let result: QualityResult;
  let gateReason: ReasonCode | null = null;
  const evidence = metricsOf([margin, revenue, fcf, roic, leverage]);
  if (operatingMarginPositive === false) {
    result = 'FAIL';
    gateReason = qvReason(QV_REASON.QUALITY_FAIL_OPERATING_MARGIN, 'BLOCKING', [margin.metric]);
  } else if (leverageBand === 'HIGH' && otherThanLeverage >= P.leverageHighWithOtherWeaknessFailCount) {
    result = 'FAIL';
    gateReason = qvReason(QV_REASON.QUALITY_FAIL_LEVERAGE_WITH_WEAKNESS, 'BLOCKING', evidence, { weaknesses });
  } else if (weaknesses.length >= P.materialWeaknessFailCount) {
    result = 'FAIL';
    gateReason = qvReason(QV_REASON.QUALITY_FAIL_MULTIPLE_WEAKNESSES, 'BLOCKING', evidence, { weaknesses });
  } else if (blockingMetricIds.length > 0) {
    result = 'NOT_EVALUABLE';
  } else {
    result = 'PASS';
    gateReason = qvReason(QV_REASON.QUALITY_PASS, 'SUPPORTS', evidence, { weaknesses });
  }
  if (gateReason) reasons.push(gateReason);

  return {
    result,
    revenueBand,
    operatingMarginPositive,
    fcfPattern,
    roicBand,
    leverageBand,
    weaknesses,
    reasons,
    requiredMetricIds: required,
    blockingMetricIds: result === 'NOT_EVALUABLE' ? blockingMetricIds : [],
  };
}
