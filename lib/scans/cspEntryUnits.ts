// lib/scans/cspEntryUnits.ts
//
// CSP-UNITS-0001 -- the CSP order modal mixed two units. The scan's `credit`
// is TOTAL DOLLARS (mid x 100 x contracts, e.g. 680), but the broker's order
// price, the GTC buyback and the stop trigger/limit are PER SHARE (e.g. 6.80).
// The modal sent "680.00" as the entry price and TastyTrade's dry run rejected
// it ("One or more preflight checks failed"). These helpers pin the units so
// the modal state is per share, and only the dollar-based risk math converts.
//
// CSP-STOP-0001 -- a cash-secured put carries NO stop unless the trader opts in.
// Assignment is an acceptable outcome (DECIDE-0001; Dean, 2026-10-14), so the
// default order is the entry plus one GTC profit target (OTO). The 2x-credit
// stop-limit exit (OTOCO) is sent only when `stopEnabled` is explicitly true,
// i.e. the trader chose to close for a loss instead of taking assignment.

import { buildCreditEntryOtoco } from '../screener/entryBracket';
import { buildCreditEntryOto } from './ccOrderMath';
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

/**
 * Per-share breakeven of a short put at expiry: strike minus the credit received. This is a STOCK price, shown so the
 * trader can watch it or set a price alert; it is never sent as an order (a stop on the option's own price cannot
 * express it -- at entry the option is worth the credit, so a 1x-credit stop would trigger immediately).
 */
export function cspBreakevenPerShare(strike: number, entryPerShare: number): number {
  return Math.round((strike - entryPerShare) * 100) / 100;
}

/**
 * The exact broker request the CSP modal sends, built from a per-share entry price.
 * `stopEnabled` defaults to false: entry + GTC profit target only (OTO). Only an explicit true adds the stop-limit (OTOCO).
 */
export function buildCspEntryPayload(input: {
  entryPerShare: number;
  gtcPct: number;
  stopMultiple: number;
  quantity: number;
  leg: { action: string; quantity: number; [key: string]: unknown };
  /** ORDER-TICK-0001: the option root's tick table; exits are rounded to it when known. */
  tickTable?: TickTable | null;
  /** CSP-STOP-0001: false (the default) sends no stop. */
  stopEnabled?: boolean;
}) {
  const bracket = bracketForPrice(input.entryPerShare, input.gtcPct, input.stopMultiple, input.tickTable ?? null);
  if (input.stopEnabled === true) {
    return buildCreditEntryOtoco({ ...bracket, quantity: input.quantity, legs: [input.leg] });
  }
  return buildCreditEntryOto({
    entryPerShare: bracket.entryCredit,
    profitBuybackPerShare: bracket.profitBuyback,
    quantity: input.quantity,
    leg: input.leg,
  });
}
