// features/portfolio/priorities/priority-engine.ts

import type { PriorityItem, PriorityPositionInput } from './priority-types';
import type { PortfolioRecommendationUrgency } from '../recommendations/recommendation-types';
import { sortAndRankPriorities } from './priority-sort';

// Base urgency contribution to the composite score. Urgency is the strongest
// single signal because it already folds in assignment/earnings/loss severity
// from the recommendation engine (TE-0006B).
const URGENCY_BASE: Record<PortfolioRecommendationUrgency, number> = {
  critical: 80,
  high: 60,
  medium: 35,
  low: 15,
};

// Recommendation kinds that represent time-sensitive, action-now situations.
// These get an additional bump so they surface above passive holds even when
// urgency and health are otherwise comparable.
const ACTION_KIND_BONUS: Partial<Record<string, number>> = {
  'assignment-risk': 15,
  'earnings-risk': 12,
  'close-loser': 12,
  'roll-soon': 8,
  'close-winner': 8,
  'place-gtc': 4,
  'let-expire': 2,
  watch: 2,
  hold: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Poor health raises priority (there's more to worry about). Health is a
// 0-100 score where higher = healthier, so we invert it into a 0-15 penalty
// contribution: a critical (low-score) position adds more to priority.
function healthContribution(healthScore: number | null | undefined): number {
  if (healthScore == null || !Number.isFinite(healthScore)) return 0;
  const inverted = (100 - clamp(healthScore, 0, 100)) / 100; // 0..1
  return inverted * 15;
}

// DTE contribution: near-dated positions demand attention sooner. Only a mild
// nudge so it doesn't overwhelm the recommendation-driven signals.
function dteContribution(dte: number | null | undefined): number {
  if (dte == null || !Number.isFinite(dte)) return 0;
  if (dte <= 3) return 8;
  if (dte <= 7) return 6;
  if (dte <= 14) return 4;
  if (dte <= 21) return 2;
  return 0;
}

// Confidence scales the whole thing slightly — a high-confidence
// recommendation is worth acting on before a low-confidence one of equal
// nominal urgency. Range ~0.9..1.0 so it only ever breaks near-ties.
function confidenceMultiplier(confidence: number | null | undefined): number {
  if (confidence == null || !Number.isFinite(confidence)) return 0.95;
  return 0.9 + (clamp(confidence, 0, 100) / 100) * 0.1;
}

function buildReason(pos: PriorityPositionInput): string {
  const rec = pos.recommendation;
  if (rec?.primaryReason) return rec.primaryReason;
  if (pos.needsClose) return 'Position flagged for close.';
  if (pos.hitTarget) return 'Profit target reached.';
  if (pos.earningsDate) return 'Earnings before expiration.';
  if (pos.dte != null && pos.dte <= 21) return `Approaching expiration (${pos.dte} DTE).`;
  return 'Routine monitoring.';
}

// Scores a single position into a rank-less priority item, or null if there's
// no recommendation to base a priority on (nothing to act on).
function scorePosition(pos: PriorityPositionInput): Omit<PriorityItem, 'rank'> | null {
  const rec = pos.recommendation;
  if (!rec) return null;

  const base = URGENCY_BASE[rec.urgency] ?? 0;
  const kindBonus = ACTION_KIND_BONUS[rec.kind] ?? 0;
  const health = healthContribution(pos.healthScore?.score);
  const dte = dteContribution(pos.dte);

  const raw = (base + kindBonus + health + dte) * confidenceMultiplier(rec.confidence);
  const score = clamp(Math.round(raw), 0, 100);

  return {
    positionId: pos.key,
    symbol: pos.symbol,
    score,
    urgency: rec.urgency,
    recommendationKind: rec.kind,
    recommendationLabel: rec.label,
    reason: buildReason(pos),
    suggestedAction: rec.suggestedAction,
  };
}

// Builds the full ranked Daily Priority List from enriched positions.
// Deterministic: same inputs always produce the same ordered output.
export function buildDailyPriorities(positions: PriorityPositionInput[]): PriorityItem[] {
  const scored = positions
    .map(scorePosition)
    .filter((item): item is Omit<PriorityItem, 'rank'> => item !== null);

  return sortAndRankPriorities(scored);
}

// Convenience: the top N priorities (default 5) for the compact UI panel.
export function buildTopPriorities(
  positions: PriorityPositionInput[],
  limit = 5,
): PriorityItem[] {
  return buildDailyPriorities(positions).slice(0, Math.max(0, limit));
}
