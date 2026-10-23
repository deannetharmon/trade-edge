// lib/portfolio-facts/verdict.ts
//
// RECO-UNIFY-0001B: the one verdict, computed from PositionFacts. Pure: facts in, { verdict, reasons[], confidence } out.
// The canonical decision is the ManagementIntent (Ian, 2026-10-17); the legacy `kind` stays internal. The four buckets (Hold, Manage, Close,
// Roll) are only a display grouping, and the intent label always shows under the bucket. The scoring itself is the existing engine, reused
// unchanged: this module changes no threshold. Each reason names its rule id, its explanation, and the fact it reacted to, so every
// consumer can show why. Confidence is computed here from data completeness and intent source, never reported by the AI.

import { evaluatePositionObjective } from '@/lib/portfolio-intelligence';
import type { ManagementIntent } from '@/lib/portfolio-intelligence/managementIntent';
import type { PositionFacts } from './positionFacts';

export type VerdictBucket = 'Hold' | 'Manage' | 'Close' | 'Roll';
export type VerdictIntent = Exclude<ManagementIntent, 'DEPLOY_IDLE_CASH'>;

/** DEPLOY_IDLE_CASH is a portfolio-level objective, not a position verdict, so it has no bucket and no verdict here. */
export const INTENT_BUCKET: Record<VerdictIntent, VerdictBucket> = {
  HOLD_POSITION: 'Hold', ACCEPT_ASSIGNMENT: 'Hold',
  REDUCE_RISK: 'Manage', SET_PROFIT_TARGET: 'Manage', REPLACE_WORKING_ORDER: 'Manage',
  TAKE_PROFIT: 'Close', CUT_LOSSES: 'Close',
  ROLL_POSITION: 'Roll',
};

/**
 * Hard rules the scoring layer does not own. When the intent scoring concludes Hold but the engine's rule layer fired a more specific kind
 * (the 21-DTE roll window, earnings, assignment risk, pricing to verify), the app has always shown that rule, and the rule must never be hidden
 * (RECO-UNIFY-0001: hard rules are never overridden). The verdict keeps intent HOLD_POSITION and carries the rule here, with the bucket it
 * belongs in. Only hold, watch and let-expire stay in Hold; any other kind that is not in the map is treated as a hard rule in Manage, so
 * a rule can never be silently shown as Hold.
 */
const HOLD_KINDS = new Set(['hold', 'watch', 'let-expire']);
export const HARD_RULE_BUCKET: Record<string, VerdictBucket> = {
  'close-winner': 'Close',
  'close-loser': 'Close',
  'roll-soon': 'Roll',
  'earnings-risk': 'Manage',
  'assignment-risk': 'Manage',
  'verify-pricing': 'Manage',
  'place-gtc': 'Manage',
};

export interface VerdictReason {
  /** The scoring rule that contributed (the engine's contribution id). */
  ruleId: string;
  text: string;
  /** The engine's evidence field this reacted to, when there is one. */
  dataPoint: string | null;
  /** The value the engine read for that data point, or null when the point has no single value (a flag) or the value is not available. */
  value: number | string | boolean | null;
  points: number;
}

export type VerdictConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Verdict {
  snapshotId: string;
  positionKey: string;
  intent: VerdictIntent;
  label: string;
  bucket: VerdictBucket;
  /** Set when a hard rule fired while the intent scoring said Hold (see HARD_RULE_BUCKET); the label is the rule's own wording. */
  hardRule: { kind: string; label: string } | null;
  /** The legacy engine kind, kept only so existing consumers can be mapped; never display it. */
  legacyKind: string;
  /** True when the position's own pre-set stop was hit: show as a quiet confirmation, not an alert. */
  quietConfirmation: boolean;
  reasons: VerdictReason[];
  confidence: { level: VerdictConfidence; basis: string[] };
}

