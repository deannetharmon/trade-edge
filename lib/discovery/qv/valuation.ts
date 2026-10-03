// lib/discovery/qv/valuation.ts

// LEAPS-QV-0001 Gate 3 (Section 45.4) -- Valuation Dislocation.
//
// Historical valuation is primary. The 5Y P/E percentile and the discount to the 5Y median P/E are INDEPENDENT criteria:
// either one can establish its dislocation class on its own (percentile 18 with only a 5% discount is STRONG), and the
// stronger class wins. NO MATERIAL DISLOCATION needs both criteria evaluated and both short of MODERATE -- one missing
// criterion plus one unremarkable criterion is not evidence of "no dislocation", it is insufficient evidence.
// When the 5Y figure is unavailable but the 3Y figure exists, the SAME economic thresholds apply at reduced confidence.
// Supporting measures (FCF yield, Price/FCF, EV/EBITDA) get no absolute cut-offs in QV-v1.0 and do not decide a class.

import type { MetricSet } from '../metrics';
import type { ReasonCode } from '../reasonCodes';
import { blockingIds, metricsOf, readNumber } from './inputs';
import type { ComponentTrace, NumericRead } from './inputs';
import { QV_V1_0_POLICY } from './policy';
import { QV_REASON, qvReason } from './reasons';

export type DislocationClass = 'STRONG' | 'MODERATE' | 'NONE';
export type ValuationResult = DislocationClass | 'NOT_EVALUABLE';
export type ValuationWindow = '5Y' | '3Y';

export interface ValuationAssessment extends ComponentTrace {
  readonly result: ValuationResult;
  readonly percentileClass: DislocationClass | null;
  readonly discountClass: DislocationClass | null;
  readonly percentileWindow: ValuationWindow | null;
  readonly discountWindow: ValuationWindow | null;
  /** REDUCED when any criterion came from the 3Y window. */
  readonly confidence: 'FULL' | 'REDUCED' | null;
  /** The two criteria disagree. Resolved by the independence rule, never a block. */
  readonly conflict: boolean;
}

const P = QV_V1_0_POLICY.valuation;
const IN = QV_V1_0_POLICY.inputs.valuation;

/** Percentile is a "lower is cheaper" measure: <= 20 STRONG, > 20 and <= 35 MODERATE, above 35 not a dislocation. */
export function percentileClassOf(percentile: number): DislocationClass {
  if (percentile <= P.percentileStrongMax) return 'STRONG';
  if (percentile <= P.percentileModerateMax) return 'MODERATE';
  return 'NONE';
}

/** Discount to the historical median, positive = cheaper: >= 20% STRONG, >= 10% and < 20% MODERATE, below 10% not a dislocation. */
export function discountClassOf(discountPct: number): DislocationClass {
  if (discountPct >= P.discountStrongMinPct) return 'STRONG';
  if (discountPct >= P.discountModerateMinPct) return 'MODERATE';
  return 'NONE';
}

interface Chosen {
  readonly read: NumericRead;
  readonly window: ValuationWindow;
}

function choose(primary: NumericRead, fallback: NumericRead): Chosen | null {
  if (primary.value !== null) return { read: primary, window: '5Y' };
  if (fallback.value !== null) return { read: fallback, window: '3Y' };
  return null;
}

const CLASS_CODE: Record<DislocationClass, string> = {
  STRONG: QV_REASON.VALUATION_DISLOCATION_STRONG,
  MODERATE: QV_REASON.VALUATION_DISLOCATION_MODERATE,
  NONE: QV_REASON.VALUATION_NO_MATERIAL_DISLOCATION,
};

export function assessValuation(set: MetricSet): ValuationAssessment {
  const pe = readNumber(set, IN.pe);
  const percentile5y = readNumber(set, IN.percentile5y);
  const percentile3y = readNumber(set, IN.percentile3y);
  const discount5y = readNumber(set, IN.discount5y);
  const discount3y = readNumber(set, IN.discount3y);

  const percentile = choose(percentile5y, percentile3y);
  const discount = choose(discount5y, discount3y);
  const percentileClass = percentile ? percentileClassOf(percentile.read.value as number) : null;
  const discountClass = discount ? discountClassOf(discount.read.value as number) : null;

  const required = [IN.pe, percentile ? percentile.read.id : IN.percentile5y, discount ? discount.read.id : IN.discount5y];

  // Either criterion can independently establish STRONG or MODERATE; NONE needs both criteria evaluated.
  const classes = [percentileClass, discountClass];
  let result: ValuationResult;
  if (pe.value === null) result = 'NOT_EVALUABLE';
  else if (classes.indexOf('STRONG') >= 0) result = 'STRONG';
  else if (classes.indexOf('MODERATE') >= 0) result = 'MODERATE';
  else if (percentileClass !== null && discountClass !== null) result = 'NONE';
  else result = 'NOT_EVALUABLE';

  const blocking: string[] = [];
  if (result === 'NOT_EVALUABLE') {
    blocking.push(...blockingIds([pe]));
    if (!percentile) blocking.push(IN.percentile5y, IN.percentile3y);
    if (!discount) blocking.push(IN.discount5y, IN.discount3y);
  }

  const reasons: ReasonCode[] = [];
  const conflict = percentileClass !== null && discountClass !== null && percentileClass !== discountClass;
  const confidence: 'FULL' | 'REDUCED' | null =
    result === 'NOT_EVALUABLE' ? null : (percentile && percentile.window === '3Y') || (discount && discount.window === '3Y') ? 'REDUCED' : 'FULL';

  if (result !== 'NOT_EVALUABLE') {
    const evidence = metricsOf([pe, percentile ? percentile.read : null, discount ? discount.read : null]);
    reasons.push(
      qvReason(CLASS_CODE[result], result === 'NONE' ? 'CONCERN' : 'SUPPORTS', evidence, {
        class: result,
        percentileClass,
        discountClass,
        percentileWindow: percentile ? percentile.window : null,
        discountWindow: discount ? discount.window : null,
        percentileStrongMax: P.percentileStrongMax,
        percentileModerateMax: P.percentileModerateMax,
        discountStrongMinPct: P.discountStrongMinPct,
        discountModerateMinPct: P.discountModerateMinPct,
      }),
    );
    if (conflict) {
      reasons.push(qvReason(QV_REASON.VALUATION_CONFLICT, 'INFORMATIONAL', evidence, { percentileClass, discountClass, resolvedTo: result }));
    }
    if (confidence === 'REDUCED') {
      reasons.push(
        qvReason(QV_REASON.VALUATION_WINDOW_3Y_FALLBACK, 'INFORMATIONAL', evidence, {
          percentileWindow: percentile ? percentile.window : null,
          discountWindow: discount ? discount.window : null,
        }),
      );
    }
  }

  return {
    result,
    percentileClass,
    discountClass,
    percentileWindow: percentile ? percentile.window : null,
    discountWindow: discount ? discount.window : null,
    confidence,
    conflict,
    reasons,
    requiredMetricIds: required,
    blockingMetricIds: blocking.sort(),
  };
}
