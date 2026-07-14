// lib/portfolio-intelligence/managementIntent.ts
//
// PI-0006B: Intent-Based Recommendation Engine.
//
// This is the one canonical selector behind every position/order/cash
// recommendation Portfolio Intelligence produces. It replaces PI-0006A's
// static per-kind label lookup (LABEL_BY_KIND) with an evidence-based
// scoring pass over a *relevant set* of management intents -- the same
// evidence positionObjective.ts / evaluatePortfolioObjectives.ts already
// compute (DTE, P/L, buffer, health score, earnings, net edge, technical
// trend, strategy, assignment preference, explicit roll flags), no new
// calculations, no new market-data integrations.
//
// Design notes:
//   - `context` selects the *relevant* intent set (ticket #2) -- an idle-cash
//     objective is never scored against Cut Losses, a pending order is never
//     scored against Take Profit. Irrelevant intents simply aren't part of
//     the candidate pool for that context.
//   - Scoring is additive, small-integer points per confirmed signal (the
//     same "factor -> scoreImpact" pattern this codebase already uses for
//     health scoring, see health/factors.ts) -- not a new financial formula,
//     just a documented way to combine several already-true/false and
//     already-computed signals into one ranked decision.
//   - HOLD_POSITION and (where relevant) ROLL_POSITION always carry a small
//     baseline score, so both are always *present* as candidates -- Hold as
//     the correct default when evidence is genuinely weak or mixed, and Roll
//     as the ticket's required "secondary alternative" even when nothing
//     promotes it to primary (see requirement #5). Roll only wins outright
//     when `rollFlagged` is true -- an explicit roll_review management flag
//     is the one form of roll-specific evidence this codebase has.
//   - CUT_LOSSES only fires from an actual loss-policy breach (materialLoss /
//     weakHealthLoss) or a confirmed adverse trend -- never from DTE alone,
//     and never from "assignment risk" alone (see the assignment-preference
//     override below, and requirement #7's Wheel example).
//   - REDUCE_RISK is the "something needs de-risking but this isn't
//     necessarily a full exit" bucket -- tight/ITM buffer and net-edge decay
//     land here, distinct from CUT_LOSSES per requirement #6.

import type { AssignmentPreference, PositionStrategy } from './types';

export type ManagementIntent =
  | 'HOLD_POSITION'
  | 'TAKE_PROFIT'
  | 'CUT_LOSSES'
  | 'REDUCE_RISK'
  | 'ROLL_POSITION'
  | 'ACCEPT_ASSIGNMENT'
  | 'REPLACE_WORKING_ORDER'
  | 'DEPLOY_IDLE_CASH';

// Canonical, decisive display text for each intent -- the one place this
// mapping is defined. Every consumer (Portfolio Briefing, Today's
// Priorities, Position Intelligence) renders whichever label the winning
// intent carries; none of them hardcode intent-specific copy.
export const MANAGEMENT_INTENT_LABEL: Record<ManagementIntent, string> = {
  HOLD_POSITION: 'Hold Position',
  TAKE_PROFIT: 'Take Profit',
  CUT_LOSSES: 'Cut Losses',
  REDUCE_RISK: 'Reduce Risk',
  ROLL_POSITION: 'Roll Position',
  ACCEPT_ASSIGNMENT: 'Accept Assignment',
  REPLACE_WORKING_ORDER: 'Replace Working Order',
  DEPLOY_IDLE_CASH: 'Deploy Idle Cash',
};

// Existing "trend vs. strategy" alignment concept (already computed on the
// Portfolio page as trendAgainst/trendAligns) -- not a new indicator, just
// named and typed so it can be passed into this engine when available.
export type TechnicalAlignment = 'aligned' | 'against' | 'neutral' | 'unknown';

export type ManagementIntentContext =
  | 'credit-spread'
  | 'wheel-csp'
  | 'covered-call'
  | 'other-position'
  | 'pending-order'
  | 'idle-cash';

// Ticket #2's "Relevant Intent Set" examples, verbatim.
const RELEVANT_INTENTS: Record<ManagementIntentContext, ManagementIntent[]> = {
  'credit-spread': ['HOLD_POSITION', 'TAKE_PROFIT', 'CUT_LOSSES', 'REDUCE_RISK', 'ROLL_POSITION'],
  'wheel-csp': ['HOLD_POSITION', 'TAKE_PROFIT', 'ACCEPT_ASSIGNMENT', 'ROLL_POSITION', 'CUT_LOSSES'],
  'covered-call': ['HOLD_POSITION', 'TAKE_PROFIT', 'ACCEPT_ASSIGNMENT', 'ROLL_POSITION', 'REDUCE_RISK'],
  'other-position': ['HOLD_POSITION', 'TAKE_PROFIT', 'CUT_LOSSES', 'REDUCE_RISK'],
  'pending-order': ['REPLACE_WORKING_ORDER', 'HOLD_POSITION'],
  'idle-cash': ['DEPLOY_IDLE_CASH', 'HOLD_POSITION'],
};

