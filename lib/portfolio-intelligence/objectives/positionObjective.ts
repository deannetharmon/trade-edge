// lib/portfolio-intelligence/objectives/positionObjective.ts
//
// PI-0002: TE-0006B (Portfolio Recommendation Rules) consolidated into the
// canonical lib/portfolio-intelligence model. This is the single source of
// truth for per-position recommendation logic going forward -- the old
// features/portfolio/recommendations/* files are now thin re-export shims
// over this module.
//
// Design decision (documented per PI-0002's "use judgment" instruction):
// this function returns BOTH a canonical `objective: PortfolioObjective |
// null` AND a `legacyRecommendation: PortfolioRecommendation` from a single
// shared evaluation pass, rather than deriving one from the other:
//   - `legacyRecommendation` preserves the EXACT trigger conditions,
//     thresholds, and wording TE-0006B already had in production, so
//     PositionRecommendationBadge, DailyPriorityList, and the priorities
//     engine keep receiving byte-for-byte the same shape and values they
//     did before this refactor -- zero user-visible behavior change.
//   - `objective` is the new canonical PortfolioObjective, using the ten
//     stable rule IDs from ruleIds.ts. It is null for the "hold" case,
//     matching evaluatePortfolioObjectives' existing philosophy that a
//     healthy position with nothing to act on simply doesn't get an
//     objective, rather than always emitting a "nothing to do" entry.
//
// Several legacy recommendation "kinds" (assignment-risk, close-loser,
// earnings-risk) all map to the single REVIEW_THREATENED_POSITION /
// OBJ-REVIEW-THREATENED-POSITION canonical type -- there is no dedicated
// stable ID per fine-grained trigger, by design (see ruleIds.ts). Likewise
// place-gtc, let-expire, and watch all map to MANAGE_POSITION /
// OBJ-MANAGE-21-DTE even though not all of them are DTE-driven -- the ten
// stable IDs given are exhaustive and this function does not invent an
// eleventh. The specific triggering condition is preserved in `title`,
// `rationale`, and `metadata.rulesTriggered` on the objective, and in
// `kind` on the legacy recommendation (unchanged).
//
// This module does NOT go through evaluatePortfolioObjectives()'s own
// REVIEW_THREATENED_POSITION / CLOSE_FOR_PROFIT / MANAGE_POSITION rules --
// those operate on the portfolio-level PortfolioPositionInput shape with
// their own (differently-tuned) default thresholds, used by the batch
// evaluator. This function has its own thresholds, matching TE-0006B
// exactly, because that is what "no user-visible behavior changes" requires
// for the Portfolio page's existing per-position cards. Reconciling the two
// threshold sets into one is explicitly deferred -- see
// planning/SPRINT3_PI0002_PLAN.md "Later items".

import type {
  ObjectiveImpact,
  PortfolioObjective,
  PortfolioObjectiveActionability,
  PortfolioObjectiveConcern,
  PortfolioObjectiveEvidence,
  PortfolioObjectiveReviewTrigger,
  PortfolioObjectiveRuleId,
  PositionStrategy,
  AssignmentPreference,
} from '../types';
import type { PositionHealthScore } from '../health/types';
import { DEFAULT_POSITION_MANAGEMENT_POLICY } from '../policies';
import { defaultActionabilityForPriority } from '../actionability';

export type PortfolioRecommendationKind =
  | 'hold'
  | 'watch'
  | 'close-winner'
  | 'close-loser'
  | 'roll-soon'
  | 'place-gtc'
  | 'let-expire'
  | 'earnings-risk'
  | 'assignment-risk';

export type PortfolioRecommendationUrgency = 'low' | 'medium' | 'high' | 'critical';

export interface PortfolioRecommendation {
  positionId: string;
  symbol: string;
  kind: PortfolioRecommendationKind;
  label: string;
  urgency: PortfolioRecommendationUrgency;
  confidence: number;
  primaryReason: string;
  supportingReasons: string[];
  suggestedAction: string;
  computedAt: string;
}

