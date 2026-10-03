// lib/discovery/qv/strategy.ts

// LEAPS-QV-0001 Gate 3 (Sections 45.2, 45.10, 45.11) -- the QV-v1.0 underlying strategy: Data Sufficiency, then the
// lifecycle / evaluation classification.
//
// Hard gates are applied in a fixed order and nothing later can undo an earlier verdict:
//   1. Data Sufficiency   a required domain that cannot be reliably evaluated -> INSUFFICIENT_DATA (never a neutral pass)
//   2. Thesis break       three or more fundamental dimensions deteriorating together -> INVALIDATED for a previously
//                         active candidate (WATCH / SETUP / ACTIONABLE); otherwise DISCOVERED. No valuation or technical
//                         strength is consulted.
//   3. Quality            FAIL -> DISCOVERED. Cheapness never rescues it.
//   4. SETUP / ACTIONABLE every requirement must hold; technical STABILIZING -> SETUP, RECOVERING -> ACTIONABLE
//   5. WATCH              quality passes and the thesis is intact, but a SETUP requirement is unmet (assumption A8)
//   6. DISCOVERED         everything else
// A technical regression only ever fails requirement 4, so ACTIONABLE falls to SETUP/WATCH and never to INVALIDATED.
//
// There is no score and no ranking in this layer: a state is the conjunction of its gates. Every reason below is built by
// the same comparisons that decided the state; explanation text is derived from them (explainQvReasons).

import type { DiscoveryStrategy, GateOutcome, StrategyEvaluation, StrategyInput } from '../evaluation';
import { classified, insufficientData, isActiveState } from '../lifecycle';
import type { CandidateState, EvaluationOutcome } from '../lifecycle';
import { getMetric, summarizeDataCompleteness } from '../metrics';
import type { CriterionResult, NormalizedMetric } from '../metrics';
import { normalizeReasons } from '../reasonCodes';
import type { ReasonCode } from '../reasonCodes';
import { QV_V1_0_IDENTITY } from '../qvIdentity';
import { uniqueSorted } from '../util';
import { assessFundamentals } from './fundamentals';
import type { FundamentalsAssessment } from './fundamentals';
import { assessQuality } from './quality';
import type { QualityAssessment } from './quality';
import { QV_V1_0_POLICY } from './policy';
import { QV_REASON, qvReason } from './reasons';
import { assessRisk } from './risk';
import type { RiskAssessment } from './risk';
import { assessTechnical } from './technical';
import type { TechnicalAssessment } from './technical';
import { assessValuation } from './valuation';
import type { ValuationAssessment } from './valuation';

/** The only lifecycle context the strategy needs: whether the candidate was previously active (Section 45.6). */
export interface QvLifecycleContext {
  readonly previousState: CandidateState | null;
}

export const QV_GATE_IDS = {
  QUALITY: 'qv_quality',
  VALUATION: 'qv_valuation_dislocation',
  GROWTH_ADJUSTED: 'qv_growth_adjusted_valuation',
  INTEGRITY: 'qv_fundamental_integrity',
  MOMENTUM: 'qv_fundamental_momentum',
  TECHNICAL: 'qv_technical_state',
  RISK: 'qv_risk',
} as const;

export interface QvDomainAssessments {
  readonly quality: QualityAssessment;
  readonly valuation: ValuationAssessment;
  readonly fundamentals: FundamentalsAssessment;
  readonly technical: TechnicalAssessment;
  readonly risk: RiskAssessment;
}

export function assessQvDomains(input: StrategyInput): QvDomainAssessments {
  const quality = assessQuality(input.metrics);
  const valuation = assessValuation(input.metrics);
  const fundamentals = assessFundamentals(input.metrics);
  const technical = assessTechnical(input.metrics);
  const risk = assessRisk(input.metrics, {
    leverageBand: quality.leverageBand,
    valuationConflict: valuation.conflict,
    deterioratingDimensions: fundamentals.deterioratingCount,
  });
  return { quality, valuation, fundamentals, technical, risk };
}

const STATE_REASON: Record<CandidateState, string | null> = {
  DISCOVERED: QV_REASON.LIFECYCLE_STATE_DISCOVERED,
  WATCH: QV_REASON.LIFECYCLE_STATE_WATCH,
  SETUP: QV_REASON.LIFECYCLE_STATE_SETUP,
  ACTIONABLE: QV_REASON.LIFECYCLE_STATE_ACTIONABLE,
  INVALIDATED: QV_REASON.LIFECYCLE_STATE_INVALIDATED,
  EXPIRED: null,
};

function ofResult(passes: boolean | null): CriterionResult {
  return passes === null ? 'NOT_EVALUABLE' : passes ? 'PASS' : 'FAIL';
}

