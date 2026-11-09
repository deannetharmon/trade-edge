// lib/portfolio-snapshot/committedCalls.ts
//
// CC-VISIBILITY-0001 slice 2 -- WHICH short calls hold a stock's contracts. Pure, display only.
//
// The capacity math (computeCoveredCallCapacity) deliberately works from counts, so by the time a card is drawn the strike
// and expiry of the call that is using a contract are gone. This module lists them from the same raw broker rows, applying
// the SAME filters as normalizeShortCallExposure and normalizeWorkingCallReservations (short option, quantity above 0,
// underlying resolvable, a confirmed put is skipped, an unclassifiable option is kept and flagged). Counts stay the only
// input to capacity; the tests assert the two agree on every fixture, so this list can never show a different number of
// contracts than the card's "1 of 2 available".
//
// Never fabricated: a detail the broker row does not carry (an unparseable OCC symbol, a missing price) is null, and the
// UI says "detail unavailable" instead of guessing.

import { parseOccSymbol, resolveOptionType, resolveUnderlyingSymbol } from '@/lib/optionSymbol';
import { isWorkingOrderStatus } from '@/lib/scans/workingOrderStatus';
import type { RawPositionLike } from './normalizeShortCallExposure';
import type { RawOrderLike } from './normalizeWorkingOrders';

export interface CommittedCall {
  /** 'filled' = an open short call position; 'pending' = a working sell-to-open order that has reserved a contract. */
  status: 'filled' | 'pending';
  /** Contracts this row accounts for (a position or order leg of 3 is one row with quantity 3). */
  quantity: number;
  strike: number | null;
  /** YYYY-MM-DD, or null when the symbol could not be parsed. */
  expiration: string | null;
  /** Premium received per share (average open price) for a filled call; null when not carried or for a pending order. */
  premiumPerShare: number | null;
  /** The broker could not say call or put; it is counted as a call (the safe direction), as the capacity math does. */
  unclassified: boolean;
}

export type CommittedCallsBySymbol = Record<string, CommittedCall[]>;

const normalizeToken = (raw: unknown): string => String(raw ?? '').trim().toLowerCase();

function finitePositive(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

export function listCommittedShortCalls(
  rawPositions: Array<RawPositionLike & { 'average-open-price'?: string | number }> | null | undefined,
  rawOrders: RawOrderLike[] | null | undefined,
): CommittedCallsBySymbol {
  const out: CommittedCallsBySymbol = {};
  const add = (symbol: string, call: CommittedCall) => { (out[symbol] ??= []).push(call); };

  for (const p of rawPositions ?? []) {
    const instrumentType = p['instrument-type'];
    if (instrumentType !== 'Equity Option' && instrumentType !== 'Index Option') continue;
    if (p['quantity-direction'] !== 'Short') continue;
    const qty = Number(p.quantity ?? 0);
    if (!(qty > 0)) continue;
    const symbol = resolveUnderlyingSymbol(p['underlying-symbol'], p.symbol);
    if (!symbol) continue; // unattributable: the capacity report fails closed on it; there is no symbol to list it under
    const optionType = resolveOptionType(p['option-type'], p.symbol);
    if (optionType === 'P') continue;
    const parsed = parseOccSymbol(p.symbol);
    add(symbol, {
      status: 'filled', quantity: qty, strike: parsed.strikePrice, expiration: parsed.expiry,
      premiumPerShare: finitePositive(p['average-open-price']), unclassified: optionType === null,
    });
  }

  for (const order of rawOrders ?? []) {
    if (!isWorkingOrderStatus(order.status)) continue;
    for (const leg of order.legs ?? []) {
      if (normalizeToken(leg.action) !== 'sell to open') continue;
      const instrumentType = leg['instrument-type'];
      if (instrumentType && instrumentType !== 'Equity Option' && instrumentType !== 'Index Option') continue;
      const qty = Number(leg.quantity ?? 0);
      if (!(qty > 0)) continue;
      const symbol = resolveUnderlyingSymbol(leg['underlying-symbol'], leg.symbol);
      if (!symbol) continue;
      const optionType = resolveOptionType(leg['option-type'], leg.symbol);
      if (optionType === 'P') continue;
      const parsed = parseOccSymbol(leg.symbol);
      add(symbol, { status: 'pending', quantity: qty, strike: parsed.strikePrice, expiration: parsed.expiry, premiumPerShare: null, unclassified: optionType === null });
    }
  }

  // Filled first, then by expiry then strike, so the list reads the same every time.
  for (const calls of Object.values(out)) {
    calls.sort((a, b) => (a.status === b.status ? 0 : a.status === 'filled' ? -1 : 1)
      || (a.expiration ?? '9999').localeCompare(b.expiration ?? '9999') || (a.strike ?? 0) - (b.strike ?? 0));
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "Dec 18" from YYYY-MM-DD; null when it is not a date. */
export function formatExpiryShort(expiration: string | null): string | null {
  const m = expiration ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiration) : null;
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : null;
}

const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/**
 * One readable line per committed call: "Short $63 call · Dec 18 · 39 DTE · filled · +$201" or "Pending · $64 call · Jan 16".
 * `dte` is passed in (New York basis, computed by the caller) so this stays pure; omitted when unknown.
 */
export function describeCommittedCall(call: CommittedCall, dte: number | null): string {
  const strike = call.strike !== null ? `${usd(call.strike)} call` : 'call (detail unavailable)';
  const expiry = formatExpiryShort(call.expiration);
  const parts: string[] = [call.status === 'filled' ? `Short ${strike}` : `Pending · ${strike}`];
  if (expiry) parts.push(expiry);
  if (expiry && dte !== null && dte >= 0) parts.push(`${dte} DTE`);
  if (call.quantity > 1) parts.push(`× ${call.quantity}`);
  if (call.status === 'filled') {
    parts.push('filled');
    if (call.premiumPerShare !== null) parts.push(`+$${Math.round(call.premiumPerShare * 100 * call.quantity).toLocaleString('en-US')}`);
  }
  return parts.join(' · ');
}
