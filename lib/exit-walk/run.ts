// lib/exit-walk/run.ts
//
// EXIT-WALK-0001B step 1: the step loop for "Walk the price" on exits (Sell to Close / Buy to Close). Pure and unwired:
// every broker action, the clock and the sleep are injected (ExitWalkDeps), so the race rules are tested with a fake broker.
//
// Rules (Ian C1, Quinn), same race rules as lib/entry-walk/walk.ts:
//   - the caller starts the walk (never automatic) and has already placed the first order at the schedule's first price
//   - read the order status before every cancel; a fill or partial fill stops the walk, never a resubmit
//   - a failed cancel re-reads the status once (a cancel that fails because the order filled is a fill)
//   - resubmit only after the cancel is confirmed, so there is never more than one live order
//   - no retries anywhere: any unexpected result stops the walk and says whether an order is still live
//   - each next price comes from the live quote (nextWalkPrice); a halt (stale, opening window, bad market) leaves the order as it is
//   - the walk only ever moves toward the market, never past the boundary re-derived from the live quote
//   - the close-order safety gate (deps.checkPrice) runs on every next price before the cancel; a refusal leaves the order working

import { WalkAuthError, type WalkOrderStatus } from '@/lib/entry-walk/walk';
import type { TickTable } from '@/lib/portfolio/tickSize';
import { DEFAULT_EXIT_WALK_CONFIG, buildExitWalk, nextWalkPrice } from './exitWalk';
import type { ExitSide, ExitWalkConfig, ExitWalkHaltReason, ExitWalkInput, ExitWalkResult, Quote } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Start check: the walk is refused before any order exists.
// ---------------------------------------------------------------------------------------------------------------------

export type WalkRefusal = 'hard_risk' | 'gap_block' | ExitWalkHaltReason;

export type WalkStartCheck =
  | { ok: true; plan: Extract<ExitWalkResult, { ok: true }> }
  | { ok: false; reason: WalkRefusal; message: string };

export interface WalkStartInput extends ExitWalkInput {
  /** Stop or max-loss exit: these go out at a marketable limit, never walked. */
  hardRisk: boolean;
  /** The gap rule blocked the ladder: the user sets the price. */
  gapBlocked: boolean;
}

export function checkWalkStart(input: WalkStartInput): WalkStartCheck {
  if (input.hardRisk) return { ok: false, reason: 'hard_risk', message: 'Stop or max-loss exits are not walked. Use a limit at the market with a slippage cap.' };
  if (input.gapBlocked) return { ok: false, reason: 'gap_block', message: 'The underlying gapped past your line. Set the price yourself.' };
  const plan = buildExitWalk(input);
  if (!plan.ok) return plan;
  return { ok: true, plan };
}

// ---------------------------------------------------------------------------------------------------------------------
// Step loop
// ---------------------------------------------------------------------------------------------------------------------

export interface ExitWalkDeps {
  /** Submit the closing order at this price (integer cents). Rejects on any failure. Returns the new order id. */
  submit(price_c: number): Promise<string>;
  getStatus(orderId: string): Promise<WalkOrderStatus>;
  /** Cancel the order. Rejects when the broker refuses (for example because it already filled). */
  cancel(orderId: string): Promise<void>;
  /** Fresh NBBO for the contract being closed; null when unavailable. */
  getQuote(): Promise<Quote | null>;
  /**
   * Runs the close-order safety gate on the next price BEFORE anything is cancelled. Returns a refusal message, or null
   * when the price may be sent. A refusal stops the walk with the working order left exactly as it is.
   */
  checkPrice?(price_c: number, quote: Quote): string | null;
  /** Epoch milliseconds. The module never reads a clock itself. */
  nowMs(): number;
  sleep(ms: number): Promise<void>;
  cancelRequested(): boolean;
  /** The page is closing or reloading: stop touching the broker and leave the live order as it is. */
  abandoned(): boolean;
  onLog?(log: ExitWalkLogEntry[]): void;
}

export type ExitWalkLogState = 'waiting' | 'no_fill' | 'filled' | 'partial' | 'cancelled' | 'stopped';
export interface ExitWalkLogEntry {
  price_c: number;
  state: ExitWalkLogState;
  detail?: string;
}