export interface PositionObjectiveInput {
  positionId?: string;
  key?: string;
  symbol: string;
  strategy?: string | null;
  dte?: number | null;
  pnlPct?: number | null;
  pnl?: number | null;
  creditReceived?: number | null;
  hitTarget?: boolean | null;
  needsClose?: boolean | null;
  hasGtc?: boolean | null;
  buffer?: number | null;
  earningsDate?: string | null;
  expDate?: string | null;
  healthScore?: PositionHealthScore | null;
  // PI-0004B: optional, independent fields -- see PositionStrategy /
  // AssignmentPreference doc comments in types.ts. Not yet read by any
  // branch in this file (Wheel-awareness for PI-0004B lives in the
  // portfolio-level concentration rule, not per-position evaluation --
  // see evaluatePortfolioObjectives.ts's evaluateConcentration()); accepted
  // here for type-level consistency and forward extension.
  positionStrategy?: PositionStrategy | null;
  assignmentPreference?: AssignmentPreference | null;
}

// -- helpers, moved verbatim from recommendation-rules.ts (behavior-critical, unchanged) --

function normalizePositionObjectivePct(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function hasHealthFactor(input: PositionObjectiveInput, key: string): boolean {
  return Boolean(input.healthScore?.factors?.some((f) => f.key === key));
}

function daysUntil(dateString: string | null | undefined, now: Date = new Date()): number | null {
  if (!dateString) return null;
  const target = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function isUpcomingBeforeExpiration(
  dateString: string | null | undefined,
  expDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const days = daysUntil(dateString, now);
  if (days == null || days < 0) return false;
  if (!expDate) return true;
  const date = new Date(`${dateString}T00:00:00`);
  const expiry = new Date(`${expDate}T23:59:59`);
  if (Number.isNaN(date.getTime()) || Number.isNaN(expiry.getTime())) return false;
  return date <= expiry;
}

function isShortPremiumStrategy(strategy: string | null | undefined): boolean {
  const normalized = String(strategy ?? '').toUpperCase();
  return (
    ['BPS', 'BCS', 'IC', 'PUT', 'CALL'].includes(normalized) ||
    normalized.includes('CSP') ||
    normalized.includes('SPREAD') ||
    normalized.includes('SHORT')
  );
}

function makeLegacyRecommendation(
  input: PositionObjectiveInput,
  kind: PortfolioRecommendationKind,
  label: string,
  urgency: PortfolioRecommendationUrgency,
  confidence: number,
  primaryReason: string,
  suggestedAction: string,
  supportingReasons: string[] = [],
  now: Date = new Date(),
): PortfolioRecommendation {
  return {
    positionId: input.positionId ?? input.key ?? `${input.symbol}-${input.expDate ?? 'unknown'}`,
    symbol: input.symbol,
    kind,
    label,
    urgency,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    primaryReason,
    supportingReasons,
    suggestedAction,
    computedAt: now.toISOString(),
  };
}

// Maps a legacy urgency directly onto a PortfolioObjective priority. `watch`
// and `hold` never reach here at 'critical' or 'high' -- those tiers are
// reserved for the genuinely time-sensitive legacy kinds, preserved as-is.
const URGENCY_TO_PRIORITY: Record<PortfolioRecommendationUrgency, PortfolioObjective['priority']> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

const URGENCY_TO_OBJECTIVE_URGENCY: Record<PortfolioRecommendationUrgency, PortfolioObjective['urgency']> = {
  critical: 'now',
  high: 'today',
  medium: 'this_week',
  low: 'monitor',
};

const KIND_TO_TYPE: Record<Exclude<PortfolioRecommendationKind, 'hold'>, PortfolioObjective['type']> = {
  'assignment-risk': 'REVIEW_THREATENED_POSITION',
  'close-loser': 'REVIEW_THREATENED_POSITION',
  'earnings-risk': 'REVIEW_THREATENED_POSITION',
  'close-winner': 'CLOSE_FOR_PROFIT',
  'roll-soon': 'MANAGE_POSITION',
  'place-gtc': 'MANAGE_POSITION',
  'let-expire': 'MANAGE_POSITION',
  watch: 'MANAGE_POSITION',
};

// PI-0003: each legacy kind now gets its own fine-grained rule ID, instead
// of collapsing to one ID per type (PI-0002's interim approach, which this
// resolves -- see PI-0002 plan doc "OBJ-MANAGE-21-DTE now covers some
// non-DTE-driven cases" for the naming tension this fixes).
const KIND_TO_RULE_ID: Record<Exclude<PortfolioRecommendationKind, 'hold'>, PortfolioObjectiveRuleId> = {
  'assignment-risk': 'OBJ-ASSIGNMENT-RISK',
  'close-loser': 'OBJ-CLOSE-LOSER',
  'earnings-risk': 'OBJ-EARNINGS-RISK',
  'close-winner': 'OBJ-CLOSE-FOR-PROFIT',
  'roll-soon': 'OBJ-MANAGE-21-DTE',
  'place-gtc': 'OBJ-PLACE-GTC',
  'let-expire': 'OBJ-LET-EXPIRE',
  watch: 'OBJ-WATCH-POSITION',
};

// PI-0004B: earnings-risk is the one branch with dedicated actionability
// logic -- "earnings before expiration" is a true fact the moment it's
// detected, but it isn't worth the trader's attention until it's inside the
// centralized review window (DEFAULT_POSITION_MANAGEMENT_POLICY.
// earningsReviewWindowDays). Everything else defaults to a priority-derived
// actionability (see actionability.ts's doc comment for why that's a
// sufficient proxy for every other branch).
function computeActionability(
  kind: Exclude<PortfolioRecommendationKind, 'hold'>,
  priority: PortfolioObjective['priority'],
  input: PositionObjectiveInput,
  now: Date,
): PortfolioObjectiveActionability {
  if (kind === 'earnings-risk') {
    const daysUntilEarnings = daysUntil(input.earningsDate, now);
    if (daysUntilEarnings != null && daysUntilEarnings <= DEFAULT_POSITION_MANAGEMENT_POLICY.earningsReviewWindowDays) {
      return 'REVIEW_SOON';
    }
    return 'MONITOR';
  }
  return defaultActionabilityForPriority(priority);
}

// PI-0004B: "Remove generic review triggers... replace with meaningful
// triggers when available" -- every branch below derives its trigger from
// the actual condition that fired it (the same fields/policy values already
// used to evaluate that branch), instead of the old one-size-fits-all
// "re-check on next portfolio refresh" text.
function buildReviewTriggers(
  kind: Exclude<PortfolioRecommendationKind, 'hold'>,
  input: PositionObjectiveInput,
): PortfolioObjectiveReviewTrigger[] {
  switch (kind) {
    case 'assignment-risk':
      return [{
        id: 'assignment-or-buffer-recovery', label: 'Assignment or buffer recovery', triggerType: 'risk',
        explanation: 'Re-evaluate upon assignment, or if the strike buffer recovers above the critical threshold before expiration.',
      }];
    case 'close-loser':
      return [{
        id: 'position-managed', label: 'Position closed or rolled', triggerType: 'risk',
        explanation: 'Re-evaluate once the position is closed, rolled, or the loss no longer meets the loss-stop threshold.',
      }];
    case 'earnings-risk':
      return [{
        id: 'review-before-earnings', label: 'Review before earnings', triggerType: 'earnings',
        threshold: input.earningsDate ?? undefined,
        explanation: 'Decide whether to close, reduce risk, or intentionally hold through earnings before the earnings date arrives.',
      }];
    case 'close-winner':
      return [{
        id: 'close-or-gtc-fill', label: 'Close confirmed or GTC fills', triggerType: 'profit_target',
        threshold: `${DEFAULT_POSITION_MANAGEMENT_POLICY.profitTargetPct}%`,
        explanation: 'Re-evaluate once the position is closed or the profit-target GTC order fills.',
      }];
    case 'roll-soon':
      return [{
        id: 'dte-review-window', label: 'Review as DTE decreases', triggerType: 'dte',
        threshold: DEFAULT_POSITION_MANAGEMENT_POLICY.dteReviewThreshold,
        explanation: 'Finalize the close, roll, or hold decision as DTE continues to decrease toward the near-term management window.',
      }];
    case 'place-gtc':
      return [{
        id: 'gtc-confirmed', label: 'GTC order confirmed working', triggerType: 'manual',
        explanation: 'Re-evaluate once a profit-target GTC order is placed and confirmed working.',
      }];
    case 'let-expire':
      return [{
        id: 'strike-buffer-below-policy', label: 'Strike buffer falls below policy', triggerType: 'price',
        threshold: '2%',
        explanation: 'Re-evaluate if the strike buffer erodes toward the critical threshold before expiration.',
      }];
    case 'watch':
      return [{
        id: 'health-score-threshold', label: 'Health score crosses policy threshold', triggerType: 'risk',
        threshold: DEFAULT_POSITION_MANAGEMENT_POLICY.watchHealthScoreThreshold,
        explanation: 'Re-evaluate if the health score moves back above the watch threshold, or deteriorates further.',
      }];
  }
}

// PI-0004B: portfolioImpact/incomeImpact were previously identical
// boilerplate across every branch ("Consolidated from the per-position
// recommendation engine..." / "No direct income impact modeled..."). Each
// kind now gets an impact statement grounded in what that specific
// recommendation actually means -- riskImpact/capitalImpact were already
// reasonably kind-aware and are left as-is.
function buildPortfolioAndIncomeImpact(
  kind: Exclude<PortfolioRecommendationKind, 'hold'>,
): { portfolioImpact: ObjectiveImpact; incomeImpact: ObjectiveImpact } {
  switch (kind) {
    case 'assignment-risk':
      return {
        portfolioImpact: { direction: 'negative', magnitude: 'high', explanation: 'Leaving this unreviewed risks an unplanned assignment or a breach beyond the strike buffer before expiration.' },
        incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'Income effect depends on how assignment, close, or roll is resolved -- not yet determined.' },
      };
    case 'close-loser':
      return {
        portfolioImpact: { direction: 'negative', magnitude: 'high', explanation: 'The loss is already incurred whether or not it is closed -- reviewing now limits further downside from an unmanaged position.' },
        incomeImpact: { direction: 'negative', magnitude: 'medium', explanation: 'Closing or rolling at a loss reduces net income for the period.' },
      };
    case 'earnings-risk':
      return {
        portfolioImpact: { direction: 'negative', magnitude: 'medium', explanation: 'An earnings gap before expiration adds event risk beyond normal theta decay.' },
        incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'No income change from monitoring alone; effect depends on whether the position is closed, reduced, or intentionally held through earnings.' },
      };
    case 'close-winner':
      return {
        portfolioImpact: { direction: 'positive', magnitude: 'medium', explanation: 'Closing locks in the captured gain and frees the allocated capital and risk budget for redeployment.' },
        incomeImpact: { direction: 'positive', magnitude: 'medium', explanation: 'Realizes the premium already earned on this position.' },
      };
    case 'roll-soon':
      return {
        portfolioImpact: { direction: 'neutral', magnitude: 'medium', explanation: 'Time-based review of an existing position; outcome depends on whether it is closed, rolled, or held to expiration.' },
        incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'Rolling can extend income collection and closing realizes it now -- no income change from the review itself.' },
      };
    case 'place-gtc':
      return {
        portfolioImpact: { direction: 'neutral', magnitude: 'low', explanation: 'Placing a GTC order does not change the position itself, only how the existing profit target gets captured.' },
        incomeImpact: { direction: 'positive', magnitude: 'low', explanation: 'Protects the profit already accrued from being given back if the position reverses before it is otherwise managed.' },
      };
    case 'let-expire':
      return {
        portfolioImpact: { direction: 'neutral', magnitude: 'low', explanation: 'Letting a healthy, near-expiration position decay to zero is the intended outcome here, not a risk needing intervention.' },
        incomeImpact: { direction: 'positive', magnitude: 'low', explanation: 'Full remaining premium is retained if the position expires as expected.' },
      };
    case 'watch':
      return {
        portfolioImpact: { direction: 'neutral', magnitude: 'medium', explanation: 'No immediate action is required, but the flagged factors are worth monitoring before they compound.' },
        incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'No income change from monitoring alone.' },
      };
  }
}

