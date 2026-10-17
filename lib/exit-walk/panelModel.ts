// lib/exit-walk/panelModel.ts
//
// EXIT-WALK-0001B step 3b: the words and numbers on the "Walk the price" panel (Diane v4), kept pure so they are tested.
// The component only lays these out. Short on purpose: Dean asked for far fewer words.

import type { ExitWalkOutcome, WalkRefusal } from './run';
import type { ExitWalkIneligible } from './closeOrder';
import type { ExitSide, ExitWalkResult, Quote } from './types';

type Plan = Extract<ExitWalkResult, { ok: true }>;

export const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export interface PanelChip { text: string; tone: 'neutral' | 'teal' | 'amber' }
export interface PanelRow {
  step: number;
  price: string;
  /** 'mid', or the give-up versus the mid in cents ('-9c' on a sell, '+12c' on a buy). */
  vsMid: string;
  /** Time into the walk, m:ss, at the configured dwell. */
  at: string;
  status: 'Done' | 'Now' | 'Next' | 'Floor' | 'Ceiling';
}

export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Spread as a whole percent of the mid: 200 x spread / (bid + ask). */
export const spreadPct = (plan: Pick<Plan, 'spread_c' | 'mid_c2'>): number => Math.round((200 * plan.spread_c) / plan.mid_c2);

export function planChips(plan: Plan, quote: Quote): PanelChip[] {
  const sell = plan.side === 'sell';
  const live = sell ? quote.bid_c : quote.ask_c;
  const chips: PanelChip[] = [
    { text: `Mid ${dollars(plan.mid_c2 / 2)}`, tone: 'neutral' },
    { text: `Step ${plan.step_c}c`, tone: 'neutral' },
    { text: `${sell ? 'Floor' : 'Ceiling'} ${dollars(plan.boundary_c)}${plan.boundary_c === live ? ` = live ${sell ? 'bid' : 'ask'}` : ''}`, tone: 'teal' },
  ];
  if (plan.spreadFlagged) chips.push({ text: `Wide spread ${spreadPct(plan)}%`, tone: 'amber' });
  return chips;
}

/** Rows for the step table. `nowIndex` is the step being worked now (-1 before the walk starts). */
export function planRows(plan: Plan, nowIndex: number): PanelRow[] {
  const sell = plan.side === 'sell';
  const mid_c = plan.mid_c2 / 2;
  const last = plan.prices_c.length - 1;
  return plan.prices_c.map((price, i) => {
    const diff = Math.round(sell ? mid_c - price : price - mid_c);
    const status: PanelRow['status'] =
      i === nowIndex ? 'Now' : i < nowIndex ? 'Done' : i === last ? (sell ? 'Floor' : 'Ceiling') : 'Next';
    return {
      step: i + 1,
      price: dollars(price),
      vsMid: i === 0 ? 'mid' : `${sell ? '-' : '+'}${diff}c`,
      at: clock(plan.steps[i].index * plan.steps[i].dwellMs),
      status,
    };
  });
}

/**
 * Rows while the walk runs: the plan's rows, with the price actually tried replacing the plan price for every step already
 * sent (a re-anchor can make them differ). `tried` is the walk log's prices in order; the last one is the step working now.
 */
export function rowsWithLog(plan: Plan, tried: number[], running: boolean): PanelRow[] {
  const sell = plan.side === 'sell';
  const mid_c = plan.mid_c2 / 2;
  const nowIndex = running && tried.length > 0 ? tried.length - 1 : -1;
  return planRows(plan, nowIndex).map((row, i) => {
    if (i >= tried.length) return row;
    const diff = Math.round(sell ? mid_c - tried[i] : tried[i] - mid_c);
    return { ...row, price: dollars(tried[i]), vsMid: i === 0 ? 'mid' : `${sell ? '-' : '+'}${diff}c`, status: row.status === 'Now' ? 'Now' : 'Done' };
  });
}

/** "MRNA $140 put: sell to close". Multi-leg positions use their strategy name. */
export function walkTitle(pos: { symbol: string; strategy: string; legs: Array<{ optionType: 'P' | 'C'; strikePrice: number }> }, side: ExitSide): string {
  const what = pos.legs.length === 1
    ? `${pos.symbol} $${pos.legs[0].strikePrice} ${pos.legs[0].optionType === 'P' ? 'put' : 'call'}`
    : `${pos.symbol} ${pos.strategy}`;
  return `${what}: ${side === 'sell' ? 'sell' : 'buy'} to close`;
}

const REFUSAL_TEXT: Record<WalkRefusal | ExitWalkIneligible, string> = {
  structure_unclear: 'No walk: this position could not be read as one clear structure.',
  entry_unknown: 'No walk: the entry price is unknown.',
  working_order: 'No walk: this position already has a working order. Cancel it first.',
  market_closed: 'Waiting for the session: the walk runs 9:30 AM to 4:00 PM ET.',
  hard_risk: 'No walk: stop or max loss. Limit at the market, with a slippage cap.',
  gap_block: 'No walk: gap. Set the price yourself.',
  invalid_config: 'No walk: bad walk settings.',
  quote_missing: 'No walk: no quote. Refresh to continue.',
  invalid_market: 'No walk: the market looks crossed or empty.',
  quote_stale: 'Paused: old quote. Refresh to continue.',
  opening_window: 'Waiting until 9:45 AM ET: no walk in the first 15 minutes.',
  boundary_beyond_start: 'No walk: the live market is already past the start price.',
};
export const refusalText = (reason: WalkRefusal | ExitWalkIneligible): string => REFUSAL_TEXT[reason];

export function outcomeLine(outcome: ExitWalkOutcome, side: ExitSide): string {
  const bound = side === 'sell' ? 'floor' : 'ceiling';
  switch (outcome.kind) {
    case 'filled': return `Filled at ${dollars(outcome.price_c)}.`;
    case 'partial': return `${outcome.filledQty} of ${outcome.totalQty} filled at ${dollars(outcome.price_c)}. Stopped. Check Pending orders.`;
    case 'cancelled': return 'Stopped. Nothing is left working.';
    case 'ended_working': return `At the ${bound}. The order stays working at ${dollars(outcome.price_c)}. It will not go further.`;
    case 'stopped':
      return outcome.orderLive && outcome.price_c != null
        ? `${outcome.message} The order stays working at ${dollars(outcome.price_c)}.`
        : outcome.message;
  }
}