export type ExitWalkStopReason =
  | 'halted'
  | 'price_blocked'
  | 'unknown_status'
  | 'order_closed'
  | 'cancel_failed'
  | 'resubmit_failed'
  | 'token_expired'
  | 'abandoned';

export type ExitWalkOutcome =
  | { kind: 'filled'; price_c: number; orderId: string }
  | { kind: 'partial'; price_c: number; orderId: string; filledQty: number; totalQty: number }
  | { kind: 'cancelled' }
  | { kind: 'ended_working'; price_c: number; orderId: string }
  | {
      kind: 'stopped';
      reason: ExitWalkStopReason;
      haltReason?: ExitWalkHaltReason;
      orderLive: boolean;
      price_c: number | null;
      orderId: string | null;
      message: string;
    };

export interface RunExitWalkInput {
  side: ExitSide;
  tickTable: TickTable | null;
  config?: Partial<ExitWalkConfig>;
  firstOrderId: string;
  /** The price the first order was placed at (the plan's first price). */
  firstPrice_c: number;
  /** The quote the plan was built from. */
  anchor: Quote;
  deps: ExitWalkDeps;
}

const SLICE_MS = 250;
/** After a cancel the broker can briefly report the order as still live; read the status a few times (a read, not a retry). */
const CONFIRM_READS = 4;
const CONFIRM_GAP_MS = 400;
/** Safety cap; a real schedule is a handful of prices. */
const MAX_LOOPS = 200;

