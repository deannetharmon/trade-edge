// lib/discovery/qv/fundamentals.ts

// LEAPS-QV-0001 Gate 3 (Sections 45.5, 45.6, 45.7) -- fundamental trajectory.
//
// ONE evaluation of five dimensions (revenue, EPS, operating margin, free cash flow, leverage), each DETERIORATING /
// STABLE / IMPROVING or NOT_EVALUABLE, feeds three judgements so the logic exists once:
//   Growth-Adjusted Valuation   INTACT / MIXED / DETERIORATING        (how many dimensions deteriorate)
//   Fundamental Integrity       PASS / FAIL (thesis broken)           (hard rule: three or more deteriorate together)
//   Fundamental Momentum        DETERIORATING / STABILIZING / IMPROVING (direction, separate from price momentum)
// A dimension that cannot be evaluated is NOT_EVALUABLE -- it is never counted as stable. Fewer than the policy minimum
// of evaluable dimensions means the domain cannot be reliably classified (INSUFFICIENT_DATA upstream).

import type { MetricSet } from '../metrics';
import type { ReasonCode } from '../reasonCodes';
import { fcfBelowLatestFiscalYear, fcfTrajectory } from './fcf';
import { metricsOf, readFcfHistory, readNumber } from './inputs';
import type { ComponentTrace, NumericRead } from './inputs';
import { QV_V1_0_POLICY } from './policy';
import { dimensionReasonCode, QV_REASON, qvReason } from './reasons';
import type { FundamentalDimension, Trajectory } from './reasons';

export type DimensionState = Trajectory | 'NOT_EVALUABLE';

export interface DimensionAssessment {
  readonly dimension: FundamentalDimension;
  readonly state: DimensionState;
  readonly blockingMetricIds: readonly string[];
}

export type GrowthAdjustedResult = 'INTACT' | 'MIXED' | 'DETERIORATING' | 'NOT_EVALUABLE';
export type IntegrityResult = 'PASS' | 'FAIL' | 'NOT_EVALUABLE';
export type MomentumResult = 'IMPROVING' | 'STABILIZING' | 'DETERIORATING' | 'NOT_EVALUABLE';

export interface FundamentalsAssessment extends ComponentTrace {
  readonly dimensions: readonly DimensionAssessment[];
  readonly evaluableCount: number;
  readonly deterioratingCount: number;
  readonly improvingCount: number;
  readonly growthAdjusted: GrowthAdjustedResult;
  readonly integrity: IntegrityResult;
  readonly thesisBroken: boolean;
  readonly momentum: MomentumResult;
}

const P = QV_V1_0_POLICY.fundamentals;
const IN = QV_V1_0_POLICY.inputs.fundamentals;

/**
 * Revenue / EPS (assumption A1): growth against its own long-term trend. Missing trend evidence never establishes stability:
 *  - negative growth is DETERIORATING regardless of the trend (ratified A1), including when the trend is unavailable;
 *  - non-negative growth with no trend reference cannot be called STABLE or IMPROVING -> null (not evaluable).
 */
export function growthTrajectoryOf(growthPct: number, trendPct: number | null): Trajectory | null {
  // Assumption A1 (ratified): current negative growth is DETERIORATING regardless of the trend (-2 against a -5 trend is still
  // DETERIORATING). Positive growth below trend is NOT automatically DETERIORATING; the slowdown is reported separately
  // (growthSlowdownContext) as evidence, with no invented threshold.
  if (growthPct < 0) return 'DETERIORATING';
  if (trendPct === null) return null;
  if (growthPct > trendPct) return 'IMPROVING';
  return 'STABLE';
}

/** Non-negative growth that is below its own trend: slowdown context, kept separate from the trajectory state. */
export function growthSlowdownContext(growthPct: number, trendPct: number | null): boolean {
  return trendPct !== null && growthPct >= 0 && growthPct < trendPct;
}

/** Operating margin (assumption A2): year-over-year change in percentage points, with a materiality band. */
export function marginTrajectoryOf(changePp: number): Trajectory {
  if (changePp < -P.marginMaterialChangePp) return 'DETERIORATING';
  if (changePp > P.marginMaterialChangePp) return 'IMPROVING';
  return 'STABLE';
}

