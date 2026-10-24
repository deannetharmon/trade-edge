// features/portfolio/positions-workspace/model/leapsCloseSummary.ts
//
// What closing every held LEAPS now would realize, summed: the sale proceeds (bid side) against what was paid. Each LEAPS tile shows its own
// loss; this is the one number for "if I closed them all". Pure. Null unless at least two LEAPS have both a bid and a verified entry cost,
// so a single position (already on its tile) or a missing price never produces a misleading total.

import type { ExistingIncomeOpportunity } from './types';

export interface LeapsCloseSummary {
  count: number;
  /** Held LEAPS in the card list, including any left out of the total because they have no bid or entry cost. */
  of: number;
  paid: number;
  back: number;
  /** back - paid; negative is a loss. */
  result: number;
  resultPct: number | null;
}

export function summarizeLeapsClose(opportunities: ReadonlyArray<ExistingIncomeOpportunity>): LeapsCloseSummary | null {
  const held = opportunities.filter(o => o.kind === 'pmcc-short-call' && o.heldPmccLong && !o.pairedShort);
  let paid = 0; let back = 0; let count = 0;
  for (const o of held) {
    const l = o.heldPmccLong!;
    const entry = l.entryDebitPerShare;
    const close = l.closeValue;
    if (entry == null || !Number.isFinite(entry) || entry <= 0 || close == null || !Number.isFinite(close) || close <= 0) continue;
    paid += entry * 100 * Math.abs(l.quantity);
    back += close;
    count += 1;
  }
  if (count < 2) return null;
  const result = Math.round((back - paid) * 100) / 100;
  return { count, of: held.length, paid: Math.round(paid * 100) / 100, back: Math.round(back * 100) / 100, result, resultPct: paid > 0 ? (result / paid) * 100 : null };
}
