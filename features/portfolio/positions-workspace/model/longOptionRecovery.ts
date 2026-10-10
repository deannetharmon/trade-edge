// features/portfolio/positions-workspace/model/longOptionRecovery.ts
//
// LONG-OPTION-RECOVERY-0001: for a bought option the debit is already spent, so "P/L vs paid" reads like a second loss.
// This model answers the question that drives the hold-or-close decision instead: what does closing return now, and
// how much of the debit is that? Display only; nothing here feeds a recommendation, score, stop, or order.
//
// Rules (Ian, Paul, Diane, Quinn; Dean 2026-10-09):
//   - Long-debit positions only: every leg Long and the opening debit verified. Credit, mixed-leg (PMCC with a short call),
//     and ambiguous structures return null so the existing display is unchanged.
//   - The headline number is the liquidation (marketable) value, not mid: it is what closing actually returns, and for a
//     long option it is also the most that can still be lost.
//   - Paid comes from buildCapitalViewModel, the same fail-closed boundary the Capital column uses. Missing or unverified
//     entry economics return null; this model never guesses a debit.
//   - Percent-left turns red at or below RECOVERY_LOW_PCT (Paul default 25%). Green only when closing returns at least
//     what was paid. The bar is amber in between so it does not repeat the red P/L.

import type { Position } from '@/lib/portfolio-data/types';
import { buildCapitalViewModel, type SemanticTone } from './presentation';

export const RECOVERY_LOW_PCT = 25;

export interface LongOptionRecovery {
  /** Verified opening debit for the whole position, in dollars. */
  paid: number;
  /** Marketable liquidation value for the whole position, in dollars. Also the most that can still be lost. */
  closeNow: number;
  /** closeNow as a percent of paid. Can exceed 100 when the position is above cost. */
  remainingPct: number;
  /** True when closing returns at least what was paid. */
  atOrAbovePaid: boolean;
  /** Color for the percent label: red at or below RECOVERY_LOW_PCT, green at or above paid, otherwise amber. */
  pctTone: SemanticTone;
  /** Color for the bar fill: green only when at or above paid, otherwise amber. */
  barTone: SemanticTone;
}

export function buildLongOptionRecovery(position: Position): LongOptionRecovery | null {
  if (position.entryPriceEffect !== 'Debit') return null;
  const legs = position.legs ?? [];
  if (legs.length === 0 || legs.some(leg => leg.direction !== 'Long')) return null;

  const capital = buildCapitalViewModel(position);
  if (capital.label !== 'Capital at risk' || capital.value == null || !Number.isFinite(capital.value) || capital.value <= 0) return null;

  const closeNow = position.closeValue;
  if (closeNow == null || !Number.isFinite(closeNow) || closeNow < 0) return null;

  const paid = capital.value;
  const remainingPct = (closeNow / paid) * 100;
  const atOrAbovePaid = closeNow >= paid;
  const pctTone: SemanticTone = atOrAbovePaid ? 'positive' : remainingPct <= RECOVERY_LOW_PCT ? 'negative' : 'warning';
  const barTone: SemanticTone = atOrAbovePaid ? 'positive' : 'warning';
  return { paid, closeNow, remainingPct, atOrAbovePaid, pctTone, barTone };
}
