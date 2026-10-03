// lib/discovery/qv/risk.ts

// LEAPS-QV-0001 Gate 3 (Section 45.9, assumption A6) -- Risk, from the evidence TradeEdge has today.
//
// Ordinary earnings proximity is information, never a disqualifier, for a long-duration LEAPS. A reliable binary or
// corporate-event signal is the only risk that blocks SETUP / UNDERLYING ACTIONABLE. Event data that is not available is
// reported explicitly unavailable (a DATA reason) and never read as "no events". Leverage, a valuation conflict and
// fundamental deterioration surface as risk flags so the explanation shows them, but the decisions they influence are
// already made by Quality, Valuation and the fundamental judgements -- risk does not re-decide them.

import { getMetric } from '../metrics';
import type { MetricSet } from '../metrics';
import { dataLimitationReason } from '../reasonCodes';
import type { ReasonCode } from '../reasonCodes';
import { readNumber } from './inputs';
import type { ComponentTrace } from './inputs';
import { QV_V1_0_POLICY } from './policy';
import { QV_REASON, qvReason } from './reasons';
import type { LeverageBand } from './quality';

export interface RiskContext {
  readonly leverageBand: LeverageBand | null;
  readonly valuationConflict: boolean;
  readonly deterioratingDimensions: number;
}

export interface RiskAssessment extends ComponentTrace {
  readonly earningsApproaching: boolean;
  readonly binaryEventPending: boolean;
  /** A reliable event signal that withholds SETUP / UNDERLYING ACTIONABLE. */
  readonly disqualifying: boolean;
  /** The RISK-category subset of `reasons`, for the evaluation's riskFlags. */
  readonly flags: readonly ReasonCode[];
}

const P = QV_V1_0_POLICY.risk;
const IN = QV_V1_0_POLICY.inputs.risk;

function eventFlagsOf(set: MetricSet): { readonly flags: readonly string[] | null; readonly usable: boolean } {
  const metric = getMetric(set, IN.eventFlags);
  if (metric.validity !== 'VALID' || !Array.isArray(metric.value)) return { flags: null, usable: false };
  const flags: string[] = [];
  for (let i = 0; i < metric.value.length; i += 1) {
    const entry = metric.value[i];
    if (typeof entry !== 'string' || entry === '') return { flags: null, usable: false };
    flags.push(entry);
  }
  return { flags, usable: true };
}

export function assessRisk(set: MetricSet, context: RiskContext): RiskAssessment {
  const flags: ReasonCode[] = [];
  const reasons: ReasonCode[] = [];

  // --- earnings proximity ---
  const days = readNumber(set, IN.daysToEarnings);
  const earningsApproaching = days.value !== null && days.value >= 0 && days.value <= P.earningsApproachingMaxDays;
  if (earningsApproaching) {
    flags.push(qvReason(QV_REASON.RISK_EARNINGS_APPROACHING, 'CONCERN', [days.metric], { days: days.value as number, windowDays: P.earningsApproachingMaxDays }));
  } else if (days.value === null) {
    reasons.push(dataLimitationReason(days.metric));
  }

  // --- binary / corporate events ---
  const events = eventFlagsOf(set);
  const eventMetric = getMetric(set, IN.eventFlags);
  const binaryEventPending = events.usable && (events.flags as readonly string[]).length > 0;
  if (binaryEventPending) {
    flags.push(qvReason(QV_REASON.RISK_BINARY_EVENT_PENDING, 'BLOCKING', [eventMetric], { events: (events.flags as readonly string[]).slice() }));
  } else if (!events.usable) {
    // Not available (or not in a usable shape): explicitly unavailable, never "no events".
    reasons.push(eventMetric.validity === 'VALID' ? qvReason(QV_REASON.DATA_REQUIRED_DATA_UNAVAILABLE, 'CONCERN', [eventMetric], { reason: 'EVENT_FLAGS_NOT_A_LIST_OF_TEXT' }) : dataLimitationReason(eventMetric));
  }

  // --- risks already established by other assessments, shown as flags ---
  if (context.leverageBand === 'HIGH') flags.push(qvReason(QV_REASON.RISK_LEVERAGE_HIGH, 'CONCERN', [], { band: 'HIGH' }));
  else if (context.leverageBand === 'ELEVATED') flags.push(qvReason(QV_REASON.RISK_LEVERAGE_ELEVATED, 'CONCERN', [], { band: 'ELEVATED' }));
  if (context.valuationConflict) flags.push(qvReason(QV_REASON.RISK_VALUATION_CONFLICT, 'CONCERN'));
  if (context.deterioratingDimensions > 0) {
    flags.push(qvReason(QV_REASON.RISK_FUNDAMENTAL_DETERIORATION, 'CONCERN', [], { deterioratingDimensions: context.deterioratingDimensions }));
  }

  return {
    earningsApproaching,
    binaryEventPending,
    disqualifying: binaryEventPending,
    flags,
    reasons: flags.concat(reasons),
    requiredMetricIds: [],
    blockingMetricIds: [],
  };
}
