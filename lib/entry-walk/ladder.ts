// lib/entry-walk/ladder.ts
//
// ENTRY-WALK-0001: the price ladder for "Walk the price". Pure, integer-cent arithmetic (Alan's fixtures).
// Credit: start 75% of the way from the mid to the ask, walk down to max(mid, minimum credit).
// Debit mirrors it: start 75% of the way from the mid to the bid, walk up to min(mid, maximum debit).

import { tickSizeFor, type TickTable } from '@/lib/portfolio/tickSize';

export const WALK_STEPS = 5;
export const WALK_STEP_MS = 3500;
/** The default per-leg bid-ask limit (the course rule, RULES.BID_ASK_MAX = 0.10), in cents. WALK-WIDTH-0001: callers pass the limit the scan used. */
export const WALK_MAX_LEG_SPREAD_CENTS = 10;

export type WalkSide = 'credit' | 'debit';

export interface LadderInput {
  side: WalkSide;
  /** Net executable bid/ask for the whole order, in dollars (credit: sold legs at bid/ask, bought legs at ask/bid). */
  netBid: number;
  netAsk: number;
  /** Each leg's own bid-ask width, in dollars. */
  legSpreads: number[];
  /**
   * WALK-WIDTH-0001: the widest leg bid-ask, in dollars, the scan accepted for this trade (a CSP's relative liquidity rule, a spread's
   * price-based limit). The walk must not refuse a trade the scan qualified. Omitted: the flat $0.10 default.
   */
  maxLegSpread?: number | null;
  /** Credit only: the scan's minimum credit rule (1/3 of width for spreads), in dollars. */
  minCredit?: number | null;
  /** Debit only: the trader's maximum debit, in dollars. */
  maxDebit?: number | null;
  tickTable: TickTable | null;
}

export type WontStartReason = 'invalid_market' | 'leg_too_wide' | 'floor_not_below_start';

export type LadderResult =
  | { ok: true; prices: number[]; end: number; mid: number }
  | { ok: false; reason: WontStartReason; message: string };

const SCALE = 32; // values are held as cents x 32 so every fraction in the rules stays an integer

const toCents = (dollars: number) => Math.round(dollars * 100);

/** Walk end price in cents x 32: credit = max(mid, min credit); debit = min(mid, max debit). */
function endScaled(input: LadderInput, bid: number, ask: number): number {
  const midScaled = 16 * (bid + ask);
  if (input.side === 'credit') {
    const min = input.minCredit != null && Number.isFinite(input.minCredit) ? SCALE * toCents(input.minCredit) : -Infinity;
    return Math.max(midScaled, min);
  }
  const max = input.maxDebit != null && Number.isFinite(input.maxDebit) ? SCALE * toCents(input.maxDebit) : Infinity;
  return Math.min(midScaled, max);
}

/** Tick in cents for a price expressed in cents x 32. */
const tickCentsAt = (valueScaled: number, table: TickTable | null) =>
  Math.max(1, Math.round(tickSizeFor(valueScaled / SCALE / 100, table) * 100));

/**
 * Round to the tick; a value exactly halfway between two ticks rounds toward the mid
 * (credit: down, debit: up). Returns cents.
 */
function roundHalfTowardMid(valueScaled: number, side: WalkSide, table: TickTable | null): number {
  const tick = tickCentsAt(valueScaled, table);
  const unit = tick * SCALE;
  const lower = Math.floor(valueScaled / unit);
  const remainder = valueScaled - lower * unit;
  let ticks: number;
  if (remainder * 2 < unit) ticks = lower;
  else if (remainder * 2 > unit) ticks = lower + 1;
  else ticks = side === 'credit' ? lower : lower + 1;
  return ticks * tick;
}

const ceilToTick = (valueScaled: number, table: TickTable | null) => {
  const tick = tickCentsAt(valueScaled, table);
  return Math.ceil(valueScaled / (tick * SCALE)) * tick;
};
const floorToTick = (valueScaled: number, table: TickTable | null) => {
  const tick = tickCentsAt(valueScaled, table);
  return Math.floor(valueScaled / (tick * SCALE)) * tick;
};

/** The first price (the walk's start) is sent by the normal Place flow; later prices come from this ladder. */
export function buildWalkLadder(input: LadderInput): LadderResult {
  const bid = toCents(input.netBid);
  const ask = toCents(input.netAsk);
  if (![input.netBid, input.netAsk].every(Number.isFinite) || bid <= 0 || ask < bid) {
    return { ok: false, reason: 'invalid_market', message: 'The quote is missing or crossed.' };
  }
  const widest = Math.max(0, ...input.legSpreads.map(s => toCents(s)));
  const limitCents = input.maxLegSpread != null && Number.isFinite(input.maxLegSpread) && input.maxLegSpread > 0
    ? Math.max(WALK_MAX_LEG_SPREAD_CENTS, Math.floor(input.maxLegSpread * 100 + 1e-6))
    : WALK_MAX_LEG_SPREAD_CENTS;
  if (widest > limitCents) {
    return {
      ok: false,
      reason: 'leg_too_wide',
      message: `One leg is $${(widest / 100).toFixed(2)} wide, over the $${(limitCents / 100).toFixed(2)} limit.`,
    };
  }

  const credit = input.side === 'credit';
  // credit: (bid + 7 ask) / 8; debit: (7 bid + ask) / 8 -- both x 32 -> 4 x (...)
  const startScaled = credit ? 4 * (bid + 7 * ask) : 4 * (7 * bid + ask);
  const endS = endScaled(input, bid, ask);
  if (credit ? endS >= startScaled : endS <= startScaled) {
    return { ok: false, reason: 'floor_not_below_start', message: credit ? 'The floor is at or above the start price.' : 'The ceiling is at or below the start price.' };
  }

  // Never cross the end price: clamp to the on-tick price that is still on the safe side of it.
  const endCents = credit ? ceilToTick(endS, input.tickTable) : floorToTick(endS, input.tickTable);
  const prices: number[] = [];
  for (let i = 0; i < WALK_STEPS; i++) {
    const valueScaled = Math.round((startScaled * (WALK_STEPS - 1 - i) + endS * i) / (WALK_STEPS - 1));
    let cents = roundHalfTowardMid(valueScaled, input.side, input.tickTable);
    cents = credit ? Math.max(cents, endCents) : Math.min(cents, endCents);
    if (prices.length === 0 || prices[prices.length - 1] !== cents / 100) prices.push(cents / 100);
  }
  return { ok: true, prices, end: endCents / 100, mid: (bid + ask) / 200 };
}

/** Is a ladder price still on the safe side of the end price recomputed from a fresh quote? */
export function priceStillValid(input: LadderInput, price: number): boolean {
  const bid = toCents(input.netBid);
  const ask = toCents(input.netAsk);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) return false;
  const endS = endScaled(input, bid, ask);
  const priceScaled = toCents(price) * SCALE;
  return input.side === 'credit' ? priceScaled >= endS : priceScaled <= endS;
}
