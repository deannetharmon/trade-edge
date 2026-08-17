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
//
// PI-0007A: Recommendation Scorecard (observability only -- see that ticket's
// planning doc). Every `bump()` call below now records a structured
// `ScoreContribution` (stable id, human label, signed points, explanation,
// source evidence field when known) at the exact moment it adds points, so
// the Decision Scorecard never has to reconstruct "why" after the fact.
// `selectManagementIntent()`'s return value grows a full ranked `candidates`
// list (every intent in the current context's relevant set that scored above
// zero, each carrying its own contributions and an `isWinner` flag) plus
// `winnerScore` / `runnerUpIntent` / `runnerUpScore` / `margin` /
// `confidenceTier`. None of this changes which intent wins: `intent`,
// `label`, `reasons`, and `alternatives` are computed by the exact same
// filter/sort/slice logic as before PI-0007A -- the additions are purely
// supplemental fields on the same result object.
//
// PI-0008B: Decision Quality V1. Every point value scoreCandidates() uses is
// now sourced from decisionQualityMatrix.ts -- the one centralized table --
// instead of being an inline literal. Several values changed as part of this
// ticket (Net Edge deterioration, technical trend against the position, and
// gamma/DTE risk carry more weight; Health Score's one direct input,
// weakHealthLoss, carries less); see that file's doc comments for the
// reasoning behind each one. Three new evidence-driven contributions were
// added: gamma/DTE risk (scaled continuously from the existing `dte` field),
// Remaining Opportunity (PI-0008A's previously-unused-here metric), and a
// real (rather than fixed-zero) weight on earnings proximity. This module's
// selection logic, tie-break order, and confidence-tier derivation are
// otherwise unchanged -- see planning/DECISION_ENGINE_CONSTITUTION.md for the
// governing principles this reweighting was done under.

import type { AssignmentPreference, PositionStrategy } from './types';
import {
  DECISION_QUALITY_WEIGHTS as W,
  gammaDteFraction,
  scaleWeight,
} from './decisionQualityMatrix';

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

  // PI-0008A/PI-0008B: Remaining Opportunity, 0-100 -- how much of a
  // position's risk-adjusted upside genuinely remains (see
  // remainingOpportunity.ts). Optional: not every caller has computed it
  // (see evaluatePortfolioObjectives.ts's per-position rules, which do not
  // wire this through in this V1 -- absence simply means no contribution,
  // never a negative signal).
  remainingOpportunityPct?: number | null;

  // PI-0008B: 0 (just inside the earnings review window) to 1 (earnings is
  // effectively today) -- the caller's own proximity-within-window
  // computation, not a raw date (this module still does not read policy
  // thresholds or do date math itself). Only meaningful when
  // earningsActionable is true; ignored otherwise. When earningsActionable
  // is true but this is omitted, a fixed moderate fallback fraction is used
  // (see decisionQualityMatrix.ts's EARNINGS_PROXIMITY_FALLBACK_FRACTION).
  earningsProximityFraction?: number | null;

  // Pending-order / idle-cash contexts: the caller's existing trigger has
  // already fired by the time this runs (these rules are only invoked when
  // their own condition is true), so these are simple confirmations.
  orderNeedsReplacement?: boolean;
  idleCashDeployable?: boolean;
}

// PI-0007A: one recorded score contribution, captured at the exact `bump()`
// call site that added it -- never reconstructed later from `reasons` text.
export interface ScoreContribution {
  id: string;
  label: string;
  points: number;
  explanation: string;
  // The ManagementIntentEvidence field this contribution reacted to, when
  // there is a single clear source. Omitted for baseline contributions
  // (there is no evidence field for "no evidence at all").
  evidenceField?: string;
}

export interface ManagementIntentCandidate {
  intent: ManagementIntent;
  label: string;
  score: number;
  reasons: string[];
  // PI-0007A: every contribution that built this candidate's score, in the
  // order they were applied. contributions.reduce((s, c) => s + c.points, 0)
  // always equals `score`.
  contributions: ScoreContribution[];
  // PI-0007A: true only for the single candidate selectManagementIntent()
  // returned as `intent`.
  isWinner: boolean;
}