function gateOutcomes(domains: QvDomainAssessments): GateOutcome[] {
  const { quality, valuation, fundamentals, technical, risk } = domains;
  const fundamentalsEvaluable = fundamentals.growthAdjusted !== 'NOT_EVALUABLE';
  const gates: GateOutcome[] = [
    { gateId: QV_GATE_IDS.QUALITY, result: quality.result, reasonCodes: quality.reasons },
    {
      gateId: QV_GATE_IDS.VALUATION,
      result: ofResult(valuation.result === 'NOT_EVALUABLE' ? null : valuation.result !== 'NONE'),
      reasonCodes: valuation.reasons,
    },
    {
      gateId: QV_GATE_IDS.GROWTH_ADJUSTED,
      result: ofResult(fundamentalsEvaluable ? fundamentals.growthAdjusted !== 'DETERIORATING' : null),
      reasonCodes: fundamentals.reasons,
    },
    { gateId: QV_GATE_IDS.INTEGRITY, result: fundamentals.integrity, reasonCodes: fundamentals.reasons },
    {
      gateId: QV_GATE_IDS.MOMENTUM,
      result: ofResult(fundamentalsEvaluable ? fundamentals.momentum !== 'DETERIORATING' : null),
      reasonCodes: fundamentals.reasons,
    },
    {
      gateId: QV_GATE_IDS.TECHNICAL,
      result: ofResult(technical.result === 'NOT_EVALUABLE' ? null : technical.result === 'STABILIZING' || technical.result === 'RECOVERING'),
      reasonCodes: technical.reasons,
    },
    { gateId: QV_GATE_IDS.RISK, result: risk.disqualifying ? 'FAIL' : 'PASS', reasonCodes: risk.reasons },
  ];
  return gates;
}

function analystRevisionReasons(input: StrategyInput): ReasonCode[] {
  const missing: NormalizedMetric[] = QV_V1_0_POLICY.inputs.analystRevisions
    .map((id) => getMetric(input.metrics, id))
    .filter((metric) => metric.validity !== 'VALID');
  if (missing.length === 0) return [];
  // Optional evidence: explicitly unavailable, never neutral, never blocking.
  return [qvReason(QV_REASON.DATA_ANALYST_REVISION_DATA_UNAVAILABLE, 'INFORMATIONAL', missing, { optional: true })];
}

interface Classification {
  readonly outcome: EvaluationOutcome;
  readonly reasons: readonly ReasonCode[];
}