function buildObjective(
  input: PositionObjectiveInput,
  legacy: PortfolioRecommendation,
  now: Date,
): PortfolioObjective {
  const kind = legacy.kind as Exclude<PortfolioRecommendationKind, 'hold'>;
  const type = KIND_TO_TYPE[kind];
  const ruleId = KIND_TO_RULE_ID[kind];
  const priority = URGENCY_TO_PRIORITY[legacy.urgency];
  const concerns: PortfolioObjectiveConcern[] = [
    {
      id: legacy.kind,
      label: legacy.label,
      severity:
        legacy.urgency === 'critical' ? 'critical' : legacy.urgency === 'high' ? 'high' : legacy.urgency === 'medium' ? 'medium' : 'low',
      explanation: legacy.primaryReason,
    },
  ];
  const supportingEvidence: PortfolioObjectiveEvidence[] = legacy.supportingReasons.map((reason, index) => ({
    id: `legacy-reason-${index}`,
    label: reason.split(':')[0] ?? 'Factor',
    tone: 'neutral',
    explanation: reason,
  }));
  const { portfolioImpact, incomeImpact } = buildPortfolioAndIncomeImpact(kind);

  return {
    id: `objective_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: now.toISOString(),
    version: 'portfolio-objective-v1',
    type,
    ruleId,
    title: `${legacy.label}: ${input.symbol}`,
    summary: legacy.primaryReason,
    priority,
    urgency: URGENCY_TO_OBJECTIVE_URGENCY[legacy.urgency],
    actionability: computeActionability(kind, priority, input, now),
    confidence: legacy.confidence,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: legacy.positionId, symbol: input.symbol, label: `${input.symbol} position` },
    rationale: `${legacy.primaryReason} ${legacy.suggestedAction}`,
    supportingEvidence,
    concerns,
    portfolioImpact,
    incomeImpact,
    riskImpact: {
      direction: legacy.kind === 'close-winner' ? 'positive' : legacy.urgency === 'critical' || legacy.urgency === 'high' ? 'negative' : 'neutral',
      magnitude: legacy.urgency === 'critical' ? 'high' : legacy.urgency === 'high' ? 'medium' : 'low',
      explanation: legacy.primaryReason,
    },
    capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: 'No capital change from generating this objective alone.' },
    reviewTriggers: buildReviewTriggers(kind, input),
    metadata: {
      executionAllowed: false,
      paperExecutionAllowed: false,
      rulesEvaluated: ['position_objective_legacy_consolidated'],
      rulesTriggered: [legacy.kind],
    },
  };
}

export interface PositionObjectiveResult {
  objective: PortfolioObjective | null;
  legacyRecommendation: PortfolioRecommendation;
}

// The single canonical evaluator for per-position recommendations. Trigger
// order and thresholds below are preserved EXACTLY from the original
// calculatePortfolioRecommendation() (TE-0006B) for parity -- do not
// reorder or retune without an explicit product decision, since Portfolio
// page cards depend on this producing identical output to before PI-0002.
export function evaluatePositionObjective(
  input: PositionObjectiveInput,
  now: Date = new Date(),
): PositionObjectiveResult {
  const dte = Number.isFinite(input.dte ?? NaN) ? Number(input.dte) : null;
  const pnlPct = normalizePositionObjectivePct(input.pnlPct);
  const buffer = normalizePositionObjectivePct(input.buffer);
  const healthScore = input.healthScore?.score ?? null;
  const strategy = String(input.strategy ?? '').toUpperCase();
  const shortPremium = isShortPremiumStrategy(strategy);

  const supportingReasons =
    input.healthScore?.factors?.slice(0, 3).map((f) => `${f.label}: ${f.message}`) ?? [];

  const criticalExpiration = dte != null && dte <= 7;
  const itmOrCriticalBuffer =
    hasHealthFactor(input, 'itm') || hasHealthFactor(input, 'buffer-critical') || (buffer != null && buffer < 2);

  let legacy: PortfolioRecommendation;

  if (shortPremium && criticalExpiration && itmOrCriticalBuffer) {
    legacy = makeLegacyRecommendation(
      input, 'assignment-risk', 'Assignment Risk', 'critical', 94,
      dte != null ? `${dte} DTE with tight or ITM strike buffer.` : 'Tight or ITM strike buffer near expiration.',
      'Review assignment, close, or roll plan before adding new risk.',
      supportingReasons, now,
    );
  } else if (pnlPct != null && pnlPct <= DEFAULT_POSITION_MANAGEMENT_POLICY.materialLossPct) {
    legacy = makeLegacyRecommendation(
      input, 'close-loser', 'Close Loser', 'critical', 91,
      `Loss is near or beyond 1x credit (${pnlPct.toFixed(0)}%).`,
      'Review closing or rolling defensively.',
      supportingReasons, now,
    );
  } else if (pnlPct != null && pnlPct <= DEFAULT_POSITION_MANAGEMENT_POLICY.weakHealthLossPct && healthScore != null && healthScore < DEFAULT_POSITION_MANAGEMENT_POLICY.weakHealthScoreThreshold) {
    legacy = makeLegacyRecommendation(
      input, 'close-loser', 'Close Loser', 'high', 84,
      `Material loss with weak health score (${healthScore}).`,
      'Review whether the thesis still holds; close or roll if risk is no longer acceptable.',
      supportingReasons, now,
    );
  } else if (isUpcomingBeforeExpiration(input.earningsDate, input.expDate, now)) {
    legacy = makeLegacyRecommendation(
      input, 'earnings-risk', 'Earnings Risk', 'high', 86,
      `Upcoming earnings before expiration (${input.earningsDate}).`,
      'Decide whether to close, reduce risk, or intentionally hold through earnings.',
      supportingReasons, now,
    );
  } else if (input.hitTarget || hasHealthFactor(input, 'profit-target') || (pnlPct != null && pnlPct >= DEFAULT_POSITION_MANAGEMENT_POLICY.profitTargetPct)) {
    legacy = makeLegacyRecommendation(
      input, 'close-winner', 'Close Winner', 'high', 90,
      pnlPct != null ? `Profit target reached at approximately ${pnlPct.toFixed(0)}% of credit.` : 'Profit target reached.',
      'Take profit or confirm the GTC target order is working.',
      supportingReasons, now,
    );
  } else if (dte != null && dte <= DEFAULT_POSITION_MANAGEMENT_POLICY.dteReviewThreshold && dte > 7 && shortPremium) {
    legacy = makeLegacyRecommendation(
      input, 'roll-soon', 'Roll Soon', 'medium', 80,
      `${dte} DTE is inside the standard management window.`,
      'Review close, roll, or let-decay plan.',
      supportingReasons, now,
    );
  } else if (shortPremium && input.hasGtc === false && pnlPct != null && pnlPct >= 20 && dte != null && dte > 14) {
    legacy = makeLegacyRecommendation(
      input, 'place-gtc', 'Place GTC', 'medium', 78,
      `Position has profit (${pnlPct.toFixed(0)}%) but no working GTC detected.`,
      'Place or verify a profit-target GTC order.',
      supportingReasons, now,
    );
  } else if (dte != null && dte <= 3 && healthScore != null && healthScore >= DEFAULT_POSITION_MANAGEMENT_POLICY.watchHealthScoreThreshold && !itmOrCriticalBuffer) {
    legacy = makeLegacyRecommendation(
      input, 'let-expire', 'Let Expire', 'low', 72,
      `${dte} DTE with healthy score and no critical buffer flag.`,
      'Monitor through expiration only if assignment risk is acceptable.',
      supportingReasons, now,
    );
  } else if ((healthScore != null && healthScore < DEFAULT_POSITION_MANAGEMENT_POLICY.watchHealthScoreThreshold) || (buffer != null && buffer < 5)) {
    legacy = makeLegacyRecommendation(
      input, 'watch', 'Watch', 'medium', 70,
      healthScore != null ? `Health score is ${healthScore}.` : 'One or more risk factors deserve attention.',
      'Monitor closely and avoid adding correlated risk.',
      supportingReasons, now,
    );
  } else {
    legacy = makeLegacyRecommendation(
      input, 'hold', 'Hold', 'low', 76,
      healthScore != null ? `Health score is ${healthScore}; no primary action rule triggered.` : 'No primary action rule triggered.',
      'Leave position alone unless market conditions or thesis change.',
      supportingReasons, now,
    );
  }

  const objective = legacy.kind === 'hold' ? null : buildObjective(input, legacy, now);

  return { objective, legacyRecommendation: legacy };
}