// All evidence fields are optional -- every one of them is something the
// caller may or may not currently have computed. Absence just means that
// signal doesn't contribute to scoring; it is never treated as a negative
// signal.
export interface ManagementIntentEvidence {
  context: ManagementIntentContext;

  // Already-normalized position signals (same values positionObjective.ts /
  // evaluatePortfolioObjectives.ts already compute for their own trigger
  // checks).
  dte?: number | null;
  pnlPct?: number | null;

  // Existing policy checks, evaluated by the caller against its own
  // threshold set (DEFAULT_POSITION_MANAGEMENT_POLICY / PortfolioRiskPolicy)
  // -- this module does not read policy thresholds itself, it only reacts
  // to whether they were already breached.
  materialLoss?: boolean;
  weakHealthLoss?: boolean;
  itmOrCriticalBuffer?: boolean;
  profitTargetReached?: boolean;
  meaningfulUnprotectedProfit?: boolean; // existing "profit but no working GTC" signal

  // Earnings: whether an earnings event is inside the actionable review
  // window. true = inside window (actionable), false = outside (existing
  // actionability gating already keeps this out of Today's Priorities),
  // undefined/null = no earnings risk detected at all.
  earningsActionable?: boolean | null;

  // The one form of roll-specific evidence this codebase has today -- an
  // explicit roll_review management flag.
  rollFlagged?: boolean;

  // Strategy awareness (ticket #7).
  assignmentIntent?: 'willing' | 'unwilling' | 'neutral' | null;
  assignmentPreference?: AssignmentPreference | null;
  positionStrategy?: PositionStrategy | null;

  // Net edge / technical context (ticket's Scope explicitly lists these as
  // existing inputs to use where available). Both optional: most call sites
  // in this V1 do not yet have technicalAlignment wired through (see
  // PI-0006B implementation report), and some don't have net edge either.
  netEdgeDeclinePct?: number | null; // % below peak net edge, e.g. -30 = 30% off peak
  netEdgeNegative?: boolean | null;
  technicalAlignment?: TechnicalAlignment | null;

  // Pending-order / idle-cash contexts: the caller's existing trigger has
  // already fired by the time this runs (these rules are only invoked when
  // their own condition is true), so these are simple confirmations.
  orderNeedsReplacement?: boolean;
  idleCashDeployable?: boolean;
}

export interface ManagementIntentCandidate {
  intent: ManagementIntent;
  label: string;
  score: number;
  reasons: string[];
}

export interface ManagementIntentResult {
  intent: ManagementIntent;
  label: string;
  reasons: string[];
  // Ranked, excludes the winner. Always includes Roll Position when it was
  // part of the relevant set and didn't win (ticket #5).
  alternatives: ManagementIntentCandidate[];
}

interface ScoreEntry {
  score: number;
  reasons: string[];
}

function bump(scores: Partial<Record<ManagementIntent, ScoreEntry>>, intent: ManagementIntent, points: number, reason?: string): void {
  const current = scores[intent] ?? { score: 0, reasons: [] };
  current.score += points;
  if (reason) current.reasons.push(reason);
  scores[intent] = current;
}

