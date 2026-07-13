// lib/portfolio-intelligence/evaluatePortfolioObjectives.ts
//
// PI-0001: pure, deterministic evaluator. Given a PortfolioIntelligenceContext,
// returns ranked PortfolioObjective[]. No network calls, no persistence, no
// randomness in ranking, no execution of any kind.
//
// Each rule below is independent and additive -- a position or portfolio
// condition can trigger more than one objective (e.g. a position can be both
// past 21 DTE and materially threatened). Explainability lives on the
// objective itself (rationale/evidence/concerns/impacts), not in this file's
// control flow.

import type {
  ObjectiveImpact,
  PendingOrderInput,
  PortfolioIntelligenceContext,
  PortfolioObjective,
  PortfolioObjectiveConcern,
  PortfolioObjectiveEvidence,
  PortfolioObjectivePriority,
  PortfolioObjectiveReviewTrigger,
  PortfolioObjectiveRuleId,
  PortfolioObjectiveSubject,
  PortfolioObjectiveType,
  PortfolioObjectiveUrgency,
  PortfolioPositionInput,
  PortfolioStateInput,
} from './types';
import { prioritizePortfolioObjectives } from './prioritizePortfolioObjectives';
import { defaultActionabilityForPriority } from './actionability';

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function impact(
  direction: ObjectiveImpact['direction'],
  magnitude: ObjectiveImpact['magnitude'],
  explanation: string,
  estimatedDollarValue?: number,
): ObjectiveImpact {
  return { direction, magnitude, explanation, estimatedDollarValue };
}

const NEUTRAL_IMPACT: ObjectiveImpact = {
  direction: 'neutral',
  magnitude: 'low',
  explanation: 'No material effect on this dimension.',
};

