// lib/scans/cspEntryUnits.ts
//
// CSP-UNITS-0001 -- the CSP order modal mixed two units. The scan's `credit`
// is TOTAL DOLLARS (mid x 100 x contracts, e.g. 680), but the broker's order
// price, the GTC buyback and the stop trigger/limit are PER SHARE (e.g. 6.80).
// The modal sent "680.00" as the entry price and TastyTrade's dry run rejected
// it ("One or more preflight checks failed"). These helpers pin the units so
// the modal state is per share, and only the dollar-based risk math converts.

import { buildCreditEntryOtoco } from '../screener/entryBracket';
import { bracketForPrice } from '../entry-walk/bracket';
import type { TickTable } from '../portfolio/tickSize';

/** Per-share entry limit pre-fill: the scan's mid per share, never the total-dollar `credit`. */
export function cspEntryLimitPerShare(candidate: { cspMid?: number | null; credit?: number | null }): number {
  const mid = candidate.cspMid;
  if (mid != null && Number.isFinite(mid) && mid > 0) return parseFloat(mid.toFixed(2));
  const credit = candidate.credit;
  if (credit != null && Number.isFinite(credit) && credit > 0) return parseFloat((credit / 100).toFixed(2));
  return 0;
}

/** Per-share price to dollars per contract (x100), for the max-loss and collateral math. */
export function cspPerShareToContractDollars(perShare: number): number {
  return Math.round(perShare * 10000) / 100;
}

/** The exact broker request the CSP modal sends, built from a per-share entry price. */
export function buildCspEntryPayload(input: {
  entryPerShare: number;
  gtcPct: number;
  stopMultiple: number;
  quantity: number;
  leg: { action: string; quantity: number; [key: string]: unknown };
  /** ORDER-TICK-0001: the option root's tick table; exits are rounded to it when known. */
  tickTable?: TickTable | null;
}) {
  return buildCreditEntryOtoco({ ...bracketForPrice(input.entryPerShare, input.gtcPct, input.stopMultiple, input.tickTable ?? null), quantity: input.quantity, legs: [input.leg] });
}
