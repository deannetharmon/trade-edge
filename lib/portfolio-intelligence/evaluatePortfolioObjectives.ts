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
  PortfolioObjectiveSubject,
  PortfolioObjectiveType,
  PortfolioObjectiveUrgency,
  PortfolioPositionInput,
  PortfolioStateInput,
} from './types';
import { OBJECTIVE_RULE_ID } from './ruleIds';

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

interface ObjectiveDraft {
  type: PortfolioObjectiveType;
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
    ruleId: OBJECTIVE_RULE_ID[draft.type],
    title: draft.title,
    summary: draft.summary,
    priority: draft.priority,
    urgency: draft.urgency,
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

  return {
    type: 'REVIEW_THREATENED_POSITION',
    title: `Review threatened position: ${position.symbol}`,
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
    title: `Close for profit: ${position.symbol}`,
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
      title: `Monitor CSP toward assignment: ${position.symbol}`,
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

  return {
    type,
    title: `${rollReview ? 'Review roll candidate' : 'Manage position'}: ${position.symbol}`,
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
    ],
    concerns: nearTerm ? [{ id: 'near-term-expiration', label: 'Near-term expiration', severity: 'medium', explanation: `Only ${dte} days remain, narrowing the window to act.` }] : [],
    portfolioImpact: impact('neutral', 'medium', 'Time-based review of an existing position; outcome depends on the management decision made.'),
    incomeImpact: NEUTRAL_IMPACT,
    riskImpact: impact('neutral', 'medium', 'Gamma risk typically increases as DTE shrinks; review reduces the chance of an unmanaged outcome.'),
    capitalImpact: impact('neutral', 'low', 'No capital change from the review itself.', position.theoreticalMaxLoss),
    reviewTriggers: [
      { id: 'dte-threshold', label: 'DTE threshold reached', triggerType: 'dte', threshold: thresholds.dteReviewThreshold, explanation: 'This objective was generated because the position reached the configured DTE review threshold.' },
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
    title: 'Deploy idle cash',
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
    title: 'Increase recurring income',
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
    const materially = pct >= portfolio.maxSymbolConcentrationPct * 1.5;
    drafts.push({
      type: 'REDUCE_CONCENTRATION',
      title: `Reduce concentration: ${symbol}`,
      summary: `${symbol} is ${pct.toFixed(1)}% of net liquidity, above the ${portfolio.maxSymbolConcentrationPct}% single-ticker limit.`,
      priority: materially ? 'high' : 'medium',
      urgency: 'this_week',
      confidence: 85,
      source: 'portfolio_state',
      subject: { type: 'symbol', symbol, label: `${symbol} exposure` },
      rationale: `${symbol} exposure is ${pct.toFixed(1)}% of net liquidity, above the configured ${portfolio.maxSymbolConcentrationPct}% single-ticker limit. Concentration risk compounds quickly on a single-name adverse move; consider trimming, avoiding new entries on this symbol, or diversifying additional deployment elsewhere.`,
      supportingEvidence: [{ id: 'symbol-concentration', label: 'Current vs. limit', value: `${pct.toFixed(1)}% / ${portfolio.maxSymbolConcentrationPct}%`, tone: materially ? 'negative' : 'warning' }],
      concerns: [{ id: 'single-ticker-concentration', label: 'Single-ticker concentration', severity: materially ? 'high' : 'medium', explanation: `Exposure exceeds the configured limit by ${(pct - portfolio.maxSymbolConcentrationPct).toFixed(1)} percentage points.` }],
      portfolioImpact: impact('negative', materially ? 'high' : 'medium', 'Elevated single-name concentration increases portfolio-level tail risk.'),
      incomeImpact: NEUTRAL_IMPACT,
      riskImpact: impact('negative', materially ? 'high' : 'medium', 'A single adverse move in this symbol has outsized portfolio impact at this concentration.'),
      capitalImpact: NEUTRAL_IMPACT,
      reviewTriggers: [{ id: 'concentration-limit', label: 'Concentration limit', triggerType: 'concentration', threshold: `${portfolio.maxSymbolConcentrationPct}%`, explanation: 'Re-evaluate once exposure is reduced back under the configured limit.' }],
      rulesTriggered: ['symbol_concentration_exceeded'],
    });
  }

  for (const [sector, pct] of Object.entries(portfolio.sectorConcentrationPct)) {
    if (pct <= portfolio.maxSectorConcentrationPct) continue;
    const materially = pct >= portfolio.maxSectorConcentrationPct * 1.5;
    drafts.push({
      type: 'REDUCE_CONCENTRATION',
      title: `Reduce concentration: ${sector} sector`,
      summary: `${sector} sector is ${pct.toFixed(1)}% of net liquidity, above the ${portfolio.maxSectorConcentrationPct}% sector limit.`,
      priority: materially ? 'high' : 'medium',
      urgency: 'this_week',
      confidence: 85,
      source: 'portfolio_state',
      subject: { type: 'sector', label: `${sector} sector exposure` },
      rationale: `${sector} sector exposure is ${pct.toFixed(1)}% of net liquidity, above the configured ${portfolio.maxSectorConcentrationPct}% sector limit. Sector-level concentration compounds single-name risk across correlated names.`,
      supportingEvidence: [{ id: 'sector-concentration', label: 'Current vs. limit', value: `${pct.toFixed(1)}% / ${portfolio.maxSectorConcentrationPct}%`, tone: materially ? 'negative' : 'warning' }],
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
    title: 'Preserve buying power',
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

  return {
    type: 'REVIEW_PENDING_ORDER',
    title: `Review pending order: ${order.symbol}`,
    summary: `${order.symbol} ${order.strategyAction} order needs review (${order.status}, ${order.ageMinutes}m old${offMarket ? `, ${(order.fillDistancePct as number).toFixed(1)}% from fill` : ''}).`,
    priority: veryStale || flagged ? 'high' : 'medium',
    urgency: veryStale ? 'today' : 'this_week',
    confidence: 75,
    source: 'pending_order',
    subject: { type: 'pending_order', id: order.id, symbol: order.symbol, label: `${order.symbol} pending ${order.strategyAction}` },
    rationale: `The pending ${order.strategyAction} order on ${order.symbol} has been working for ${order.ageMinutes} minutes${offMarket ? ` and is ${(order.fillDistancePct as number).toFixed(1)}% away from a fill` : ''}, status ${order.status}. Review whether to cancel, reprice, or continue waiting -- this objective does not itself cancel or resubmit the order.`,
    supportingEvidence: [
      { id: 'order-age', label: 'Order age', value: `${order.ageMinutes}m`, tone: stale ? 'warning' : 'neutral' },
      ...(Number.isFinite(order.fillDistancePct ?? NaN) ? [{ id: 'fill-distance', label: 'Fill distance', value: `${(order.fillDistancePct as number).toFixed(1)}%`, tone: offMarket ? 'warning' : 'neutral' } as PortfolioObjectiveEvidence] : []),
    ],
    concerns: flagged ? [{ id: 'order-flagged', label: 'Order explicitly flagged', severity: 'medium', explanation: `Order status is ${order.status}.` }] : [],
    portfolioImpact: NEUTRAL_IMPACT,
    incomeImpact: NEUTRAL_IMPACT,
    riskImpact: impact('neutral', 'low', 'An unfilled order carries no position risk, but ties up intent and possibly buying-power reservation.'),
    capitalImpact: NEUTRAL_IMPACT,
    reviewTriggers: [
      { id: 'order-age-recheck', label: 'Order age re-check', triggerType: 'order_age', threshold: `${thresholds.stalePendingOrderMinutes}m`, explanation: 'Re-evaluate if the order fills, is cancelled, or ages further.' },
    ],
    rulesTriggered: [
      ...(stale ? ['pending_order_stale'] : []),
      ...(offMarket ? ['pending_order_off_market'] : []),
      ...(flagged ? ['pending_order_flagged'] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<PortfolioObjectivePriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  informational: 4,
};

const URGENCY_RANK: Record<PortfolioObjectiveUrgency, number> = {
  now: 0,
  today: 1,
  this_week: 2,
  monitor: 3,
  none: 4,
};

// Category order mirrors the stated general priority order:
//   protect capital / critical risk -> time-sensitive existing positions ->
//   harvest earned profit -> resolve pending-order problems -> improve
//   portfolio construction -> deploy capital / generate new income -> wait
const CATEGORY_RANK: Record<PortfolioObjectiveType, number> = {
  REVIEW_THREATENED_POSITION: 0,
  MANAGE_POSITION: 1,
  ROLL_POSITION: 1,
  CLOSE_FOR_PROFIT: 2,
  REVIEW_PENDING_ORDER: 3,
  REDUCE_CONCENTRATION: 4,
  PRESERVE_BUYING_POWER: 4,
  DEPLOY_IDLE_CASH: 5,
  INCREASE_INCOME: 5,
  WAIT: 6,
};

function rankObjectives(objectives: PortfolioObjective[]): PortfolioObjective[] {
  return [...objectives].sort((a, b) => {
    const priorityDelta = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priorityDelta !== 0) return priorityDelta;

    const categoryDelta = CATEGORY_RANK[a.type] - CATEGORY_RANK[b.type];
    if (categoryDelta !== 0) return categoryDelta;

    const urgencyDelta = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (urgencyDelta !== 0) return urgencyDelta;

    return b.confidence - a.confidence;
  });
}

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

  if (drafts.length === 0) {
    drafts.push({
      type: 'WAIT',
      title: 'No action required',
      summary: 'No position, order, or portfolio-level condition currently justifies action.',
      priority: 'informational',
      urgency: 'none',
      confidence: 90,
      source: 'portfolio_state',
      subject: { type: 'portfolio', label: 'Portfolio' },
      rationale: 'No open position is threatened, past its profit target, or past its DTE review threshold; no pending order needs review; concentration, buying-power utilization, drawdown, idle cash, and income are all within configured ranges. Waiting is the correct action today -- there is nothing to force.',
      supportingEvidence: [],
      concerns: [],
      portfolioImpact: NEUTRAL_IMPACT,
      incomeImpact: NEUTRAL_IMPACT,
      riskImpact: NEUTRAL_IMPACT,
      capitalImpact: NEUTRAL_IMPACT,
      reviewTriggers: [
        { id: 'next-evaluation', label: 'Next portfolio evaluation', triggerType: 'manual', explanation: 'Re-evaluate on the next scheduled portfolio review or when portfolio/position/order data changes.' },
      ],
      rulesTriggered: ['no_conditions_met'],
    });
  }

  const objectives = drafts.map((draft) => finalize(draft, RULES_EVALUATED, context.generatedAt));
  return rankObjectives(objectives);
}