function growthDimension(dimension: FundamentalDimension, growth: NumericRead, trend: NumericRead): DimensionAssessment {
  if (growth.value === null) return { dimension, state: 'NOT_EVALUABLE', blockingMetricIds: [growth.id] };
  const state = growthTrajectoryOf(growth.value, trend.value);
  if (state === null) return { dimension, state: 'NOT_EVALUABLE', blockingMetricIds: [trend.id] };
  return { dimension, state, blockingMetricIds: [] };
}

export function assessFundamentals(set: MetricSet): FundamentalsAssessment {
  const revenueGrowth = readNumber(set, IN.revenueGrowth);
  const revenueTrend = readNumber(set, IN.revenueTrend);
  const epsGrowth = readNumber(set, IN.epsGrowth);
  const epsTrend = readNumber(set, IN.epsTrend);
  const marginChange = readNumber(set, IN.marginChange);
  const fcf = readNumber(set, IN.fcf);
  const history = readFcfHistory(set, IN.fcfHistory, QV_V1_0_POLICY.quality.fcfHistoryYears);

  const fcfState = fcfTrajectory(fcf.value, history.points);
  const dimensions: DimensionAssessment[] = [
    growthDimension('REVENUE', revenueGrowth, revenueTrend),
    growthDimension('EPS', epsGrowth, epsTrend),
    marginChange.value === null
      ? { dimension: 'OPERATING_MARGIN', state: 'NOT_EVALUABLE', blockingMetricIds: [marginChange.id] }
      : { dimension: 'OPERATING_MARGIN', state: marginTrajectoryOf(marginChange.value), blockingMetricIds: [] },
    fcfState === null
      ? { dimension: 'FCF', state: 'NOT_EVALUABLE', blockingMetricIds: fcf.value === null ? [fcf.id] : [history.id] }
      : { dimension: 'FCF', state: fcfState, blockingMetricIds: [] },
    // Assumption A7: no prior-period leverage metric exists, so the leverage dimension cannot be judged. It never counts as stable.
    { dimension: 'LEVERAGE', state: 'NOT_EVALUABLE', blockingMetricIds: [] },
  ];

  const countOf = (state: DimensionState): number => dimensions.filter((d) => d.state === state).length;
  const deterioratingCount = countOf('DETERIORATING');
  const improvingCount = countOf('IMPROVING');
  const evaluableCount = dimensions.filter((d) => d.state !== 'NOT_EVALUABLE').length;
  const enough = evaluableCount >= P.minEvaluableDimensions;

  // --- the three judgements ---
  let growthAdjusted: GrowthAdjustedResult = 'NOT_EVALUABLE';
  let integrity: IntegrityResult = 'NOT_EVALUABLE';
  let momentum: MomentumResult = 'NOT_EVALUABLE';
  if (enough) {
    growthAdjusted =
      deterioratingCount >= P.growthAdjustedDeterioratingMinDimensions
        ? 'DETERIORATING'
        : deterioratingCount >= P.growthAdjustedMixedDimensions
          ? 'MIXED'
          : 'INTACT';
    integrity = deterioratingCount >= P.thesisBreakMinDimensions ? 'FAIL' : 'PASS';
    // IMPROVING needs a strict majority of the evaluable dimensions improving and no dimension deteriorating.
    momentum =
      deterioratingCount >= P.momentumDeterioratingMinDimensions
        ? 'DETERIORATING'
        : deterioratingCount === 0 && improvingCount * 2 > evaluableCount
          ? 'IMPROVING'
          : 'STABILIZING';
  }
  const thesisBroken = integrity === 'FAIL';

  // --- reasons (same counts that decided the results above) ---
  const reasons: ReasonCode[] = [];
  const evidenceFor: Record<FundamentalDimension, NormalizedEvidence> = {
    REVENUE: metricsOf([revenueGrowth, revenueTrend]),
    EPS: metricsOf([epsGrowth, epsTrend]),
    OPERATING_MARGIN: metricsOf([marginChange]),
    FCF: metricsOf([fcf]).concat([history.metric]),
    LEVERAGE: [],
  };
  const slowdown: Array<[FundamentalDimension, NumericRead, NumericRead]> = [['REVENUE', revenueGrowth, revenueTrend], ['EPS', epsGrowth, epsTrend]];
  slowdown.forEach(([dimension, growth, trend]) => {
    if (growth.value !== null && growthSlowdownContext(growth.value, trend.value)) {
      reasons.push(qvReason(QV_REASON.FUNDAMENTAL_GROWTH_SLOWDOWN_CONTEXT, 'CONCERN', metricsOf([growth, trend]), { dimension, growthPct: growth.value, trendPct: trend.value as number }));
    }
  });
  if (fcf.value !== null && history.points !== null && fcfBelowLatestFiscalYear(fcf.value, history.points)) {
    reasons.push(qvReason(QV_REASON.FUNDAMENTAL_FCF_BELOW_LATEST_FY_CONTEXT, 'CONCERN', metricsOf([fcf]).concat([history.metric]), { ttmFcf: fcf.value, latestFiscalYearFcf: history.points[history.points.length - 1] }));
  }
  dimensions.forEach((d) => {
    if (d.state === 'NOT_EVALUABLE') {
      // Growth known but no trend reference to judge it against: reported, never counted as stable.
      const trendId = d.dimension === 'REVENUE' ? IN.revenueTrend : d.dimension === 'EPS' ? IN.epsTrend : null;
      if (trendId !== null && d.blockingMetricIds.indexOf(trendId) >= 0) {
        reasons.push(qvReason(QV_REASON.DATA_TREND_REFERENCE_UNAVAILABLE, 'CONCERN', metricsOf([d.dimension === 'REVENUE' ? revenueTrend : epsTrend]), { dimension: d.dimension }));
      }
      return;
    }
    reasons.push(
      qvReason(dimensionReasonCode(d.dimension, d.state), d.state === 'DETERIORATING' ? 'CONCERN' : d.state === 'IMPROVING' ? 'SUPPORTS' : 'INFORMATIONAL', evidenceFor[d.dimension], {
        dimension: d.dimension,
        state: d.state,
      }),
    );
  });
  reasons.push(qvReason(QV_REASON.DATA_LEVERAGE_TRAJECTORY_UNAVAILABLE, 'INFORMATIONAL', [], { assumption: 'A7' }));

  const counts = { evaluable: evaluableCount, deteriorating: deterioratingCount, improving: improvingCount, minEvaluable: P.minEvaluableDimensions };
  if (enough) {
    const gaCode =
      growthAdjusted === 'INTACT' ? QV_REASON.VALUATION_GROWTH_ADJUSTED_INTACT : growthAdjusted === 'MIXED' ? QV_REASON.VALUATION_GROWTH_ADJUSTED_MIXED : QV_REASON.VALUATION_GROWTH_ADJUSTED_DETERIORATING;
    reasons.push(qvReason(gaCode, growthAdjusted === 'INTACT' ? 'SUPPORTS' : growthAdjusted === 'MIXED' ? 'CONCERN' : 'BLOCKING', [], { ...counts, result: growthAdjusted }));
    const momentumCode =
      momentum === 'IMPROVING' ? QV_REASON.FUNDAMENTAL_MOMENTUM_IMPROVING : momentum === 'STABILIZING' ? QV_REASON.FUNDAMENTAL_MOMENTUM_STABILIZING : QV_REASON.FUNDAMENTAL_MOMENTUM_DETERIORATING;
    reasons.push(qvReason(momentumCode, momentum === 'DETERIORATING' ? 'BLOCKING' : 'SUPPORTS', [], { ...counts, result: momentum }));
    if (thesisBroken) {
      reasons.push(qvReason(QV_REASON.FUNDAMENTAL_THESIS_BROKEN, 'BLOCKING', [], { ...counts, thesisBreakMinDimensions: P.thesisBreakMinDimensions }));
    } else {
      reasons.push(qvReason(QV_REASON.FUNDAMENTAL_INTEGRITY_INTACT, 'SUPPORTS', [], { ...counts, thesisBreakMinDimensions: P.thesisBreakMinDimensions }));
    }
  }

  const blocking: string[] = [];
  if (!enough) {
    dimensions.forEach((d) =>
      d.blockingMetricIds.forEach((id) => {
        if (blocking.indexOf(id) < 0) blocking.push(id);
      }),
    );
  }
  const required: string[] = [IN.revenueGrowth, IN.epsGrowth, IN.marginChange, IN.fcf];

  return {
    dimensions,
    evaluableCount,
    deterioratingCount,
    improvingCount,
    growthAdjusted,
    integrity,
    thesisBroken,
    momentum,
    reasons,
    requiredMetricIds: required,
    blockingMetricIds: blocking.sort(),
  };
}

type NormalizedEvidence = ReturnType<typeof metricsOf>;
