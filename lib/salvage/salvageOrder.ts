// lib/salvage/salvageOrder.ts
//
// SALVAGE-0001 slice D -- the proposed order and the submit-time gate.
//
// The order is ONE leg: Sell to Open the chosen wing against the long option
// already held. This module never talks to the broker. `submitSalvageOrderIfSafe`
// is the only way to reach the broker callback, and it is called only after the
// guard passes against FRESH data (same pattern as submitCloseOrderIfSafe).

import { roundToTick, type TickTable } from '@/lib/portfolio/tickSize';
import type { Position } from '@/lib/portfolio-data/types';
import type { WingRow } from './salvageCandidates';
import { salvageEligibility } from './salvageEligibility';

export interface SalvageOrderLeg {
  symbol: string;
  quantity: number;
  action: 'Sell to Open';
  'order-leg-type': 'Equity Option';
}

export interface SalvageOrder {
  'time-in-force': 'Day';
  'order-type': 'Limit';
  price: string;
  'price-effect': 'Credit';
  legs: [SalvageOrderLeg];
}

export type BuildSalvageOrderResult =
  | { ok: true; order: SalvageOrder; pricePerShare: number }
  | { ok: false; reason: string };

/** Day limit at the bid (rounded to the option's tick). Day, so it cannot linger after you walk away. */
export function buildSalvageOrder(input: {
  occSymbol: string | null;
  quantity: number;
  bid: number;
  tickTable: TickTable | null;
}): BuildSalvageOrderResult {
  if (!input.occSymbol) return { ok: false, reason: 'The option symbol is missing.' };
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return { ok: false, reason: 'Quantity must be a whole number of at least 1.' };
  }
  if (!Number.isFinite(input.bid) || !(input.bid > 0)) return { ok: false, reason: 'There is no bid.' };
  const pricePerShare = roundToTick(input.bid, input.tickTable);
  if (!(pricePerShare > 0)) return { ok: false, reason: 'The price could not be set.' };
  return {
    ok: true,
    pricePerShare,
    order: {
      'time-in-force': 'Day',
      'order-type': 'Limit',
      price: pricePerShare.toFixed(2),
      'price-effect': 'Credit',
      legs: [{ symbol: input.occSymbol, quantity: input.quantity, action: 'Sell to Open', 'order-leg-type': 'Equity Option' }],
    },
  };
}

/** What the trader reviewed; the guard checks the world still matches it. */
export interface SalvageReviewed {
  accountNumber: string;
  right: 'P' | 'C';
  strike: number;
  expDate: string;
  quantity: number;
  wingStrike: number;
  wingOcc: string;
  wingQuantity: number;
  pricePerShare: number;
}

export interface SalvageGuardInput {
  reviewed: SalvageReviewed;
  freshPosition: Position | null;
  freshRow: WingRow | null;
  tickTable: TickTable | null;
}

export type SalvageGuardResult =
  | { allowed: true; order: SalvageOrder; pricePerShare: number }
  | { allowed: false; reason: string; priceMoved?: boolean };

export function guardSalvageSubmit(i: SalvageGuardInput): SalvageGuardResult {
  const r = i.reviewed;
  if (!i.freshPosition) return { allowed: false, reason: 'The position is no longer open.' };
  if (i.freshPosition.accountNumber !== r.accountNumber) {
    return { allowed: false, reason: 'The position is in a different account than the one reviewed.' };
  }
  const elig = salvageEligibility(i.freshPosition);
  if (!elig.eligible) return { allowed: false, reason: elig.message };
  if (elig.right !== r.right || elig.strike !== r.strike || elig.expDate !== r.expDate || elig.quantity !== r.quantity) {
    return { allowed: false, reason: 'The position changed since you opened Salvage.' };
  }
  if (!(r.wingQuantity >= 1) || r.wingQuantity > elig.quantity) {
    return { allowed: false, reason: 'The wing cannot be larger than the long option.' };
  }
  if (!i.freshRow) return { allowed: false, reason: 'That strike is no longer available.' };
  if (i.freshRow.occSymbol !== r.wingOcc || i.freshRow.strike !== r.wingStrike) {
    return { allowed: false, reason: 'The selected option does not match the one reviewed.' };
  }
  if (!i.freshRow.proposable) return { allowed: false, reason: 'The quote is more than 60 seconds old. Refresh and review again.' };
  const built = buildSalvageOrder({ occSymbol: i.freshRow.occSymbol, quantity: r.wingQuantity, bid: i.freshRow.bid, tickTable: i.tickTable });
  if (!built.ok) return { allowed: false, reason: built.reason };
  if (Math.abs(built.pricePerShare - r.pricePerShare) > 1e-9) {
    return {
      allowed: false,
      priceMoved: true,
      reason: `The bid moved from $${r.pricePerShare.toFixed(2)} to $${built.pricePerShare.toFixed(2)}. The order was not sent. Review the new price and run the dry run again.`,
    };
  }
  return { allowed: true, order: built.order, pricePerShare: built.pricePerShare };
}

export type SubmitSalvageResult<T> =
  | { submitted: true; result: T }
  | { submitted: false; reason: string; priceMoved?: boolean };

/** The broker call is written AS the `send` callback: it cannot run unless the guard allowed it. */
export async function submitSalvageOrderIfSafe<T>(
  input: SalvageGuardInput,
  send: (order: SalvageOrder, accountNumber: string) => Promise<T>,
): Promise<SubmitSalvageResult<T>> {
  const g = guardSalvageSubmit(input);
  if (!g.allowed) return { submitted: false, reason: g.reason, priceMoved: g.priceMoved };
  return { submitted: true, result: await send(g.order, input.reviewed.accountNumber) };
}
