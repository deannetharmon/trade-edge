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
 * belongs in. Kinds not listed (hold, let-expire, watch) stay in Hold.
 */
export const HARD_RULE_BUCKET: Record<string, VerdictBucket> = {
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
  /** That data point's value in the facts, or null when it is not available. */
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

function factValue(facts: PositionFacts, dataPoint: string | undefined): number | string | boolean | null {
  switch (dataPoint) {
    case 'dte': return facts.time.dte;
    case 'materialLoss': case 'weakHealthLoss': case 'profitTargetReached': case 'meaningfulUnprotectedProfit': return facts.economics.pnlPct;
    case 'itmOrCriticalBuffer': return facts.risk.bufferPct;
    case 'earningsActionable': return facts.events.earningsBeforeExpiry;
    case 'technicalAlignment': return facts.technicals.trend;
    default: return null;
  }
}

const LEVELS: VerdictConfidence[] = ['LOW', 'MEDIUM', 'HIGH'];
const TIER: Record<string, VerdictConfidence> = { High: 'HIGH', Medium: 'MEDIUM', Low: 'LOW' };

function computeConfidence(facts: PositionFacts, engineTier: string | undefined): Verdict['confidence'] {
  let idx = LEVELS.indexOf(TIER[engineTier ?? ''] ?? 'LOW');
  const basis: string[] = [`engine margin: ${engineTier ?? 'unknown'}`];
  if (!facts.complete.economics) { idx -= 1; basis.push('economics incomplete (entry credit, P/L or close value missing)'); }
  if (facts.identity.intentWasSet === false) { idx -= 1; basis.push('intent defaulted, not chosen'); }
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
  const hardBucket = mi.intent === 'HOLD_POSITION' ? HARD_RULE_BUCKET[kind] : undefined;
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
    confidence: computeConfidence(facts, mi.confidenceTier),
  };
}
