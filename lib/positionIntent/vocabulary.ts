// lib/positionIntent/vocabulary.ts
//
// POSITION-INTENT-0001: one stored intent per position (the existing /api/position-intent store), shown in each
// strategy's own words. A value from one strategy's vocabulary never appears on another strategy's control.
// Pure functions; no I/O.

import type { PositionIntent } from '@/lib/portfolio-data/types';
import { PMCC_LONG_DTE_MIN } from '@/lib/portfolio/positionLifecycle';

export type IntentFamily = 'LEAP' | 'SHORT_OPTION' | 'SPREAD';

export const POSITION_INTENT_VALUES: readonly PositionIntent[] = ['income', 'acquisition', 'neutral', 'wheel', 'hold', 'pmcc', 'undecided'];

export const INTENT_LABELS: Record<PositionIntent, string> = {
  income: 'Income',
  acquisition: 'Acquire',
  neutral: 'Neutral',
  wheel: 'Wheel',
  hold: 'Hold',
  pmcc: 'PMCC',
  undecided: 'Undecided',
};

const OPTIONS_BY_FAMILY: Record<IntentFamily, readonly PositionIntent[]> = {
  LEAP: ['hold', 'pmcc', 'undecided'],
  SHORT_OPTION: ['income', 'acquisition', 'wheel', 'neutral'],
  SPREAD: ['income', 'neutral'],
};

const FALLBACK_BY_FAMILY: Record<IntentFamily, PositionIntent> = { LEAP: 'undecided', SHORT_OPTION: 'income', SPREAD: 'income' };

export interface IntentPositionShape {
  strategy: string;
  dte: number;
  legs: ReadonlyArray<{ direction: string; optionType?: string }>;
}

/**
 * Which vocabulary a position uses, or null when intent means nothing for it (a bought put or a bought call
 * that is not a LEAP). A LEAP is a single long call with more than PMCC_LONG_DTE_MIN (120) days left, the app's own rule
 * for a long-dated call (positionLifecycle.isLeapsPosition). It stays a LEAP as it ages, so a call bought at 392 days is still one at 356.
 */
export function intentFamilyFor(position: IntentPositionShape): IntentFamily | null {
  const legs = position.legs ?? [];
  if (legs.length === 1) {
    const leg = legs[0];
    if (leg.direction === 'Long') return leg.optionType === 'C' && position.dte > PMCC_LONG_DTE_MIN ? 'LEAP' : null;
    if (leg.direction === 'Short' && (position.strategy === 'PUT' || position.strategy === 'CALL')) return 'SHORT_OPTION';
    return null;
  }
  if (position.strategy === 'BPS' || position.strategy === 'BCS' || position.strategy === 'IC') return 'SPREAD';
  return null;
}

export function intentOptionsFor(family: IntentFamily): readonly PositionIntent[] {
  return OPTIONS_BY_FAMILY[family];
}

/** The value to show: the stored one when it belongs to this vocabulary, otherwise the family's fallback. */
export function normalizeIntentForFamily(stored: string | null | undefined, family: IntentFamily): PositionIntent {
  return (OPTIONS_BY_FAMILY[family] as readonly string[]).includes(stored ?? '') ? (stored as PositionIntent) : FALLBACK_BY_FAMILY[family];
}

export function isPositionIntent(value: unknown): value is PositionIntent {
  return typeof value === 'string' && (POSITION_INTENT_VALUES as readonly string[]).includes(value);
}
