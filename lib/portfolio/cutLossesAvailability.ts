// lib/portfolio/cutLossesAvailability.ts

import type { ActionType, Position } from '@/lib/portfolio-data/types';
import { resolvePositionStrategyFilterKey } from '@/lib/portfolio/positionStrategyFilter';

// CUTLOSS-ACQUIRE-0001 (Ian, 2026-10-06): on Acquire/Wheel short puts and
// covered calls assignment is the plan, so a midpoint loss alone never offers
// Cut Losses there; only the canonical recommendation can. Close Position
// stays available on every position. Everything else keeps TE-0002 Round 4:
// any real midpoint loss, or a canonical CUT_LOSSES recommendation.
export function assignmentIsThePlan(pos: Position): boolean {
  if (pos.intent !== 'acquisition' && pos.intent !== 'wheel') return false;
  const key = resolvePositionStrategyFilterKey(pos);
  return key === 'CSP' || key === 'CC';
}

export function cutLossesAvailable(pos: Position, canonicalAction: ActionType | null | undefined): boolean {
  if (canonicalAction === 'CUT_LOSSES') return true;
  if (assignmentIsThePlan(pos)) return false;
  return pos.pnl != null && pos.pnl < 0;
}
