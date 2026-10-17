// features/portfolio/positions-workspace/model/orderPercents.ts
//
// ORDER-PCT-0001 (Dean, 2026-10-16): the Orders / Stop column says how far each working order is set, in percent, instead of only
// "Live" or "Aligned". Credit positions only. Display only: nothing here changes a rule, a classification or an order.
//   * Profit target: the share of the opening credit the working GTC buy-back keeps (a $2.00 credit bought back at $1.00 is 50%).
//   * Stop: the stop trigger as a percent of the opening credit (a 2x credit stop is 200%, which is a loss equal to the credit).
// Each returns null when there is no such order or the inputs cannot support a figure, so no number is ever invented.

import type { Position } from '@/lib/portfolio-data/types';

type PctInput = Pick<Position, 'entryPriceEffect' | 'entryEconomicsComplete' | 'entryCredit' | 'quantity' | 'gtcOrderId' | 'gtcOrderPrice' | 'stopAssessment'> & { identity?: { quantity?: number | null } | null };

/** Opening credit per share, or null when it cannot be stated. */
function creditPerShare(p: PctInput): number | null {
  if (p.entryPriceEffect !== 'Credit' || p.entryEconomicsComplete !== true) return null;
  const contracts = p.identity?.quantity ?? p.quantity;
  if (typeof p.entryCredit !== 'number' || !Number.isFinite(p.entryCredit) || p.entryCredit <= 0) return null;
  if (typeof contracts !== 'number' || !Number.isFinite(contracts) || contracts <= 0) return null;
  return p.entryCredit / (contracts * 100);
}

/** Percent of the opening credit the working profit-target order keeps (whole percent), or null. */
export function profitTargetOrderPct(p: PctInput): number | null {
  if (p.gtcOrderId == null || typeof p.gtcOrderPrice !== 'number' || !Number.isFinite(p.gtcOrderPrice) || p.gtcOrderPrice < 0) return null;
  const credit = creditPerShare(p);
  if (credit == null) return null;
  const pct = ((credit - p.gtcOrderPrice) / credit) * 100;
  return pct >= 0 && pct <= 100 ? Math.round(pct) : null;
}

/** Stop trigger as a whole percent of the opening credit (200 means a 2x credit stop), or null when there is no matched stop. */
export function stopOrderPct(p: PctInput): number | null {
  const assessment = p.stopAssessment;
  if (!assessment || assessment.matchedOrderId == null) return null;
  const trigger = assessment.derivedAssessment?.actualTrigger;
  if (typeof trigger !== 'number' || !Number.isFinite(trigger) || trigger <= 0) return null;
  const credit = creditPerShare(p);
  if (credit == null) return null;
  return Math.round((trigger / credit) * 100);
}
