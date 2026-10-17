// lib/salvage/salvageCandidates.ts
//
// SALVAGE-0001 slice B -- turn a loaded option chain (one expiration) into
// wing candidates with guardrail warnings. Pure; the chain is fetched by the
// caller, browser-side. Nothing here places or changes an order.

import {
  evaluateObjective,
  maxExpiryPayoff,
  validateWing,
  wingCreditCash,
  wingTotalFromToday,
  type LongLeg,
  type ObjectiveResult,
  type OptionRight,
} from './salvageMath';

export const QUOTE_MAX_AGE_MS = 60_000;
export const WIDE_MARKET_PCT_OF_MID = 0.25;
export const WIDE_MARKET_ABS_UNDER_ONE = 0.1;
/** Bids below this per share are dust (Ian): not a real market, not offered as a wing. */
export const MIN_WING_BID = 0.05;

export interface ChainQuote {
  right: OptionRight;
  strike: number;
  bid: number | null;
  ask: number | null;
  delta: number | null;
  /** Space-padded OCC symbol, needed to build an order. */
  occSymbol?: string | null;
  /** Epoch ms of the quote. Null means unknown age, treated as stale. */
  asOfMs: number | null;
}

export type CandidateWarning = 'WIDE_MARKET' | 'STALE_QUOTE';

export interface WingRow {
  strike: number;
  occSymbol: string | null;
  bid: number;
  ask: number | null;
  delta: number | null;
  creditNet: number;
  maxFromToday: number;
  objective: ObjectiveResult | null;
  warnings: CandidateWarning[];
  /** False when a warning forbids an order proposal (stale quote). */
  proposable: boolean;
}

export function isWideMarket(bid: number, ask: number | null): boolean {
  if (ask == null || !(ask >= bid)) return false;
  const gap = ask - bid;
  const mid = (ask + bid) / 2;
  if (mid <= 0) return false;
  if (gap > mid * WIDE_MARKET_PCT_OF_MID) return true;
  return mid < 1 && gap > WIDE_MARKET_ABS_UNDER_ONE;
}

export function isStaleQuote(asOfMs: number | null, nowMs: number): boolean {
  return asOfMs == null || nowMs - asOfMs > QUOTE_MAX_AGE_MS;
}

export interface BuildOptions {
  long: LongLeg;
  wingQuantity: number;
  nowMs: number;
  /** Optional objective in dollars from today (e.g. the original debit). */
  targetDollars?: number;
}

/**
 * Wings are strictly beyond the long strike, have a bid, and clear their own
 * fees. Closest strike first.
 */
export function buildWingRows(chain: ChainQuote[], o: BuildOptions): WingRow[] {
  const rows: WingRow[] = [];
  for (const q of chain) {
    if (q.right !== o.long.right || q.bid == null || q.bid < MIN_WING_BID) continue;
    const wing = { strike: q.strike, bid: q.bid };
    if (!validateWing(o.long, wing, o.wingQuantity).valid) continue;
    const creditNet = wingCreditCash(wing, o.wingQuantity);
    if (!(creditNet > 0)) continue;
    const warnings: CandidateWarning[] = [];
    if (isWideMarket(q.bid, q.ask)) warnings.push('WIDE_MARKET');
    const stale = isStaleQuote(q.asOfMs, o.nowMs);
    if (stale) warnings.push('STALE_QUOTE');
    const cap = maxExpiryPayoff(o.long, wing, o.wingQuantity);
    rows.push({
      strike: q.strike,
      occSymbol: q.occSymbol ?? null,
      bid: q.bid,
      ask: q.ask,
      delta: q.delta,
      creditNet,
      maxFromToday: Number.isFinite(cap)
        ? wingTotalFromToday(o.long, wing, o.wingQuantity, o.long.right === 'P' ? 0 : wing.strike * 100)
        : Number.POSITIVE_INFINITY,
      objective:
        o.targetDollars == null
          ? null
          : evaluateObjective(o.long, wing, o.wingQuantity, o.targetDollars),
      warnings,
      proposable: !stale,
    });
  }
  rows.sort((a, b) =>
    o.long.right === 'P' ? b.strike - a.strike : a.strike - b.strike,
  );
  return rows;
}

/** Earnings falling on or before expiration (YYYY-MM-DD strings). */
export function earningsBeforeExpiry(
  earningsDate: string | null | undefined,
  expDate: string,
  todayYmd: string,
): { before: boolean; daysAway: number | null } {
  if (!earningsDate || earningsDate < todayYmd) return { before: false, daysAway: null };
  const days = Math.round(
    (Date.parse(`${earningsDate}T00:00:00Z`) - Date.parse(`${todayYmd}T00:00:00Z`)) / 86_400_000,
  );
  return { before: earningsDate <= expDate, daysAway: days };
}