function scoreCandidates(evidence: ManagementIntentEvidence): Partial<Record<ManagementIntent, ScoreEntry>> {
  const scores: Partial<Record<ManagementIntent, ScoreEntry>> = {};

  // Baselines -- ensure Hold Position (always) and Roll Position (when
  // relevant to this context) are present as candidates even with zero
  // confirming evidence, so Hold wins by default and Roll always surfaces
  // as an alternative rather than disappearing entirely.
  bump(scores, 'HOLD_POSITION', 10);
  if (RELEVANT_INTENTS[evidence.context].includes('ROLL_POSITION')) {
    bump(scores, 'ROLL_POSITION', 5);
  }

  if (evidence.profitTargetReached) {
    bump(scores, 'TAKE_PROFIT', 100, 'Profit target has been reached.');
  } else if (evidence.meaningfulUnprotectedProfit) {
    bump(scores, 'TAKE_PROFIT', 40, 'Position has meaningful profit but no working profit-target order.');
  }

  if (evidence.materialLoss) {
    bump(scores, 'CUT_LOSSES', 100, 'Loss has reached the policy loss-stop threshold.');
  } else if (evidence.weakHealthLoss) {
    bump(scores, 'CUT_LOSSES', 70, 'Loss is material and the health score is weak.');
  }

  if (evidence.itmOrCriticalBuffer) {
    bump(scores, 'REDUCE_RISK', 60, 'Strike buffer is tight or the position is in the money.');
    bump(scores, 'CUT_LOSSES', 20);
  }

  if (evidence.netEdgeDeclinePct != null && evidence.netEdgeDeclinePct <= -25) {
    bump(scores, 'REDUCE_RISK', 40, `Net edge has declined ${Math.abs(evidence.netEdgeDeclinePct).toFixed(0)}% from its peak.`);
  }
  if (evidence.netEdgeNegative) {
    bump(scores, 'REDUCE_RISK', 30, 'Net edge is negative -- remaining premium no longer compensates for gamma risk.');
    bump(scores, 'CUT_LOSSES', 15);
  }

  if (evidence.technicalAlignment === 'against') {
    bump(scores, 'CUT_LOSSES', 30, 'Recent technical trend is running against the position.');
    bump(scores, 'REDUCE_RISK', 20);
  } else if (evidence.technicalAlignment === 'aligned') {
    bump(scores, 'HOLD_POSITION', 30, 'Recent technical trend confirms the position.');
  }

  if (evidence.rollFlagged) {
    bump(scores, 'ROLL_POSITION', 100, 'Position is explicitly flagged for roll review.');
  }

  if (evidence.orderNeedsReplacement) {
    bump(scores, 'REPLACE_WORKING_ORDER', 100, 'The working order is stale, off-market, or explicitly flagged for review.');
  }
  if (evidence.idleCashDeployable) {
    bump(scores, 'DEPLOY_IDLE_CASH', 100, 'Idle cash is above the deployment threshold and risk conditions allow deploying more.');
  }

  // Strategy awareness (ticket #7): assignment preference/intent can promote
  // Accept Assignment for Wheel-style positions, but never suppresses a
  // material-loss-driven Cut Losses -- a hard loss-policy breach is exactly
  // the "hard-risk policy" exception the ticket's NVDA scenario allows for.
  if (evidence.context === 'wheel-csp' || evidence.context === 'covered-call') {
    if (evidence.assignmentPreference === 'PREFER' || evidence.assignmentIntent === 'willing') {
      bump(scores, 'ACCEPT_ASSIGNMENT', 90, 'Assignment is the stated goal for this position.');
    }
  }

  // Earnings context never gets its own intent -- it raises the stakes on
  // whichever intent the evidence above already supports (or Hold Position
  // via baseline if nothing else does), and always attaches an explanatory
  // reason so the trader knows earnings is a live factor.
  if (evidence.earningsActionable) {
    const leader = (Object.entries(scores) as [ManagementIntent, ScoreEntry][])
      .sort((a, b) => b[1].score - a[1].score)[0]?.[0] ?? 'HOLD_POSITION';
    bump(scores, leader, 0, 'Earnings fall before expiration, inside the review window.');
  }

  return scores;
}

// Fixed tie-break order when two intents score identically -- most severe /
// most specific first, Hold Position last (a tie should resolve toward the
// more decisive, evidence-backed choice, not the default).
const INTENT_TIE_BREAK_ORDER: ManagementIntent[] = [
  'CUT_LOSSES',
  'ACCEPT_ASSIGNMENT',
  'TAKE_PROFIT',
  'REDUCE_RISK',
  'ROLL_POSITION',
  'REPLACE_WORKING_ORDER',
  'DEPLOY_IDLE_CASH',
  'HOLD_POSITION',
];

// The one canonical selector (ticket #3). Pure and deterministic: same
// evidence always produces the same winner, same reasons, same alternatives.
export function selectManagementIntent(evidence: ManagementIntentEvidence): ManagementIntentResult {
  const relevant = RELEVANT_INTENTS[evidence.context];
  const scored = scoreCandidates(evidence);

  const candidates: ManagementIntentCandidate[] = relevant
    .filter((intent) => (scored[intent]?.score ?? 0) > 0)
    .map((intent) => ({
      intent,
      label: MANAGEMENT_INTENT_LABEL[intent],
      score: scored[intent]!.score,
      reasons: scored[intent]!.reasons,
    }));

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return INTENT_TIE_BREAK_ORDER.indexOf(a.intent) - INTENT_TIE_BREAK_ORDER.indexOf(b.intent);
  });

  const [winner, ...alternatives] = candidates;

  return {
    intent: winner.intent,
    label: winner.label,
    reasons: winner.reasons.slice(0, 4),
    alternatives: alternatives.slice(0, 3),
  };
}