// PI-0007A: observability-only confidence label derived from the decision
// margin (winnerScore - runnerUpScore). Display metadata -- never fed back
// into scoring or intent selection.
export type ManagementIntentConfidenceTier = 'High' | 'Medium' | 'Low';

export interface ManagementIntentResult {
  intent: ManagementIntent;
  label: string;
  reasons: string[];
  // Ranked, excludes the winner. Always includes Roll Position when it was
  // part of the relevant set and didn't win (ticket #5).
  alternatives: ManagementIntentCandidate[];
  // PI-0007A: every intent from the current context's relevant set that
  // scored above zero, ranked winner-first via the exact same sort as
  // `intent`/`alternatives` (total score descending, then the existing
  // tie-break order). This is the full Decision Scorecard data set -- for
  // display only, does not change which intent is selected.
  candidates: ManagementIntentCandidate[];
  winnerScore: number;
  runnerUpIntent: ManagementIntent | null;
  runnerUpScore: number;
  // winnerScore - runnerUpScore (0 when there is no runner-up, so margin
  // simply equals winnerScore -- a lone baseline winner is correctly Low
  // confidence, not undefined/High).
  margin: number;
  confidenceTier: ManagementIntentConfidenceTier;
}

interface ScoreEntry {
  score: number;
  reasons: string[];
  contributions: ScoreContribution[];
}

// PI-0007A: `contribution.explanation` is always recorded on the entry's
// `contributions` list. It is additionally pushed onto `reasons` (the array
// that ultimately becomes the winning intent's user-facing supporting
// reasons) unless `includeInReasons` is explicitly `false` -- used for the
// small number of "linked" bumps below that piggyback on evidence another
// bump already put into `reasons` (e.g. a tight buffer's secondary nudge to
// Cut Losses), preserving PI-0006B's exact `reasons` output byte-for-byte.
// PI-0008C: Remaining Opportunity dampening. Doesn't touch the base weight
// matrix (decisionQualityMatrix.ts already has its own tuning history --
// see the "was 30"/"was 20" comments from PI-0008B) -- instead multiplies
// specific bumps at the point they're scored, so a secondary signal
// (net edge, technical trend) only carries full weight when profit-captured
// status makes it a genuine tie-breaker.
//
// Per Ian's explicit review of a real MU position: a signal that AGREES
// with what remaining opportunity already implies is never dampened -- a
// negative net edge on an 85%-captured position is reinforcing the closing
// signal, not fighting it, and should keep its full weight. Only a signal
// that would ARGUE AGAINST what remaining opportunity implies gets
// weakened:
//   - 'toward_close' signals (net edge negative, technical against) are
//     dampened when remaining opportunity is HIGH (early in the trade,
//     most reward still ahead) -- a single bad-day reading shouldn't force
//     an early exit before the thesis has had time to develop.
//   - 'toward_hold' signals (technical aligned) are dampened when
//     remaining opportunity is LOW (deep in profit already) -- "trend
//     still looks fine" isn't a strong enough reason on its own to keep
//     holding a position that's already captured most of its reward.
//   - In the ambiguous middle (between the existing low/high thresholds),
//     both directions apply at full, undampened weight -- this is exactly
//     where these signals are supposed to act as tie-breakers.
// Floor of 0.5, not 0 -- these signals should never be fully silenced,
// only weakened; a 0.5 floor is consistent with this file's existing
// preference for continuous, non-absolute scaling (see gammaDteFraction/
// scaleWeight) rather than a hard on/off cutoff.
const REMAINING_OPPORTUNITY_DAMPEN_FLOOR = 0.5;

function remainingOpportunityDampeningFactor(
  pct: number | null | undefined,
  direction: 'toward_close' | 'toward_hold',
): number {
  if (pct == null) return 1;
  if (direction === 'toward_close' && pct >= W.remainingOpportunityHighThresholdPct) {
    const fraction = Math.min(1, (pct - W.remainingOpportunityHighThresholdPct) / (100 - W.remainingOpportunityHighThresholdPct));
    return 1 - fraction * (1 - REMAINING_OPPORTUNITY_DAMPEN_FLOOR);
  }
  if (direction === 'toward_hold' && pct <= W.remainingOpportunityLowThresholdPct) {
    const fraction = Math.min(1, (W.remainingOpportunityLowThresholdPct - pct) / W.remainingOpportunityLowThresholdPct);
    return 1 - fraction * (1 - REMAINING_OPPORTUNITY_DAMPEN_FLOOR);
  }
  return 1;
}

