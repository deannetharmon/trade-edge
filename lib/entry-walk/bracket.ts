// lib/entry-walk/bracket.ts
//
// ENTRY-WALK-0001 (Ian, condition 1): the profit target and stop follow each step's price. These are the same
// expressions the Screener entry dialogs use for a single order (exitCredit = entryLimit); the walk recomputes all
// three from the step's own price and never carries the first step's bracket forward.
//
// ORDER-TICK-0001: the exits are sent at prices the exchange accepts. A 2x stop on a $2.48 credit is $4.96, and a
// price at or above $3.00 must sit on a $0.05 tick, so the broker refused it ("Price must be in increments of
// $0.05"). When the option root's tick table is known, the exits are rounded onto it. Without a table the prices are
// whole cents, exactly as before; the broker still validates.
//
// TICK-0002: `entryCredit` is expected to be on the tick already (the entry is snapped first, with snapEntryCredit, and
// everything here derives from the snapped entry). The exits keep the ORDER-TICK-0001 rounding (target and trigger to the
// nearest tick, the target kept below the entry credit, the stop limit rounded UP and never below its trigger); the
// $2.48 -> $4.95 trigger fixture in bracket.test.ts is the approved case. ceilToTick and floorToTick now live in
// lib/portfolio/tickSize.ts so the entry snap and the +/- buttons share them.

import { ceilToTick, floorToTick, roundToTick, type TickTable } from '@/lib/portfolio/tickSize';

export interface EntryBracket {
  entryCredit: number;
  profitBuyback: number;
  stopTrigger: number;
  stopLimit: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

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