function classify(domains: QvDomainAssessments, context: QvLifecycleContext): Classification {
  const { quality, valuation, fundamentals, technical, risk } = domains;
  const reasons: ReasonCode[] = [];
  const state = (value: CandidateState, polarity: ReasonCode['polarity']): Classification => {
    const code = STATE_REASON[value];
    if (code) reasons.push(qvReason(code, polarity));
    return { outcome: classified(value), reasons };
  };

  // 1. Data Sufficiency: any required domain that cannot be reliably evaluated.
  const domainBlocks: Array<{ domain: string; ids: readonly string[]; required: readonly string[] }> = [];
  if (quality.result === 'NOT_EVALUABLE') domainBlocks.push({ domain: 'QUALITY', ids: quality.blockingMetricIds, required: quality.requiredMetricIds });
  if (valuation.result === 'NOT_EVALUABLE') domainBlocks.push({ domain: 'VALUATION', ids: valuation.blockingMetricIds, required: valuation.requiredMetricIds });
  if (fundamentals.integrity === 'NOT_EVALUABLE') domainBlocks.push({ domain: 'FUNDAMENTALS', ids: fundamentals.blockingMetricIds, required: fundamentals.requiredMetricIds });
  if (technical.result === 'NOT_EVALUABLE') domainBlocks.push({ domain: 'TECHNICAL', ids: technical.blockingMetricIds, required: technical.requiredMetricIds });
  if (domainBlocks.length > 0) {
    const missing: string[] = [];
    domainBlocks.forEach((block) => {
      const ids = block.ids.length > 0 ? block.ids : block.required;
      ids.forEach((id) => missing.push(id));
      reasons.push(qvReason(QV_REASON.DATA_REQUIRED_DATA_UNAVAILABLE, 'BLOCKING', [], { domain: block.domain, metricIds: uniqueSorted(ids) }));
    });
    return { outcome: insufficientData(missing), reasons };
  }

  // 2. Thesis break: a hard gate that no valuation or technical evidence can override.
  if (fundamentals.thesisBroken) {
    const previouslyActive = context.previousState !== null && isActiveState(context.previousState) && context.previousState !== 'DISCOVERED';
    if (previouslyActive) return state('INVALIDATED', 'BLOCKING');
    reasons.push(qvReason(QV_REASON.LIFECYCLE_THESIS_BREAK_NO_PRIOR_THESIS, 'BLOCKING', [], { previousState: context.previousState }));
    return state('DISCOVERED', 'INFORMATIONAL');
  }

  // 3. Quality hard gate.
  if (quality.result === 'FAIL') {
    reasons.push(qvReason(QV_REASON.LIFECYCLE_UNMET_QUALITY, 'BLOCKING'));
    return state('DISCOVERED', 'INFORMATIONAL');
  }

  // 4. SETUP / ACTIONABLE: every requirement must hold; each unmet one is recorded.
  const valuationMet = valuation.result === 'STRONG' || valuation.result === 'MODERATE';
  const growthMet = fundamentals.growthAdjusted === 'INTACT' || fundamentals.growthAdjusted === 'MIXED';
  const momentumMet = fundamentals.momentum === 'STABILIZING' || fundamentals.momentum === 'IMPROVING';
  const technicalMet = technical.result === 'STABILIZING' || technical.result === 'RECOVERING';
  const riskMet = !risk.disqualifying;
  if (!valuationMet) reasons.push(qvReason(QV_REASON.LIFECYCLE_UNMET_VALUATION, 'CONCERN', [], { valuation: valuation.result }));
  if (!growthMet) reasons.push(qvReason(QV_REASON.LIFECYCLE_UNMET_GROWTH_ADJUSTED, 'BLOCKING', [], { growthAdjusted: fundamentals.growthAdjusted }));
  if (!momentumMet) reasons.push(qvReason(QV_REASON.LIFECYCLE_UNMET_MOMENTUM, 'BLOCKING', [], { momentum: fundamentals.momentum }));
  if (!technicalMet) reasons.push(qvReason(QV_REASON.LIFECYCLE_UNMET_TECHNICAL, 'CONCERN', [], { technical: technical.result }));
  if (!riskMet) reasons.push(qvReason(QV_REASON.LIFECYCLE_UNMET_RISK, 'BLOCKING'));

  if (valuationMet && growthMet && momentumMet && technicalMet && riskMet) {
    return technical.result === 'RECOVERING' ? state('ACTIONABLE', 'SUPPORTS') : state('SETUP', 'SUPPORTS');
  }

  // 5. WATCH: quality passes and the thesis is intact (not DETERIORATING on growth or momentum) -- assumption A8.
  if (fundamentals.growthAdjusted !== 'DETERIORATING' && fundamentals.momentum !== 'DETERIORATING') return state('WATCH', 'INFORMATIONAL');

  // 6. Everything else.
  return state('DISCOVERED', 'INFORMATIONAL');
}

/** Evaluates one symbol under QV-v1.0 with explicit lifecycle context. Pure and deterministic. */
export function evaluateQv(input: StrategyInput, context: QvLifecycleContext): StrategyEvaluation {
  const domains = assessQvDomains(input);
  const result = classify(domains, context);

  const required: string[] = [];
  const critical: string[] = [];
  [domains.quality, domains.valuation, domains.fundamentals, domains.technical].forEach((component) => {
    component.requiredMetricIds.forEach((id) => required.push(id));
    component.blockingMetricIds.forEach((id) => critical.push(id));
  });

  const reasonCodes = normalizeReasons(
    result.reasons
      .concat(domains.quality.reasons, domains.valuation.reasons, domains.fundamentals.reasons, domains.technical.reasons, domains.risk.reasons, analystRevisionReasons(input)),
  );

  return {
    identity: QV_V1_0_IDENTITY,
    symbol: input.symbol,
    evaluatedAt: input.asOf,
    outcome: result.outcome,
    gateOutcomes: gateOutcomes(domains),
    reasonCodes,
    riskFlags: domains.risk.flags,
    rankings: {},
    dataCompleteness: summarizeDataCompleteness(input.metrics, required, critical),
  };
}

/** The registered strategy: previous state is unknown to a stateless evaluation, so a thesis break cannot invalidate here. */
export const QV_V1_0_STRATEGY: DiscoveryStrategy = Object.freeze({
  identity: QV_V1_0_IDENTITY,
  evaluate: (input: StrategyInput): StrategyEvaluation => evaluateQv(input, { previousState: null }),
});

/** A strategy bound to the candidate's current persisted state, for callers that track lifecycle (Section 45.6). */
export function createQvStrategyFor(previousState: CandidateState | null): DiscoveryStrategy {
  return Object.freeze({
    identity: QV_V1_0_IDENTITY,
    evaluate: (input: StrategyInput): StrategyEvaluation => evaluateQv(input, { previousState }),
  });
}
