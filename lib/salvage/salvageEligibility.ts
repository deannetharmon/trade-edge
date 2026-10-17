// lib/salvage/salvageEligibility.ts
//
// SALVAGE-0001 slice B -- who may see the Salvage action. Pure; takes the
// loaded Position and fails closed (any doubt = not eligible, with a reason).

import type { Position } from '@/lib/portfolio-data/types';

/** Salvage appears only when the mark is at or below this share of the entry debit (Ian). */
export const SALVAGE_MAX_MARK_TO_COST = 0.5;

export type NotEligibleReason =
  | 'STRUCTURE_AMBIGUOUS'
  | 'NOT_SINGLE_LONG_OPTION'
  | 'PMCC_LEAPS'
  | 'ENTRY_DEBIT_UNKNOWN'
  | 'MARK_UNAVAILABLE'
  | 'NOT_DOWN_ENOUGH'
  | 'WORKING_CLOSE_ORDER';

export interface EligibleSalvage {
  eligible: true;
  right: 'P' | 'C';
  strike: number;
  quantity: number;
  expDate: string;
  underlying: string;
  /** Total dollars originally paid (positive). */
  entryDebit: number;
  /** Mark (per share, mid) of the long leg; context only -- Close uses the live bid. */
  markPerShare: number;
}

export interface NotEligibleSalvage {
  eligible: false;
  reason: NotEligibleReason;
  message: string;
}

export type SalvageEligibility = EligibleSalvage | NotEligibleSalvage;

function no(reason: NotEligibleReason, message: string): NotEligibleSalvage {
  return { eligible: false, reason, message };
}

export function salvageEligibility(
  p: Position,
  opts: { hasWorkingCloseOrder?: boolean } = {},
): SalvageEligibility {
  if (p.structureAmbiguous || !p.identity) {
    return no('STRUCTURE_AMBIGUOUS', 'The position structure could not be read with certainty.');
  }
  if (p.pairedShortCallKey) {
    return no('PMCC_LEAPS', 'Paired with a short call (PMCC). Use the LEAPS recovery view.');
  }
  if (p.legs.length !== 1 || p.legs[0].direction !== 'Long' || p.identity.structureType !== 'NAKED') {
    return no('NOT_SINGLE_LONG_OPTION', 'Salvage covers a single long option only.');
  }
  const leg = p.legs[0];
  const quantity = p.identity.quantity;
  if (!(quantity >= 1) || !Number.isInteger(quantity)) {
    return no('STRUCTURE_AMBIGUOUS', 'The quantity could not be read with certainty.');
  }
  const cash = p.identity.entryTotalCashFlowDollars;
  if (p.identity.entryPriceEffect !== 'Debit' || !(typeof cash === 'number' && cash < 0)) {
    return no('ENTRY_DEBIT_UNKNOWN', 'The entry debit is not known.');
  }
  const entryDebit = -cash;
  if (leg.currentPrice == null || !(leg.currentPrice >= 0)) {
    return no('MARK_UNAVAILABLE', 'No current mark for the option.');
  }
  const markDollars = leg.currentPrice * 100 * quantity;
  if (markDollars > entryDebit * SALVAGE_MAX_MARK_TO_COST) {
    return no('NOT_DOWN_ENOUGH', 'The option is worth more than half of what was paid.');
  }
  if (opts.hasWorkingCloseOrder || p.hasGtc) {
    return no('WORKING_CLOSE_ORDER', 'A closing order is already working on this option.');
  }
  return {
    eligible: true,
    right: leg.optionType,
    strike: leg.strikePrice,
    quantity,
    expDate: p.expDate,
    underlying: p.symbol,
    entryDebit,
    markPerShare: leg.currentPrice,
  };
}
