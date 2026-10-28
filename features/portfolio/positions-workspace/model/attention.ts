// features/portfolio/positions-workspace/model/attention.ts

// ATTENTION-WHEEL-0001: "Needs attention" is for positions that need a decision. A Wheel or Acquire put is meant to be assigned, so a
// non-Hold verdict on it (a roll or a loss message) is not a call to act; it reads "Assignment near" when the put is in the money.
import type { Position } from '@/lib/portfolio-data/types';
import { buildMoneynessViewModel } from './presentation';
import { structuralChipOf } from './strategyChips';

export interface PositionAttention {
  needsAttention: boolean;
  /** A planned-assignment put that is in the money: expected, not alarming. */
  assignmentNear: boolean;
}

export function plannedAssignmentPut(p: Position): boolean {
  return structuralChipOf(p) === 'csp' && (p.intent === 'wheel' || p.intent === 'acquisition');
}

export function attentionOf(p: Position): PositionAttention {
  const hard = Boolean(p.needsClose || p.structureAmbiguous);
  const recommended = Boolean(p.recommendation && p.recommendation.kind !== 'hold');
  if (plannedAssignmentPut(p) && !hard) {
    return { needsAttention: false, assignmentNear: buildMoneynessViewModel(p.stockPrice, p.legs)?.state === 'ITM' };
  }
  return { needsAttention: hard || recommended, assignmentNear: false };
}