export async function runExitWalk({ side, tickTable, config, firstOrderId, firstPrice_c, anchor: firstAnchor, deps }: RunExitWalkInput): Promise<ExitWalkOutcome> {
  const dwellMs = { ...DEFAULT_EXIT_WALK_CONFIG, ...config }.dwellMs;
  const sell = side === 'sell';
  const log: ExitWalkLogEntry[] = [];
  const publish = () => deps.onLog?.(log.map(entry => ({ ...entry })));

  let index = 0;
  let orderId: string | null = firstOrderId;
  let price = firstPrice_c;
  let anchor = firstAnchor;
  log.push({ price_c: price, state: 'waiting' });
  publish();

  const mark = (state: ExitWalkLogState, detail?: string) => {
    const entry = log[log.length - 1];
    if (entry) { entry.state = state; entry.detail = detail; publish(); }
  };
  const stop = (reason: ExitWalkStopReason, message: string, orderLive: boolean, haltReason?: ExitWalkHaltReason): ExitWalkOutcome => {
    mark('stopped', message);
    return {
      kind: 'stopped', reason, ...(haltReason ? { haltReason } : {}), orderLive,
      price_c: orderLive ? price : null, orderId: orderLive ? orderId : null, message,
    };
  };
  /** Wait one dwell, in short slices so Stop and page close are noticed quickly. */
  const wait = async (): Promise<'ok' | 'cancel' | 'abandoned'> => {
    let waited = 0;
    while (waited < dwellMs) {
      if (deps.abandoned()) return 'abandoned';
      if (deps.cancelRequested()) return 'cancel';
      const slice = Math.min(SLICE_MS, dwellMs - waited);
      await deps.sleep(slice);
      waited += slice;
    }
    if (deps.abandoned()) return 'abandoned';
    return deps.cancelRequested() ? 'cancel' : 'ok';
  };
  const confirmCancel = async (id: string): Promise<WalkOrderStatus> => {
    let status = await deps.getStatus(id);
    for (let read = 1; read < CONFIRM_READS && status.state === 'live'; read++) {
      await deps.sleep(CONFIRM_GAP_MS);
      status = await deps.getStatus(id);
    }
    return status;
  };
  /** Turns a filled/partial status into an outcome; null when the order is still ordinary. */
  const settled = (status: WalkOrderStatus): ExitWalkOutcome | null => {
    if (status.state === 'filled') { mark('filled'); return { kind: 'filled', price_c: price, orderId: orderId as string }; }
    if (status.state === 'partial') {
      mark('partial', `${status.filledQty} of ${status.totalQty} filled`);
      return { kind: 'partial', price_c: price, orderId: orderId as string, filledQty: status.filledQty, totalQty: status.totalQty };
    }
    return null;
  };

  try {
    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      const waitResult = await wait();
      if (waitResult === 'abandoned') return stop('abandoned', 'The page was closed. The order stays at its last price.', true);

      // 1. Always read the status first.
      const status = await deps.getStatus(orderId as string);
      const done = settled(status);
      if (done) return done;
      if (status.state === 'closed') return stop('order_closed', 'The order is no longer working.', false);
      if (status.state === 'unknown') return stop('unknown_status', 'The order status was not recognised. Nothing was changed.', true);

      // 2. The user pressed Stop walk: cancel the working order and finish.
      if (waitResult === 'cancel') return await cancelAndFinish();

      mark('no_fill');

      // 3. Next price from a fresh quote. A halt leaves the working order exactly as it is.
      let quote: Quote | null = null;
      try { quote = await deps.getQuote(); } catch (error) { if (error instanceof WalkAuthError) throw error; quote = null; }
      const next = nextWalkPrice({ side, quote, nowMs: deps.nowMs(), tickTable, config }, { stepIndex: index + 1, anchor });
      if (!next.ok) return stop('halted', `${next.message} Nothing was resubmitted.`, true, next.reason);

      // 4. Only ever move toward the market. Otherwise keep the working order and keep waiting, or end at the boundary.
      const moreAggressive = sell ? next.price_c < price : next.price_c > price;
      if (!moreAggressive) {
        if (next.atBoundary || next.stepIndex <= index) return { kind: 'ended_working', price_c: price, orderId: orderId as string };
        index = next.stepIndex;
        anchor = next.anchor;
        continue;
      }
      const refusal = deps.checkPrice?.(next.price_c, quote as Quote) ?? null;
      if (refusal) return stop('price_blocked', `${refusal} The working order was left as it is.`, true);
      if (deps.abandoned()) return stop('abandoned', 'The page was closed. The order stays at its last price.', true);
      if (deps.cancelRequested()) return await cancelAndFinish();

      // 5. Cancel, and confirm the cancel before anything is resubmitted.
      try {
        await deps.cancel(orderId as string);
      } catch (error) {
        if (error instanceof WalkAuthError) throw error;
        const reread = await deps.getStatus(orderId as string);
        const filled = settled(reread);
        if (filled) return filled;
        return stop('cancel_failed', 'The broker did not confirm the cancel. Check Pending orders.', true);
      }
      const confirmed = await confirmCancel(orderId as string);
      const filledAfter = settled(confirmed);
      if (filledAfter) return filledAfter;
      if (confirmed.state !== 'closed') return stop('cancel_failed', 'The cancel was not confirmed. Check Pending orders.', true);
      orderId = null;

      // 6. Stop or page close during the cancel: nothing is live, so nothing is resubmitted.
      if (deps.cancelRequested()) { mark('cancelled'); return { kind: 'cancelled' }; }
      if (deps.abandoned()) return stop('abandoned', 'The page was closed before the next price was sent. Nothing is live.', false);

      // 7. Resubmit at the next price.
      index = next.stepIndex;
      anchor = next.anchor;
      price = next.price_c;
      log.push({ price_c: price, state: 'waiting' });
      publish();
      try {
        orderId = await deps.submit(price);
      } catch (error) {
        if (error instanceof WalkAuthError) throw error;
        orderId = null;
        return stop('resubmit_failed', 'The next order was refused. Nothing is live. Check Pending orders.', false);
      }
    }
    return { kind: 'ended_working', price_c: price, orderId: orderId as string };
  } catch (error) {
    if (error instanceof WalkAuthError) {
      return stop('token_expired', 'The session expired. Nothing more was sent. Check Pending orders.', orderId != null);
    }
    return stop('unknown_status', error instanceof Error ? error.message : 'Unexpected error. Check Pending orders.', orderId != null);
  }

  async function cancelAndFinish(): Promise<ExitWalkOutcome> {
    try {
      await deps.cancel(orderId as string);
    } catch (error) {
      if (error instanceof WalkAuthError) throw error;
      const reread = await deps.getStatus(orderId as string);
      const filled = settled(reread);
      if (filled) return filled;
      return stop('cancel_failed', 'The broker did not confirm the cancel. Check Pending orders.', true);
    }
    const status = await confirmCancel(orderId as string);
    const done = settled(status);
    if (done) return done;
    if (status.state !== 'closed') return stop('cancel_failed', 'The cancel was not confirmed. Check Pending orders.', true);
    mark('cancelled');
    orderId = null;
    return { kind: 'cancelled' };
  }
}