// PI-0006A: "Replace raw minute/hour durations with readable values" (e.g.
// 3649m -> 3 days, 51h -> 2 days). Used wherever this file previously
// rendered order.ageMinutes as a raw "Xm" string -- the underlying
// PendingOrderInput.ageMinutes field itself is unchanged (still the exact
// number the thresholds compare against), this only affects how it's
// displayed in title/summary/rationale/evidence text.
function humanizeMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return `${minutes}m`;
  if (minutes < 60) {
    const whole = Math.round(minutes);
    return `${whole} minute${whole === 1 ? '' : 's'}`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    const whole = Math.round(hours);
    return `${whole} hour${whole === 1 ? '' : 's'}`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

interface ObjectiveDraft {
  type: PortfolioObjectiveType;
  // PI-0003: each rule function sets its own fine-grained ruleId explicitly
  // -- no more single type->id lookup. See ruleIds.ts.
  ruleId: PortfolioObjectiveRuleId;
  title: string;
  summary: string;
  priority: PortfolioObjectivePriority;
  urgency: PortfolioObjectiveUrgency;
  confidence: number;
  source: PortfolioObjective['source'];
  subject: PortfolioObjectiveSubject;
  rationale: string;
  supportingEvidence: PortfolioObjectiveEvidence[];
  concerns: PortfolioObjectiveConcern[];
  portfolioImpact: ObjectiveImpact;
  incomeImpact: ObjectiveImpact;
  riskImpact: ObjectiveImpact;
  capitalImpact: ObjectiveImpact;
  reviewTriggers: PortfolioObjectiveReviewTrigger[];
  linkedDecisionAnalysis?: PortfolioObjective['linkedDecisionAnalysis'];
  rulesTriggered: string[];
}

function finalize(draft: ObjectiveDraft, rulesEvaluated: string[], createdAt: string): PortfolioObjective {
  return {
    id: createId('objective'),
    createdAt,
    version: 'portfolio-objective-v1',
    type: draft.type,
    ruleId: draft.ruleId,
    title: draft.title,
    summary: draft.summary,
    priority: draft.priority,
    urgency: draft.urgency,
    // PI-0004B: every producer in this file uses the priority-derived
    // default -- none of these rules have a dedicated "not yet actionable"
    // gate the way positionObjective.ts's earnings-risk branch does (see
    // evaluateThreatenedPosition's doc comment below for the one rule here
    // that's earnings-adjacent, and why it doesn't get the same date-based
    // gating this slice).
    actionability: defaultActionabilityForPriority(draft.priority),
    confidence: clamp(draft.confidence),
    status: draft.type === 'WAIT' ? 'informational' : 'active',
    source: draft.source,
    subject: draft.subject,
    rationale: draft.rationale,
    supportingEvidence: draft.supportingEvidence,
    concerns: draft.concerns,
    portfolioImpact: draft.portfolioImpact,
    incomeImpact: draft.incomeImpact,
    riskImpact: draft.riskImpact,
    capitalImpact: draft.capitalImpact,
    reviewTriggers: draft.reviewTriggers,
    linkedDecisionAnalysis: draft.linkedDecisionAnalysis,
    metadata: {
      executionAllowed: false,
      paperExecutionAllowed: false,
      rulesEvaluated,
      rulesTriggered: draft.rulesTriggered,
    },
  };
}

// ---------------------------------------------------------------------------
// Position-management rules
// ---------------------------------------------------------------------------

function evaluateThreatenedPosition(
  position: PortfolioPositionInput,
  thresholds: PortfolioIntelligenceContext['thresholds'],
): ObjectiveDraft | null {
  if (position.status !== 'open' && position.status !== 'review_required') return null;

  const materialLoss = Number.isFinite(position.openPlPct ?? NaN) && (position.openPlPct as number) <= thresholds.materialLossPct;
  const flaggedBreach = position.managementFlags.some((f) => f === 'technical_breach' || f === 'stop_triggered');
  // PI-0004B note: this function's earnings signal is a pre-computed boolean
  // (earningsWithinExpiration), not a date, so it cannot be gated against
  // DEFAULT_POSITION_MANAGEMENT_POLICY.earningsReviewWindowDays the way
  // positionObjective.ts's date-driven earnings-risk branch is. This is
  // unchanged, low-risk to leave as-is: per PI-0003's adapter, the
  // production Today's Priorities feed always calls this function with
  // positions: [] (see portfolioIntelligenceAdapter.ts's module doc), so
  // this branch is not production-reachable today -- the actual AMD-style
  // fix lives in positionObjective.ts, the function that is wired to
  // Today's Priorities. Documented here rather than silently diverging.
  const earningsRisk = position.earningsWithinExpiration && position.status === 'open';

  if (!materialLoss && !flaggedBreach && !earningsRisk) return null;

  const concerns: PortfolioObjectiveConcern[] = [];
  if (materialLoss) {
    concerns.push({
      id: 'material-loss',
      label: 'Loss stop threshold reached',
      severity: 'critical',
      explanation: `Open P/L of ${(position.openPlPct as number).toFixed(0)}% has reached or passed the ${thresholds.materialLossPct}% loss-stop threshold.`,
    });
  }
  if (flaggedBreach) {
    concerns.push({
      id: 'management-flag',
      label: 'Technical or stop condition flagged',
      severity: 'critical',
      explanation: `Position carries explicit management flag(s): ${position.managementFlags.join(', ')}.`,
    });
  }
  if (earningsRisk) {
    concerns.push({
      id: 'earnings-risk',
      label: 'Earnings inside expiration',
      severity: 'high',
      explanation: 'An earnings event falls before this position expires, adding gap risk.',
    });
  }

  const critical = materialLoss || flaggedBreach;
  // PI-0006A: one decisive primary recommendation per objective. A material
  // loss or a flagged technical/stop breach is objective evidence the
  // position should be exited; when the only concern is earnings risk (no
  // loss, no flag), the decisive call is to review the earnings plan rather
  // than a generic "review" -- matches the ticket's own example exactly.
  const primaryLabel = critical ? 'Exit Position' : 'Review Earnings Plan';

  return {
    type: 'REVIEW_THREATENED_POSITION',
    ruleId: (materialLoss || flaggedBreach) ? 'OBJ-CLOSE-LOSER' : 'OBJ-EARNINGS-RISK',
    title: `${primaryLabel}: ${position.symbol}`,
    summary: `${position.symbol} (${position.strategy}) needs review: ${concerns.map((c) => c.label.toLowerCase()).join(', ')}.`,
    priority: critical ? 'critical' : 'high',
    urgency: critical ? 'now' : 'today',
    confidence: critical ? 90 : 75,
    source: 'position',
    subject: { type: 'position', id: position.id, symbol: position.symbol, label: `${position.symbol} ${position.strategy} position` },
    rationale: `${position.symbol} is flagged for review because ${concerns.map((c) => c.explanation).join(' ')} This takes priority over new-income or portfolio-construction objectives regardless of their opportunity quality.`,
    supportingEvidence: [
      Number.isFinite(position.openPlPct ?? NaN)
        ? { id: 'open-pl', label: 'Open P/L', value: `${(position.openPlPct as number).toFixed(0)}%`, tone: (position.openPlPct as number) < 0 ? 'negative' : 'positive' }
        : undefined,
      { id: 'current-risk', label: 'Current risk', value: position.currentRisk, tone: 'warning' },
      // PI-0006A: guaranteed second evidence bullet (existing field, no new
      // calculation) so this objective always carries at least two bullets
      // even when openPlPct isn't finite (e.g. a pure flagged-breach case).
      { id: 'theoretical-max-loss', label: 'Theoretical max loss', value: position.theoreticalMaxLoss, tone: 'neutral' },
    ].filter(Boolean) as PortfolioObjectiveEvidence[],
    concerns,
    portfolioImpact: impact('negative', critical ? 'high' : 'medium', 'An unmanaged threatened position increases portfolio-level risk exposure.'),
    incomeImpact: NEUTRAL_IMPACT,
    riskImpact: impact('negative', critical ? 'high' : 'medium', 'Risk is elevated until this position is reviewed and managed.', position.currentRisk),
    capitalImpact: impact('negative', 'medium', 'Capital remains at risk in this position until it is addressed.', position.theoreticalMaxLoss),
    reviewTriggers: [
      { id: 'risk-recheck', label: 'Re-check after management action', triggerType: 'risk', explanation: 'Re-evaluate once the position is closed, rolled, or the flagged condition is resolved.' },
    ],
    linkedDecisionAnalysis: position.linkedDecisionAnalysis,
    rulesTriggered: [
      ...(materialLoss ? ['material_loss_stop'] : []),
      ...(flaggedBreach ? ['management_flag_breach'] : []),
      ...(earningsRisk ? ['earnings_within_expiration'] : []),
    ],
  };
}

function evaluateCloseForProfit(
  position: PortfolioPositionInput,
  thresholds: PortfolioIntelligenceContext['thresholds'],
): ObjectiveDraft | null {
  if (position.status !== 'open') return null;
  if (!Number.isFinite(position.pctOfMaxProfitCaptured ?? NaN)) return null;
  if ((position.pctOfMaxProfitCaptured as number) < thresholds.profitTargetPct) return null;

  const captured = position.pctOfMaxProfitCaptured as number;
  const critical = position.earningsWithinExpiration || (Number.isFinite(position.dte ?? NaN) && (position.dte as number) <= 2);

  return {
    type: 'CLOSE_FOR_PROFIT',
    ruleId: 'OBJ-CLOSE-FOR-PROFIT',
    title: `Take Profit: ${position.symbol}`,
    summary: `${position.symbol} has captured ${captured.toFixed(0)}% of max profit, at or above the ${thresholds.profitTargetPct}% target.`,
    priority: critical ? 'critical' : 'high',
    urgency: critical ? 'now' : 'today',
    confidence: 85,
    source: 'position',
    subject: { type: 'position', id: position.id, symbol: position.symbol, label: `${position.symbol} ${position.strategy} position` },
    rationale: `${position.symbol} has reached ${captured.toFixed(0)}% of max profit, clearing the ${thresholds.profitTargetPct}% profit-target convention.${critical ? ' Closing is time-sensitive because ' + (position.earningsWithinExpiration ? 'an earnings event is inside the remaining expiration window.' : `only ${position.dte} DTE remain.`) : ' There is no immediate time pressure, but the captured gain is a legitimate reason to bank it rather than hold for marginal additional decay.'}`,
    supportingEvidence: [
      { id: 'profit-captured', label: 'Max profit captured', value: `${captured.toFixed(0)}%`, tone: 'positive' },
      ...(Number.isFinite(position.dte ?? NaN) ? [{ id: 'dte', label: 'Days to expiration', value: position.dte as number, tone: (position.dte as number) <= 7 ? 'warning' : 'neutral' } as PortfolioObjectiveEvidence] : []),
      // PI-0006A: guaranteed second evidence bullet (existing field) for the
      // case where dte isn't finite.
      { id: 'capital-at-risk', label: 'Capital at risk', value: position.theoreticalMaxLoss, tone: 'neutral' },
    ],
    concerns: critical
      ? [{ id: 'time-sensitive-close', label: 'Time-sensitive', severity: 'high', explanation: position.earningsWithinExpiration ? 'Earnings risk makes delaying the close inadvisable.' : 'Very few days remain before expiration.' }]
      : [],
    portfolioImpact: impact('positive', 'medium', 'Locks in a realized gain and frees the allocated capital and risk budget.'),
    incomeImpact: impact('positive', 'low', 'Realizes the premium already earned on this position.', position.theoreticalMaxLoss),
    riskImpact: impact('positive', 'medium', 'Removes this position\'s remaining risk from the portfolio once closed.', position.currentRisk),
    capitalImpact: impact('positive', 'medium', 'Frees capital currently allocated to this position for redeployment.', position.theoreticalMaxLoss),
    reviewTriggers: [
      { id: 'profit-target', label: 'Profit target reached', triggerType: 'profit_target', threshold: `${thresholds.profitTargetPct}%`, explanation: 'This objective was generated because the configured profit-target threshold was met or exceeded.' },
    ],
    linkedDecisionAnalysis: position.linkedDecisionAnalysis,
    rulesTriggered: ['profit_target_reached'],
  };
}

function evaluateDteManagement(
  position: PortfolioPositionInput,
  thresholds: PortfolioIntelligenceContext['thresholds'],
): ObjectiveDraft | null {
  if (position.status !== 'open') return null;
  if (!Number.isFinite(position.dte ?? NaN)) return null;
  if ((position.dte as number) > thresholds.dteReviewThreshold) return null;

  const dte = position.dte as number;

  // Assignment-aware exception: a CSP where the trader is willing to own the
  // underlying is not blindly forced to close at 21 DTE -- assignment is the
  // goal, not a failure state. Still surfaced, but as a lower-priority
  // monitoring objective that explains the assignment intent rather than an
  // urgent management objective.
  if (position.strategy === 'CSP' && position.assignmentIntent === 'willing') {
    return {
      type: 'MANAGE_POSITION',
      ruleId: 'OBJ-WATCH-POSITION',
      // PI-0006A: assignment is the intended outcome here, and nothing about
      // the position is actually threatened -- "Hold Position" is the
      // decisive call, not a generic "monitor" note.
      title: `Hold Position: ${position.symbol}`,
      summary: `${position.symbol} CSP is at ${dte} DTE; assignment is the stated goal, so this is a monitoring note, not a forced close.`,
      priority: 'low',
      urgency: 'monitor',
      confidence: 80,
      source: 'position',
      subject: { type: 'position', id: position.id, symbol: position.symbol, label: `${position.symbol} CSP position` },
      rationale: `${position.symbol} has reached ${dte} DTE, which would normally trigger a management review, but the trader has marked assignment intent as willing on this CSP. Assignment is the goal for acquisition-intent CSPs, so this does not get forced-closed the way a pure income-intent position at the same DTE would be.`,
      supportingEvidence: [
        { id: 'dte', label: 'Days to expiration', value: dte, tone: 'neutral' },
        { id: 'assignment-intent', label: 'Assignment intent', value: 'Willing', tone: 'positive' },
      ],
      concerns: [],
      portfolioImpact: NEUTRAL_IMPACT,
      incomeImpact: NEUTRAL_IMPACT,
      riskImpact: impact('neutral', 'low', 'Assignment risk here is intentional, not a threat.'),
      capitalImpact: impact('neutral', 'low', 'Capital may convert to shares on assignment, which is the accepted outcome.', position.theoreticalMaxLoss),
      reviewTriggers: [
        { id: 'assignment-or-expiration', label: 'Assignment or expiration', triggerType: 'dte', explanation: 'Re-evaluate once the position is assigned or expires.' },
        { id: 'support-break', label: 'Underlying breaks technical support', triggerType: 'price', explanation: 'Reassess whether assignment remains desirable if the underlying breaks support.' },
      ],
      linkedDecisionAnalysis: position.linkedDecisionAnalysis,
      rulesTriggered: ['dte_threshold_assignment_aware_exception'],
    };
  }

  const rollReview = position.managementFlags.includes('roll_review');
  const type: PortfolioObjectiveType = rollReview ? 'ROLL_POSITION' : 'MANAGE_POSITION';
  const nearTerm = dte <= 7;
  // PI-0006A: rollReview is objective evidence (an explicit management flag)
  // that rolling specifically is the intended action, so this is the one
  // DTE-driven case that keeps a roll-specific decisive label -- "Roll
  // Position", not the retired "Roll Soon"/"candidate" framing. Without that
  // flag there is no evidence rolling (vs. closing or holding) is preferred,
  // so the decisive call is "Review Position" per PI-0006A #3.
  const primaryLabel = rollReview ? 'Roll Position' : 'Review Position';

  return {
    type,
    ruleId: rollReview ? 'OBJ-ROLL-POSITION' : 'OBJ-MANAGE-21-DTE',
    title: `${primaryLabel}: ${position.symbol}`,
    summary: `${position.symbol} (${position.strategy}) is at ${dte} DTE, at or inside the ${thresholds.dteReviewThreshold}-DTE review threshold.`,
    priority: nearTerm ? 'high' : 'medium',
    urgency: nearTerm ? 'now' : 'today',
    confidence: 80,
    source: 'position',
    subject: { type: 'position', id: position.id, symbol: position.symbol, label: `${position.symbol} ${position.strategy} position` },
    rationale: `${position.symbol} has reached ${dte} DTE, at or inside the ${thresholds.dteReviewThreshold}-DTE time-stop convention.${rollReview ? ' The position is explicitly flagged for roll review, so rolling should be evaluated as a candidate action.' : ' Review whether to close, hold, or manage the position given remaining time value and risk.'} This is a recommendation only -- no roll, close, or other position mutation is executed by this objective.`,
    supportingEvidence: [
      { id: 'dte', label: 'Days to expiration', value: dte, tone: nearTerm ? 'warning' : 'neutral' },
      ...(Number.isFinite(position.openPlPct ?? NaN) ? [{ id: 'open-pl', label: 'Open P/L', value: `${(position.openPlPct as number).toFixed(0)}%`, tone: (position.openPlPct as number) >= 0 ? 'positive' : 'negative' } as PortfolioObjectiveEvidence] : []),
      // PI-0006A: guaranteed second evidence bullet (existing field) for the
      // case where openPlPct isn't finite.
      { id: 'current-risk', label: 'Current risk', value: position.currentRisk, tone: 'neutral' },
    ],
    concerns: nearTerm ? [{ id: 'near-term-expiration', label: 'Near-term expiration', severity: 'medium', explanation: `Only ${dte} days remain, narrowing the window to act.` }] : [],
    portfolioImpact: impact('neutral', 'medium', 'Time-based review of an existing position; outcome depends on the management decision made.'),
    incomeImpact: NEUTRAL_IMPACT,
    riskImpact: impact('neutral', 'medium', 'Gamma risk typically increases as DTE shrinks; review reduces the chance of an unmanaged outcome.'),
    capitalImpact: impact('neutral', 'low', 'No capital change from the review itself.', position.theoreticalMaxLoss),
    reviewTriggers: [
      { id: 'dte-threshold', label: 'Next DTE management threshold reached', triggerType: 'dte', threshold: thresholds.dteReviewThreshold, explanation: 'This objective was generated because the position reached the configured DTE review threshold.' },
    ],
    linkedDecisionAnalysis: position.linkedDecisionAnalysis,
    rulesTriggered: [rollReview ? 'dte_threshold_roll_review' : 'dte_threshold_management_review'],
  };
}

// ---------------------------------------------------------------------------
// Portfolio-level rules
// ---------------------------------------------------------------------------

function evaluateDeployIdleCash(
  portfolio: PortfolioStateInput,
  thresholds: PortfolioIntelligenceContext['thresholds'],
): ObjectiveDraft | null {
  if (portfolio.idleCashPct < thresholds.idleCashThresholdPct) return null;
  // Only when risk/buying-power conditions actually permit deployment --
  // don't suggest putting more capital to work while already over the
  // buying-power ceiling or in a defensive drawdown state.
  if (portfolio.buyingPowerUtilizationPct >= thresholds.maxBuyingPowerUtilizationPct) return null;
  if (portfolio.currentDrawdownPct >= thresholds.defensiveDrawdownPct) return null;

  const materiallyHigh = portfolio.idleCashPct >= thresholds.idleCashThresholdPct * 2;
  const idleDollarEstimate = portfolio.netLiquidity * (portfolio.idleCashPct / 100);

  return {
    type: 'DEPLOY_IDLE_CASH',
    ruleId: 'OBJ-DEPLOY-IDLE-CASH',
    title: 'Deploy Idle Cash',
    summary: `Idle cash is ${portfolio.idleCashPct.toFixed(1)}% of net liquidity, above the ${thresholds.idleCashThresholdPct}% threshold, with room to deploy.`,
    priority: materiallyHigh ? 'high' : 'medium',
    urgency: 'this_week',
    confidence: 70,
    source: 'portfolio_state',
    subject: { type: 'portfolio', label: 'Portfolio cash allocation' },
    rationale: `Idle cash sits at ${portfolio.idleCashPct.toFixed(1)}% of net liquidity, above the ${thresholds.idleCashThresholdPct}% threshold, and buying-power utilization (${portfolio.buyingPowerUtilizationPct.toFixed(0)}%) and drawdown (${portfolio.currentDrawdownPct.toFixed(1)}%) are both within acceptable ranges to deploy more capital. This objective does not select or propose a specific trade -- opportunity discovery (screening for a qualifying candidate) is a separate step, and it is entirely valid for that step to find nothing worth deploying into today.`,
    supportingEvidence: [
      { id: 'idle-cash-pct', label: 'Idle cash', value: `${portfolio.idleCashPct.toFixed(1)}%`, tone: materiallyHigh ? 'warning' : 'neutral' },
      { id: 'bp-utilization', label: 'Buying-power utilization', value: `${portfolio.buyingPowerUtilizationPct.toFixed(0)}%`, tone: 'positive' },
    ],
    concerns: [],
    portfolioImpact: impact('positive', materiallyHigh ? 'high' : 'medium', 'Deploying idle cash improves capital efficiency if a qualifying candidate is found.'),
    incomeImpact: impact('positive', 'medium', 'Additional deployed capital is the primary lever for increasing recurring income.', idleDollarEstimate),
    riskImpact: impact('neutral', 'low', 'No risk change until an actual candidate is selected and opened.'),
    capitalImpact: impact('neutral', 'medium', 'No capital is committed by this objective alone.', idleDollarEstimate),
    reviewTriggers: [
      { id: 'idle-cash-threshold', label: 'Idle cash threshold', triggerType: 'buying_power', threshold: `${thresholds.idleCashThresholdPct}%`, explanation: 'Re-evaluate if idle cash drops back below the threshold or a qualifying candidate is deployed.' },
    ],
    rulesTriggered: ['idle_cash_above_threshold'],
  };
}

function evaluateIncreaseIncome(
  portfolio: PortfolioStateInput,
): ObjectiveDraft | null {
  if (portfolio.recurringIncomeTarget <= 0) return null;
  const deficit = portfolio.recurringIncomeTarget - portfolio.currentIncomeProduced;
  const deficitPct = (deficit / portfolio.recurringIncomeTarget) * 100;
  if (deficitPct < 20) return null; // "materially below target"
  if (portfolio.buyingPowerUtilizationPct >= 90) return null; // no risk capacity

  return {
    type: 'INCREASE_INCOME',
    ruleId: 'OBJ-INCREASE-INCOME',
    title: 'Increase Income',
    summary: `Current income is ${deficitPct.toFixed(0)}% below the recurring-income target.`,
    priority: 'medium',
    urgency: 'this_week',
    confidence: 65,
    source: 'portfolio_state',
    subject: { type: 'portfolio', label: 'Portfolio income' },
    rationale: `Current recurring income of $${portfolio.currentIncomeProduced.toFixed(0)} is ${deficitPct.toFixed(0)}% below the $${portfolio.recurringIncomeTarget.toFixed(0)} target, and buying-power capacity remains available to write additional premium-generating positions. This is capped at medium priority by design -- it must never outrank a critical threatened-position or capital-preservation objective simply because the income gap is large.`,
    supportingEvidence: [
      { id: 'income-deficit', label: 'Income deficit', value: `${deficitPct.toFixed(0)}%`, tone: 'warning' },
      { id: 'current-income', label: 'Current income', value: portfolio.currentIncomeProduced, tone: 'neutral' },
    ],
    concerns: [],
    portfolioImpact: impact('positive', 'medium', 'Closing the income gap improves the portfolio\'s progress toward its stated income goal.'),
    incomeImpact: impact('positive', 'high', 'Directly addresses the recurring-income shortfall.', deficit),
    riskImpact: impact('neutral', 'low', 'No risk change until specific candidates are selected.'),
    capitalImpact: NEUTRAL_IMPACT,
    reviewTriggers: [
      { id: 'income-target', label: 'Income target reassessment', triggerType: 'manual', explanation: 'Re-evaluate once new income-generating positions are opened or the target is revised.' },
    ],
    rulesTriggered: ['income_materially_below_target'],
  };
}

function evaluateConcentration(
  portfolio: PortfolioStateInput,
): ObjectiveDraft[] {
  const drafts: ObjectiveDraft[] = [];

  for (const [symbol, pct] of Object.entries(portfolio.symbolConcentrationPct)) {
    if (pct <= portfolio.maxSymbolConcentrationPct) continue;
    // "Materially" over the limit is this rule's existing hard-breach tier
    // (1.5x the configured limit) -- PI-0004B reuses it as the "existing
    // hard portfolio risk rule" the brief says should still force a
    // reduction recommendation even for a Wheel position. Below that tier,
    // a symbol whose concentration is primarily Wheel-intentional (strategy
    // WHEEL, assignment preference PREFER) gets Wheel-aware wording instead
    // of a plain "trim this" recommendation -- the concern and the
    // objective itself still fire either way; only the guidance changes.
    const materially = pct >= portfolio.maxSymbolConcentrationPct * 1.5;
    const wheelDominance = portfolio.symbolWheelDominance?.[symbol] ?? 0;
    const wheelManaged = !materially && wheelDominance >= 0.5;

    const rationale = wheelManaged
      ? `${symbol} exposure is ${pct.toFixed(1)}% of net liquidity, above the configured ${portfolio.maxSymbolConcentrationPct}% single-ticker limit, and is primarily driven by a position managed as a Wheel with assignment preferred. Assignment is the stated goal for that position, so this does not recommend reducing or abandoning it. Instead: continue managing the Wheel as planned, avoid opening additional ${symbol} exposure while concentration remains elevated, and direct future deployments to other symbols to diversify.`
      : `${symbol} exposure is ${pct.toFixed(1)}% of net liquidity, above the configured ${portfolio.maxSymbolConcentrationPct}% single-ticker limit. Concentration risk compounds quickly on a single-name adverse move; consider trimming, avoiding new entries on this symbol, or diversifying additional deployment elsewhere.`;

    const reviewTriggers: PortfolioObjectiveReviewTrigger[] = wheelManaged
      ? [{ id: 'wheel-concentration-recheck', label: 'New exposure or hard risk-rule breach', triggerType: 'concentration', threshold: `${portfolio.maxSymbolConcentrationPct}%`, explanation: `Re-evaluate if additional ${symbol} exposure is added, the Wheel position is closed or assigned, or exposure crosses the ${(portfolio.maxSymbolConcentrationPct * 1.5).toFixed(1)}% hard-breach tier.` }]
      : [{ id: 'concentration-limit', label: 'Concentration limit', triggerType: 'concentration', threshold: `${portfolio.maxSymbolConcentrationPct}%`, explanation: 'Re-evaluate once exposure is reduced back under the configured limit.' }];

    drafts.push({
      type: 'REDUCE_CONCENTRATION',
      ruleId: 'OBJ-REDUCE-CONCENTRATION',
      title: `Reduce Concentration: ${symbol}`,
      summary: wheelManaged
        ? `${symbol} is ${pct.toFixed(1)}% of net liquidity (Wheel-managed), above the ${portfolio.maxSymbolConcentrationPct}% single-ticker limit.`
        : `${symbol} is ${pct.toFixed(1)}% of net liquidity, above the ${portfolio.maxSymbolConcentrationPct}% single-ticker limit.`,
      priority: materially ? 'high' : 'medium',
      urgency: 'this_week',
      confidence: 85,
      source: 'portfolio_state',
      subject: { type: 'symbol', symbol, label: `${symbol} exposure` },
      rationale,
      supportingEvidence: [
        { id: 'symbol-concentration', label: 'Current vs. limit', value: `${pct.toFixed(1)}% / ${portfolio.maxSymbolConcentrationPct}%`, tone: materially ? 'negative' : 'warning' },
        // PI-0006A: guaranteed second evidence bullet, reusing the excess
        // already computed for the concern's explanation text below.
        { id: 'excess-points', label: 'Over limit by', value: `${(pct - portfolio.maxSymbolConcentrationPct).toFixed(1)} pts`, tone: materially ? 'negative' : 'warning' },
      ],
      concerns: [{ id: 'single-ticker-concentration', label: 'Single-ticker concentration', severity: materially ? 'high' : 'medium', explanation: `Exposure exceeds the configured limit by ${(pct - portfolio.maxSymbolConcentrationPct).toFixed(1)} percentage points.` }],
      portfolioImpact: wheelManaged
        ? impact('negative', materially ? 'high' : 'medium', 'Elevated single-name concentration increases portfolio-level tail risk, though it is currently the accepted cost of an intentional Wheel position rather than an unmanaged one.')
        : impact('negative', materially ? 'high' : 'medium', 'Elevated single-name concentration increases portfolio-level tail risk.'),
      incomeImpact: NEUTRAL_IMPACT,
      riskImpact: impact('negative', materially ? 'high' : 'medium', 'A single adverse move in this symbol has outsized portfolio impact at this concentration.'),
      capitalImpact: NEUTRAL_IMPACT,
      reviewTriggers,
      rulesTriggered: wheelManaged ? ['symbol_concentration_exceeded', 'wheel_assignment_preferred_exception'] : ['symbol_concentration_exceeded'],
    });
  }

  for (const [sector, pct] of Object.entries(portfolio.sectorConcentrationPct)) {
    if (pct <= portfolio.maxSectorConcentrationPct) continue;
    const materially = pct >= portfolio.maxSectorConcentrationPct * 1.5;
    drafts.push({
      type: 'REDUCE_CONCENTRATION',
      ruleId: 'OBJ-REDUCE-CONCENTRATION',
      title: `Reduce Concentration: ${sector} sector`,
      summary: `${sector} sector is ${pct.toFixed(1)}% of net liquidity, above the ${portfolio.maxSectorConcentrationPct}% sector limit.`,
      priority: materially ? 'high' : 'medium',
      urgency: 'this_week',
      confidence: 85,
      source: 'portfolio_state',
      subject: { type: 'sector', label: `${sector} sector exposure` },
      rationale: `${sector} sector exposure is ${pct.toFixed(1)}% of net liquidity, above the configured ${portfolio.maxSectorConcentrationPct}% sector limit. Sector-level concentration compounds single-name risk across correlated names.`,
      supportingEvidence: [
        { id: 'sector-concentration', label: 'Current vs. limit', value: `${pct.toFixed(1)}% / ${portfolio.maxSectorConcentrationPct}%`, tone: materially ? 'negative' : 'warning' },
        { id: 'excess-points', label: 'Over limit by', value: `${(pct - portfolio.maxSectorConcentrationPct).toFixed(1)} pts`, tone: materially ? 'negative' : 'warning' },
      ],
      concerns: [{ id: 'sector-concentration', label: 'Sector concentration', severity: materially ? 'high' : 'medium', explanation: `Exposure exceeds the configured limit by ${(pct - portfolio.maxSectorConcentrationPct).toFixed(1)} percentage points.` }],
      portfolioImpact: impact('negative', materially ? 'high' : 'medium', 'Elevated sector concentration increases exposure to correlated moves across the sector.'),
      incomeImpact: NEUTRAL_IMPACT,
      riskImpact: impact('negative', materially ? 'high' : 'medium', 'A sector-wide move has outsized portfolio impact at this concentration.'),
      capitalImpact: NEUTRAL_IMPACT,
      reviewTriggers: [{ id: 'sector-limit', label: 'Sector concentration limit', triggerType: 'concentration', threshold: `${portfolio.maxSectorConcentrationPct}%`, explanation: 'Re-evaluate once sector exposure is reduced back under the configured limit.' }],
      rulesTriggered: ['sector_concentration_exceeded'],
    });
  }

  return drafts;
}

function evaluatePreserveBuyingPower(
  portfolio: PortfolioStateInput,
  thresholds: PortfolioIntelligenceContext['thresholds'],
): ObjectiveDraft | null {
  const drawdownBreach = portfolio.currentDrawdownPct >= thresholds.defensiveDrawdownPct;
  const utilizationBreach = portfolio.buyingPowerUtilizationPct > thresholds.maxBuyingPowerUtilizationPct;

  if (!drawdownBreach && !utilizationBreach) return null;

  return {
    type: 'PRESERVE_BUYING_POWER',
    ruleId: 'OBJ-PRESERVE-BUYING-POWER',
    title: 'Preserve Buying Power',
    summary: drawdownBreach
      ? `Drawdown of ${portfolio.currentDrawdownPct.toFixed(1)}% has reached the defensive threshold.`
      : `Buying-power utilization of ${portfolio.buyingPowerUtilizationPct.toFixed(0)}% exceeds the configured limit.`,
    priority: drawdownBreach ? 'critical' : 'high',
    urgency: drawdownBreach ? 'now' : 'today',
    confidence: 90,
    source: 'portfolio_state',
    subject: { type: 'portfolio', label: 'Portfolio buying power' },
    rationale: drawdownBreach
      ? `Current drawdown of ${portfolio.currentDrawdownPct.toFixed(1)}% has reached the ${thresholds.defensiveDrawdownPct}% defensive threshold, functioning as a portfolio-level circuit breaker. New capital deployment should be avoided until drawdown recovers, regardless of how attractive any individual opportunity looks.`
      : `Buying-power utilization of ${portfolio.buyingPowerUtilizationPct.toFixed(0)}% exceeds the configured ${thresholds.maxBuyingPowerUtilizationPct}% limit. This ranks above new-deployment objectives -- preserving remaining capacity for existing-position management takes priority over opening new positions.`,
    supportingEvidence: [
      { id: 'bp-utilization', label: 'Buying-power utilization', value: `${portfolio.buyingPowerUtilizationPct.toFixed(0)}%`, tone: utilizationBreach ? 'negative' : 'neutral' },
      { id: 'drawdown', label: 'Current drawdown', value: `${portfolio.currentDrawdownPct.toFixed(1)}%`, tone: drawdownBreach ? 'negative' : 'neutral' },
    ],
    concerns: [
      ...(drawdownBreach ? [{ id: 'drawdown-circuit-breaker', label: 'Drawdown circuit breaker', severity: 'critical' as const, explanation: `Drawdown has reached or exceeded the ${thresholds.defensiveDrawdownPct}% defensive threshold.` }] : []),
      ...(utilizationBreach ? [{ id: 'bp-utilization-exceeded', label: 'Buying-power utilization exceeded', severity: 'high' as const, explanation: `Utilization exceeds the configured ${thresholds.maxBuyingPowerUtilizationPct}% limit.` }] : []),
    ],
    portfolioImpact: impact('negative', drawdownBreach ? 'high' : 'medium', 'Elevated utilization or drawdown reduces the portfolio\'s ability to absorb further adverse moves.'),
    incomeImpact: NEUTRAL_IMPACT,
    riskImpact: impact('negative', drawdownBreach ? 'high' : 'medium', 'Remaining risk capacity is reduced until this condition clears.'),
    capitalImpact: impact('negative', 'medium', 'Available capital for new deployment is constrained until this condition clears.', portfolio.availableBuyingPower),
    reviewTriggers: [
      { id: 'bp-or-drawdown-recheck', label: 'Buying power / drawdown re-check', triggerType: 'buying_power', explanation: 'Re-evaluate once utilization or drawdown returns within configured limits.' },
    ],
    rulesTriggered: [
      ...(drawdownBreach ? ['drawdown_circuit_breaker'] : []),
      ...(utilizationBreach ? ['buying_power_utilization_exceeded'] : []),
    ],
  };
}

function evaluatePendingOrder(order: PendingOrderInput, thresholds: PortfolioIntelligenceContext['thresholds']): ObjectiveDraft | null {
  const stale = order.ageMinutes > thresholds.stalePendingOrderMinutes;
  const offMarket = Number.isFinite(order.fillDistancePct ?? NaN) && (order.fillDistancePct as number) > thresholds.materialFillDistancePct;
  const flagged = order.staleOrReviewRequired || order.status === 'review_required' || order.status === 'stale';

  if (!stale && !offMarket && !flagged) return null;

  const veryStale = order.ageMinutes > thresholds.stalePendingOrderMinutes * 2;
  // PI-0006A: human-friendly durations everywhere this rule previously
  // rendered a raw minute count (e.g. "3649m" -> "3 days"). order.ageMinutes
  // itself, and the threshold comparisons above, are unchanged -- this only
  // affects display text.
  const ageHuman = humanizeMinutes(order.ageMinutes);
  const thresholdHuman = humanizeMinutes(thresholds.stalePendingOrderMinutes);

  return {
    type: 'REVIEW_PENDING_ORDER',
    ruleId: 'OBJ-REVIEW-PENDING-ORDER',
    // PI-0006A: matches the ticket's own example verbatim -- a stale, off-
    // market, or explicitly flagged working order's decisive call is to
    // replace it (cancel and resubmit at a workable price), not a generic
    // "review".
    title: `Replace Working Order: ${order.symbol}`,
    summary: `${order.symbol} ${order.strategyAction} order needs review (${order.status}, ${ageHuman} old${offMarket ? `, ${(order.fillDistancePct as number).toFixed(1)}% from fill` : ''}).`,
    priority: veryStale || flagged ? 'high' : 'medium',
    urgency: veryStale ? 'today' : 'this_week',
    confidence: 75,
    source: 'pending_order',
    subject: { type: 'pending_order', id: order.id, symbol: order.symbol, label: `${order.symbol} pending ${order.strategyAction}` },
    rationale: `The pending ${order.strategyAction} order on ${order.symbol} has been working for ${ageHuman}${offMarket ? ` and is ${(order.fillDistancePct as number).toFixed(1)}% away from a fill` : ''}, status ${order.status}. Review whether to cancel, reprice, or continue waiting -- this objective does not itself cancel or resubmit the order.`,
    supportingEvidence: [
      { id: 'order-age', label: 'Order age', value: ageHuman, tone: stale ? 'warning' : 'neutral' },
      ...(Number.isFinite(order.fillDistancePct ?? NaN) ? [{ id: 'fill-distance', label: 'Fill distance', value: `${(order.fillDistancePct as number).toFixed(1)}%`, tone: offMarket ? 'warning' : 'neutral' } as PortfolioObjectiveEvidence] : []),
      // PI-0006A: guaranteed second evidence bullet (existing field) for the
      // case where fillDistancePct isn't finite.
      { id: 'order-status', label: 'Order status', value: order.status, tone: flagged ? 'warning' : 'neutral' },
    ],
    concerns: flagged ? [{ id: 'order-flagged', label: 'Order explicitly flagged', severity: 'medium', explanation: `Order status is ${order.status}.` }] : [],
    portfolioImpact: NEUTRAL_IMPACT,
    incomeImpact: NEUTRAL_IMPACT,
    riskImpact: impact('neutral', 'low', 'An unfilled order carries no position risk, but ties up intent and possibly buying-power reservation.'),
    capitalImpact: NEUTRAL_IMPACT,
    reviewTriggers: [
      { id: 'order-age-recheck', label: 'Order age re-check', triggerType: 'order_age', threshold: thresholdHuman, explanation: 'Re-evaluate if the order fills, is cancelled, or ages further.' },
    ],
    rulesTriggered: [
      ...(stale ? ['pending_order_stale'] : []),
      ...(offMarket ? ['pending_order_off_market'] : []),
      ...(flagged ? ['pending_order_flagged'] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Ranking now lives in prioritizePortfolioObjectives.ts (PI-0003) -- this is
// the ONE ranking engine, reused by this function and by any external
// caller combining objectives from multiple sources.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const RULES_EVALUATED = [
  'threatened_position',
  'close_for_profit',
  'dte_management',
  'deploy_idle_cash',
  'increase_income',
  'concentration',
  'preserve_buying_power',
  'pending_order_review',
  'wait_fallback',
];

export function evaluatePortfolioObjectives(context: PortfolioIntelligenceContext): PortfolioObjective[] {
  const drafts: ObjectiveDraft[] = [];

  for (const position of context.positions) {
    const threatened = evaluateThreatenedPosition(position, context.thresholds);
    if (threatened) drafts.push(threatened);

    const closeForProfit = evaluateCloseForProfit(position, context.thresholds);
    if (closeForProfit) drafts.push(closeForProfit);

    const dteManagement = evaluateDteManagement(position, context.thresholds);
    if (dteManagement) drafts.push(dteManagement);
  }

  for (const order of context.pendingOrders) {
    const pendingReview = evaluatePendingOrder(order, context.thresholds);
    if (pendingReview) drafts.push(pendingReview);
  }

  drafts.push(...evaluateConcentration(context.portfolio));

  const preserveBp = evaluatePreserveBuyingPower(context.portfolio, context.thresholds);
  if (preserveBp) drafts.push(preserveBp);

  const deployIdleCash = evaluateDeployIdleCash(context.portfolio, context.thresholds);
  if (deployIdleCash) drafts.push(deployIdleCash);

  const increaseIncome = evaluateIncreaseIncome(context.portfolio);
  if (increaseIncome) drafts.push(increaseIncome);

  // PI-0003: WAIT synthesis is now centralized in prioritizePortfolioObjectives
  // (synthesizeWaitObjective) so every caller -- this function called
  // standalone, or an external adapter combining multiple objective sources
  // -- gets identical "nothing to do" behavior from one place.
  const objectives = drafts.map((draft) => finalize(draft, RULES_EVALUATED, context.generatedAt));
  return prioritizePortfolioObjectives(objectives, context.generatedAt);
}
