// features/portfolio/priorities/priority-engine.ts
//
// PI-0003: TE-0006C's ranking is now a re-export shim over the canonical
// prioritizePortfolioObjectives() -- this file no longer contains its own
// bespoke composite-score algorithm. "Do not maintain two ranking engines"
// (PI-0003 brief) is satisfied by having exactly one: the canonical one.
//
// Positions without a canonical `objective` attached are excluded from
// ranking entirely -- there is no fallback bespoke scorer for them anymore.
// This component has no current UI consumer (confirmed at PI-0003 time),
// so this change has no user-visible effect; it exists so that if/when
// DailyPriorityList is wired into the Portfolio page, it's already backed
// by the canonical engine.

import type { PriorityItem, PriorityPositionInput } from './priority-types';
import { prioritizePortfolioObjectives, type PortfolioObjective } from '@/lib/portfolio-intelligence';

const PRIORITY_WEIGHT: Record<PortfolioObjective['priority'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  informational: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Builds the full ranked Daily Priority List from enriched positions.
// Deterministic: same inputs always produce the same ordered output, since
// prioritizePortfolioObjectives() itself is deterministic.
export function buildDailyPriorities(positions: PriorityPositionInput[]): PriorityItem[] {
  const withObjective = positions.filter(
    (p): p is PriorityPositionInput & { objective: PortfolioObjective; recommendation: NonNullable<PriorityPositionInput['recommendation']> } =>
      Boolean(p.objective) && Boolean(p.recommendation),
  );

  const objectives = withObjective.map((p) => p.objective);
  const ranked = prioritizePortfolioObjectives(objectives).filter((o) => o.type !== 'WAIT');

  const byObjectiveId = new Map(withObjective.map((p) => [p.objective.id, p]));

  return ranked.map((objective, index) => {
    const pos = byObjectiveId.get(objective.id)!;
    const rec = pos.recommendation;
    const score = clamp(Math.round(PRIORITY_WEIGHT[objective.priority] * 20 + objective.confidence / 5 - index), 0, 100);

    return {
      rank: index + 1,
      positionId: pos.key,
      symbol: pos.symbol,
      score,
      urgency: rec.urgency,
      recommendationKind: rec.kind,
      recommendationLabel: rec.label,
      reason: rec.primaryReason,
      suggestedAction: rec.suggestedAction,
    };
  });
}

// Convenience: the top N priorities (default 5) for the compact UI panel.
export function buildTopPriorities(
  positions: PriorityPositionInput[],
  limit = 5,
): PriorityItem[] {
  return buildDailyPriorities(positions).slice(0, Math.max(0, limit));
}
