// lib/entry-walk/bracket.ts
//
// ENTRY-WALK-0001 (Ian, condition 1): the profit target and stop follow each step's price. These are the same
// expressions the Screener entry dialogs use for a single order (exitCredit = entryLimit); the walk recomputes all
// three from the step's own price and never carries the first step's bracket forward.
//
// ORDER-TICK-0001: the exits are sent at prices the exchange accepts. A 2x stop on a $2.48 credit is $4.96, and a
// price at or above $3.00 must sit on a $0.05 tick, so the broker refused it ("Price must be in increments of
// $0.05"). When the option root's tick table is known, the profit target and stop trigger are rounded to the
// nearest tick (the target never reaches the entry credit), and the stop limit is rounded UP so it never falls below
// its trigger. Without a table the prices are whole cents, exactly as before; the broker still validates.

import { tickSizeFor, roundToTick, type TickTable } from '@/lib/portfolio/tickSize';

export interface EntryBracket {
  entryCredit: number;
  profitBuyback: number;
  stopTrigger: number;
  stopLimit: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Smallest on-tick price at or above `price` (ties and float noise resolved in whole cents). */
function ceilToTick(price: number, table: TickTable | null): number {
  const tick = tickSizeFor(price, table);
  const ticks = Math.ceil(cents(price) / tick - 1e-9);
  let result = cents(ticks * tick);
  const tickAtResult = tickSizeFor(result, table);
  if (tickAtResult !== tick) result = cents(Math.ceil(cents(result) / tickAtResult - 1e-9) * tickAtResult);
  return result;
}

/** Largest on-tick price at or below `price`, never below one tick. */
function floorToTick(price: number, table: TickTable | null): number {
  const tick = tickSizeFor(price, table);
  const ticks = Math.floor(cents(price) / tick + 1e-9);
  const result = cents(ticks * tick);
  return Math.max(result, tickSizeFor(0, table));
}

export function bracketForPrice(entryCredit: number, gtcPct: number, stopMultiple: number, tickTable: TickTable | null = null): EntryBracket {
  const exitCredit = entryCredit;
  const rawBuyback = parseFloat((exitCredit * (1 - gtcPct / 100)).toFixed(2));
  const rawTrigger = parseFloat((exitCredit * stopMultiple).toFixed(2));
  const rawLimit = parseFloat((rawTrigger * 1.10).toFixed(2));
  if (!tickTable) return { entryCredit, profitBuyback: rawBuyback, stopTrigger: rawTrigger, stopLimit: rawLimit };

  let profitBuyback = roundToTick(rawBuyback, tickTable);
  // A target at or above the entry credit is not a profit target; step down to the tick below the credit.
  if (profitBuyback >= entryCredit) profitBuyback = floorToTick(cents(entryCredit - 0.01), tickTable);
  const stopTrigger = roundToTick(rawTrigger, tickTable);
  const stopLimit = Math.max(ceilToTick(rawLimit, tickTable), stopTrigger);
  return { entryCredit, profitBuyback, stopTrigger, stopLimit };
}

/**
 * ORDER-TICK-0001: one line for a rejected order, naming every price that was sent and the tick table in force, so a
 * broker price error can be read off the screen instead of guessed at. Pure text; never changes what is sent.
 */
export function describeOrderPrices(payload: unknown, tickTable: TickTable | null): string {
  const p = payload as {
    'trigger-order'?: { price?: unknown };
    orders?: Array<{ price?: unknown; 'stop-trigger'?: unknown }>;
  } | null;
  const show = (v: unknown) => (v == null || v === '' ? 'n/a' : `$${String(v)}`);
  const table = tickTable
    ? tickTable.map(step => (step.threshold == null ? `$${step.value}` : `$${step.value} below $${step.threshold}`)).join(', then ')
    : 'not loaded (whole cents assumed)';
  return `Sent: entry ${show(p?.['trigger-order']?.price)}, profit target ${show(p?.orders?.[0]?.price)}, stop trigger ${show(p?.orders?.[1]?.['stop-trigger'])}, stop limit ${show(p?.orders?.[1]?.price)}. Tick table: ${table}.`;
}