/** The value the engine itself read for a data point (from engineInput, so it matches what decided the verdict). Null when the point has no single value. */
function factValue(facts: PositionFacts, dataPoint: string | undefined): number | string | boolean | null {
  const i = facts.engineInput;
  switch (dataPoint) {
    case 'dte': return i.dte ?? null;
    case 'materialLoss': case 'profitTargetReached': case 'meaningfulUnprotectedProfit': return i.pnlPct ?? null;
    case 'weakHealthLoss': return i.healthScore?.score ?? null;
    case 'itmOrCriticalBuffer': return i.buffer ?? null;
    case 'earningsActionable': return i.earningsDate ?? null;
    case 'technicalAlignment': return i.technicalAlignment ?? null;
    case 'remainingOpportunityPct': return i.remainingOpportunityPct ?? null;
    case 'netEdgeDeclinePct': return i.netEdgeDeclinePct ?? null;
    case 'netEdgeNegative': return i.netEdgeNegative ?? null;
    default: return null;
  }
}

const LEVELS: VerdictConfidence[] = ['LOW', 'MEDIUM', 'HIGH'];
const TIER: Record<string, VerdictConfidence> = { High: 'HIGH', Medium: 'MEDIUM', Low: 'LOW' };

/**
 * App-computed confidence: the engine's score margin, lowered one level when the entry credit or P/L the decision rests on is missing, and one
 * more when the intent was defaulted rather than chosen. Only these two data gaps count (the other fact groups are shown to the reader as
 * "not available" but do not move the level in this phase). Never reported by the AI.
 */
export function computeConfidence(facts: Pick<PositionFacts, 'engineInput' | 'identity'>, engineTier: string | undefined, calmHold = false): Verdict['confidence'] {
  let idx = LEVELS.indexOf(TIER[engineTier ?? ''] ?? 'LOW');
  const basis: string[] = [`engine margin: ${engineTier ?? 'unknown'}`];
  // Calm hold (Ian/Alan, 2026-10-23): nothing is firing, so the engine's margin is only the baseline and always reads Low. That is a clear
  // all-clear, not a weak call: Medium, never High (no trigger is not strong evidence), and a defaulted intent cannot change a Hold.
  if (calmHold) { idx = Math.max(idx, LEVELS.indexOf('MEDIUM')); basis.push('calm hold: no rule is firing'); }
  if (facts.engineInput.creditReceived == null || facts.engineInput.pnlPct == null) { idx -= 1; basis.push('economics incomplete (entry credit or P/L missing)'); }
  if (facts.identity.intentWasSet === false && calmHold) basis.push('intent defaulted (does not change a calm Hold)');
  else if (facts.identity.intentWasSet === false) { idx -= 1; basis.push('intent defaulted, not chosen'); }
  else if (facts.identity.intentWasSet === null) basis.push('intent source unknown');
  return { level: LEVELS[Math.max(0, idx)], basis };
}

/** Null when the engine returns no position verdict (none produced, or only the portfolio-level idle-cash objective). */
export function computeVerdict(facts: PositionFacts): Verdict | null {
  const result = evaluatePositionObjective(facts.engineInput, new Date(facts.asOf));
  const mi = result.legacyRecommendation.managementIntent;
  if (!mi || mi.intent === 'DEPLOY_IDLE_CASH') return null;
  const winner = mi.candidates.find(c => c.isWinner) ?? mi.alternatives.find(c => c.isWinner) ?? null;
  const reasons: VerdictReason[] = (winner?.contributions ?? [])
    .filter(c => c.points !== 0)
    .map(c => ({ ruleId: c.id, text: c.explanation, dataPoint: c.evidenceField ?? null, value: factValue(facts, c.evidenceField), points: c.points }));
  const kind = result.legacyRecommendation.kind;
  const hardBucket = mi.intent === 'HOLD_POSITION' && !HOLD_KINDS.has(kind) ? (HARD_RULE_BUCKET[kind] ?? 'Manage') : undefined;
  return {
    snapshotId: facts.snapshotId,
    positionKey: facts.positionKey,
    intent: mi.intent,
    // When the rule layer overrides a Hold for display, the rule's own wording is what the app shows, so the verdict carries it.
    label: mi.intent === 'HOLD_POSITION' && kind !== 'hold' ? result.legacyRecommendation.label : mi.label,
    bucket: hardBucket ?? INTENT_BUCKET[mi.intent],
    hardRule: hardBucket ? { kind, label: result.legacyRecommendation.label } : null,
    legacyKind: kind,
    quietConfirmation: mi.quietConfirmation === true,
    reasons,
    confidence: computeConfidence(facts, mi.confidenceTier, mi.intent === 'HOLD_POSITION' && !hardBucket && (winner?.contributions ?? []).every(c => c.id.startsWith('baseline'))),
  };
}