function dampenedPoints(basePoints: number, pct: number | null | undefined, direction: 'toward_close' | 'toward_hold'): number {
  return Math.round(basePoints * remainingOpportunityDampeningFactor(pct, direction));
}

function bump(
  scores: Partial<Record<ManagementIntent, ScoreEntry>>,
  intent: ManagementIntent,
  points: number,
  contribution: {
    id: string;
    label: string;
    explanation: string;
    evidenceField?: string;
    includeInReasons?: boolean;
  },
): void {
  const current = scores[intent] ?? { score: 0, reasons: [], contributions: [] };
  current.score += points;
  current.contributions.push({
    id: contribution.id,
    label: contribution.label,
    points,
    explanation: contribution.explanation,
    evidenceField: contribution.evidenceField,
  });
  if (contribution.includeInReasons !== false) {
    current.reasons.push(contribution.explanation);
  }
  scores[intent] = current;
}

function scoreCandidates(evidence: ManagementIntentEvidence): Partial<Record<ManagementIntent, ScoreEntry>> {
  const scores: Partial<Record<ManagementIntent, ScoreEntry>> = {};

  // Baselines -- ensure Hold Position (always) and Roll Position (when
  // relevant to this context) are present as candidates even with zero
  // confirming evidence, so Hold wins by default and Roll always surfaces
  // as an alternative rather than disappearing entirely.
  bump(scores, 'HOLD_POSITION', W.holdBaseline, {
    id: 'baseline-hold', label: 'Baseline', explanation: 'Baseline', includeInReasons: false,
  });
  if (RELEVANT_INTENTS[evidence.context].includes('ROLL_POSITION')) {
    bump(scores, 'ROLL_POSITION', W.rollBaseline, {
      id: 'baseline-roll', label: 'Baseline', explanation: 'Baseline', includeInReasons: false,
    });
  }

  if (evidence.profitTargetReached) {
    bump(scores, 'TAKE_PROFIT', W.profitTargetReached, {
      id: 'profit-target-reached',
      label: 'Profit target reached',
      explanation: 'Profit target has been reached.',
      evidenceField: 'profitTargetReached',
    });
  } else if (evidence.meaningfulUnprotectedProfit) {
    bump(scores, 'TAKE_PROFIT', W.unprotectedProfit, {
      id: 'unprotected-profit',
      label: 'Unprotected profit',
      explanation: 'Position has meaningful profit but no working profit-target order.',
      evidenceField: 'meaningfulUnprotectedProfit',
    });
  }

  // PI-0008B: MATERIAL_LOSS stays a hard, undiminished policy-breach signal
  // (see decisionQualityMatrix.ts). WEAK_HEALTH_LOSS -- the one bump keyed
  // directly on Health Score -- carries less weight than before, per this
  // ticket's brief that Health Score become supporting evidence rather than
  // a dominant driver.
  if (evidence.materialLoss) {
    bump(scores, 'CUT_LOSSES', W.materialLoss, {
      id: 'material-loss',
      label: 'Material loss threshold breached',
      explanation: 'Loss has reached the policy loss-stop threshold.',
      evidenceField: 'materialLoss',
    });
  } else if (evidence.weakHealthLoss) {
    bump(scores, 'CUT_LOSSES', W.weakHealthLoss, {
      id: 'weak-health-loss',
      label: 'Weak health confirmation',
      explanation: 'Loss is material and the health score is weak.',
      evidenceField: 'weakHealthLoss',
    });
  }

  if (evidence.itmOrCriticalBuffer) {
    bump(scores, 'REDUCE_RISK', W.tightBufferReduceRisk, {
      id: 'tight-buffer-reduce-risk',
      label: 'Tight strike buffer',
      explanation: 'Strike buffer is tight or the position is in the money.',
      evidenceField: 'itmOrCriticalBuffer',
    });
    bump(scores, 'CUT_LOSSES', W.tightBufferCutLossesNudge, {
      id: 'tight-buffer-cut-losses',
      label: 'Tight/ITM buffer',
      explanation: 'Strike buffer is tight or the position is in the money, which also elevates loss risk.',
      evidenceField: 'itmOrCriticalBuffer',
      includeInReasons: false,
    });
  }

  // PI-0008B: Net Edge deterioration -- increased influence per the brief.
  if (evidence.netEdgeDeclinePct != null && evidence.netEdgeDeclinePct <= -25) {
    bump(scores, 'REDUCE_RISK', W.netEdgeDeclineReduceRisk, {
      id: 'net-edge-decline',
      label: 'Net Edge declined from peak',
      explanation: `Net edge has declined ${Math.abs(evidence.netEdgeDeclinePct).toFixed(0)}% from its peak.`,
      evidenceField: 'netEdgeDeclinePct',
    });
  }
  if (evidence.netEdgeNegative) {
    const reduceRiskPoints = dampenedPoints(W.netEdgeNegativeReduceRisk, evidence.remainingOpportunityPct, 'toward_close');
    if (reduceRiskPoints > 0) {
      bump(scores, 'REDUCE_RISK', reduceRiskPoints, {
        id: 'net-edge-negative-reduce-risk',
        label: 'Net edge negative',
        explanation: 'Net edge is negative -- remaining premium no longer compensates for gamma risk.',
        evidenceField: 'netEdgeNegative',
      });
    }
    const cutLossesPoints = dampenedPoints(W.netEdgeNegativeCutLossesNudge, evidence.remainingOpportunityPct, 'toward_close');
    if (cutLossesPoints > 0) {
      bump(scores, 'CUT_LOSSES', cutLossesPoints, {
        id: 'net-edge-negative-cut-losses',
        label: 'Net edge negative',
        explanation: 'Net edge is negative, which also elevates loss risk.',
        evidenceField: 'netEdgeNegative',
        includeInReasons: false,
      });
    }
  }

  // PI-0008B: technical trend -- increased influence in the risk-detection
  // (against) direction only; the confirming (aligned) direction is
  // unchanged (see decisionQualityMatrix.ts for why).
  if (evidence.technicalAlignment === 'against') {
    const cutLossesPoints = dampenedPoints(W.technicalAgainstCutLosses, evidence.remainingOpportunityPct, 'toward_close');
    if (cutLossesPoints > 0) {
      bump(scores, 'CUT_LOSSES', cutLossesPoints, {
        id: 'technical-against-cut-losses',
        label: 'Technical trend against',
        explanation: 'Recent technical trend is running against the position.',
        evidenceField: 'technicalAlignment',
      });
    }
    const reduceRiskPoints = dampenedPoints(W.technicalAgainstReduceRisk, evidence.remainingOpportunityPct, 'toward_close');
    if (reduceRiskPoints > 0) {
      bump(scores, 'REDUCE_RISK', reduceRiskPoints, {
        id: 'technical-against-reduce-risk',
        label: 'Technical trend against',
        explanation: 'Recent technical trend is running against the position, which also supports reducing exposure.',
        evidenceField: 'technicalAlignment',
        includeInReasons: false,
      });
    }
  } else if (evidence.technicalAlignment === 'aligned') {
    const holdPoints = dampenedPoints(W.technicalAlignedHold, evidence.remainingOpportunityPct, 'toward_hold');
    if (holdPoints > 0) {
      bump(scores, 'HOLD_POSITION', holdPoints, {
        id: 'technical-aligned-hold',
        label: 'Technical trend confirms position',
        explanation: 'Recent technical trend confirms the position.',
        evidenceField: 'technicalAlignment',
      });
    }
  }

  // PI-0008B: gamma/DTE risk -- new. Reuses the existing `dte` field, scaled
  // continuously from 0 at the 21-day management-window edge to the maximum
  // at/past expiration -- "gamma risk as DTE decreases" from the brief.
  // Reduce Risk gets the primary contribution; Cut Losses gets a smaller
  // nudge (half the max), matching every other de-risking signal in this
  // file (see decisionQualityMatrix.ts's "Reduce Risk vs. Cut Losses" note).
  if (evidence.dte != null && evidence.dte <= W.gammaDteWindowDays) {
    const fraction = gammaDteFraction(evidence.dte);
    const reduceRiskPoints = scaleWeight(fraction, W.gammaDteReduceRiskMax);
    const cutLossesPoints = scaleWeight(fraction, W.gammaDteCutLossesMax);
    if (reduceRiskPoints > 0) {
      bump(scores, 'REDUCE_RISK', reduceRiskPoints, {
        id: 'gamma-dte-reduce-risk',
        label: 'Gamma risk rising as expiration nears',
        explanation: `Gamma risk increases as DTE (${evidence.dte}) approaches expiration.`,
        evidenceField: 'dte',
      });
    }
    if (cutLossesPoints > 0) {
      bump(scores, 'CUT_LOSSES', cutLossesPoints, {
        id: 'gamma-dte-cut-losses',
        label: 'Gamma risk rising as expiration nears',
        explanation: `Gamma risk increases as DTE (${evidence.dte}) approaches expiration, which also elevates loss risk.`,
        evidenceField: 'dte',
        includeInReasons: false,
      });
    }
  }

  // PI-0008B: Remaining Opportunity -- new. Reuses PI-0008A's
  // remainingOpportunityPct, previously computed but never consumed by any
  // recommendation. Low remaining opportunity supports Take Profit when the
  // position is already profitable (bank what's left) or Reduce Risk
  // otherwise (little recoverable upside justifies less exposure -- Cut
  // Losses still requires its own harder evidence). High remaining
  // opportunity supports Hold Position (don't act prematurely on genuine
  // upside).
  if (evidence.remainingOpportunityPct != null) {
    const pct = evidence.remainingOpportunityPct;
    if (pct <= W.remainingOpportunityLowThresholdPct) {
      const fraction = (W.remainingOpportunityLowThresholdPct - pct) / W.remainingOpportunityLowThresholdPct;
      if (evidence.pnlPct != null && evidence.pnlPct > 0) {
        const points = scaleWeight(fraction, W.remainingOpportunityLowTakeProfitMax);
        if (points > 0) {
          bump(scores, 'TAKE_PROFIT', points, {
            id: 'remaining-opportunity-low-take-profit',
            label: 'Little remaining opportunity',
            explanation: `Only ${pct}% of risk-adjusted opportunity remains -- most of the achievable gain is already captured.`,
            evidenceField: 'remainingOpportunityPct',
          });
        }
      } else {
        const points = scaleWeight(fraction, W.remainingOpportunityLowReduceRiskMax);
        if (points > 0) {
          bump(scores, 'REDUCE_RISK', points, {
            id: 'remaining-opportunity-low-reduce-risk',
            label: 'Little remaining opportunity',
            explanation: `Only ${pct}% of risk-adjusted opportunity remains -- little recoverable upside justifies the current exposure.`,
            evidenceField: 'remainingOpportunityPct',
          });
        }
      }
    } else if (pct >= W.remainingOpportunityHighThresholdPct) {
      const fraction = (pct - W.remainingOpportunityHighThresholdPct) / (100 - W.remainingOpportunityHighThresholdPct);
      const points = scaleWeight(fraction, W.remainingOpportunityHighHoldMax);
      if (points > 0) {
        bump(scores, 'HOLD_POSITION', points, {
          id: 'remaining-opportunity-high-hold',
          label: 'Substantial remaining opportunity',
          explanation: `${pct}% of risk-adjusted opportunity remains -- genuine upside is still on the table.`,
          evidenceField: 'remainingOpportunityPct',
        });
      }
    }
  }

  if (evidence.rollFlagged) {
    bump(scores, 'ROLL_POSITION', W.rollFlagged, {
      id: 'roll-flagged',
      label: 'Flagged for roll review',
      explanation: 'Position is explicitly flagged for roll review.',
      evidenceField: 'rollFlagged',
    });
  }

  if (evidence.orderNeedsReplacement) {
    bump(scores, 'REPLACE_WORKING_ORDER', W.orderNeedsReplacement, {
      id: 'order-needs-replacement',
      label: 'Working order stale or flagged',
      explanation: 'The working order is stale, off-market, or explicitly flagged for review.',
      evidenceField: 'orderNeedsReplacement',
    });
  }
  if (evidence.idleCashDeployable) {
    bump(scores, 'DEPLOY_IDLE_CASH', W.idleCashDeployable, {
      id: 'idle-cash-deployable',
      label: 'Idle cash above threshold',
      explanation: 'Idle cash is above the deployment threshold and risk conditions allow deploying more.',
      evidenceField: 'idleCashDeployable',
    });
  }

  // Strategy awareness (ticket #7): assignment preference/intent can promote
  // Accept Assignment for Wheel-style positions, but never suppresses a
  // material-loss-driven Cut Losses -- a hard loss-policy breach is exactly
  // the "hard-risk policy" exception the ticket's NVDA scenario allows for.
  if (evidence.context === 'wheel-csp' || evidence.context === 'covered-call') {
    if (evidence.assignmentPreference === 'PREFER' || evidence.assignmentIntent === 'willing') {
      bump(scores, 'ACCEPT_ASSIGNMENT', W.assignmentPreferred, {
        id: 'assignment-preferred',
        label: 'Assignment preferred',
        explanation: 'Assignment is the stated goal for this position.',
        evidenceField: evidence.assignmentPreference === 'PREFER' ? 'assignmentPreference' : 'assignmentIntent',
      });
    }
  }

  // Earnings context never gets its own intent -- it raises the stakes on
  // whichever intent the evidence above already supports (or Hold Position
  // via baseline if nothing else does), and always attaches an explanatory
  // reason so the trader knows earnings is a live factor. PI-0008B: this now
  // adds real weight (scaled by proximity within the review window) instead
  // of a fixed 0, so earnings proximity can genuinely tip a close contest,
  // not just narrate one.
  if (evidence.earningsActionable) {
    const leader = (Object.entries(scores) as [ManagementIntent, ScoreEntry][])
      .sort((a, b) => b[1].score - a[1].score)[0]?.[0] ?? 'HOLD_POSITION';
    const proximityFraction = evidence.earningsProximityFraction ?? W.earningsProximityFallbackFraction;
    const points = scaleWeight(proximityFraction, W.earningsProximityMax);
    bump(scores, leader, points, {
      id: 'earnings-inside-window',
      label: 'Earnings inside review window',
      explanation: 'Earnings fall before expiration, inside the review window.',
      evidenceField: 'earningsActionable',
    });
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

// PI-0007A: confidence tier from decision margin only -- display metadata,
// per the ticket's recommended boundaries. Never consulted by the selection
// logic above.
function confidenceTierForMargin(margin: number): ManagementIntentConfidenceTier {
  if (margin >= 30) return 'High';
  if (margin >= 15) return 'Medium';
  return 'Low';
}

// The one canonical selector (ticket #3). Pure and deterministic: same
// evidence always produces the same winner, same reasons, same alternatives.
export function selectManagementIntent(evidence: ManagementIntentEvidence): ManagementIntentResult {
  const relevant = RELEVANT_INTENTS[evidence.context];
  const scored = scoreCandidates(evidence);

  // PI-0007A: unchanged filter/sort from PI-0006B -- `candidates` below is
  // simply this same ranked list exposed in full (previously only `winner`
  // and a 3-item slice of the rest were returned).
  const candidates: ManagementIntentCandidate[] = relevant
    .filter((intent) => (scored[intent]?.score ?? 0) > 0)
    .map((intent) => ({
      intent,
      label: MANAGEMENT_INTENT_LABEL[intent],
      score: scored[intent]!.score,
      reasons: scored[intent]!.reasons,
      contributions: scored[intent]!.contributions,
      isWinner: false,
    }));

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return INTENT_TIE_BREAK_ORDER.indexOf(a.intent) - INTENT_TIE_BREAK_ORDER.indexOf(b.intent);
  });

  const [winner, ...alternatives] = candidates;
  winner.isWinner = true;

  const runnerUp = alternatives[0] ?? null;
  const runnerUpScore = runnerUp?.score ?? 0;
  const margin = winner.score - runnerUpScore;

  return {
    intent: winner.intent,
    label: winner.label,
    reasons: winner.reasons.slice(0, 4),
    alternatives: alternatives.slice(0, 3),
    candidates,
    winnerScore: winner.score,
    runnerUpIntent: runnerUp?.intent ?? null,
    runnerUpScore,
    margin,
    confidenceTier: confidenceTierForMargin(margin),
  };
}

