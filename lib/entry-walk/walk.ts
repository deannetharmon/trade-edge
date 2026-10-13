// lib/entry-walk/walk.ts
//
// ENTRY-WALK-0001: the step loop for "Walk the price". The caller has already placed the first order at
// ladder[0]; this waits, checks, cancels and resubmits at each later price. Every broker action is injected
// (WalkDeps) so the race rules are tested with a fake broker and a fake clock.
//
// Rules (Quinn and Ian):
//   - read the order status before every cancel; a fill or partial fill stops the walk, never a resubmit
//   - a failed cancel re-reads the status once (a cancel that fails because the order filled is a fill)
//   - resubmit only after the cancel is confirmed, so there is never more than one live entry order
//   - no retries anywhere: any unexpected result stops the walk and says whether an order is still live

export const WALK_QUOTE_MAX_AGE_SECONDS = 15;

export type WalkOrderState = 'live' | 'filled' | 'partial' | 'closed' | 'unknown';

export interface WalkOrderStatus {
  state: WalkOrderState;
  filledQty: number;
  totalQty: number;
}

export interface WalkQuote {
  /** Fresh net quote for the whole order, in dollars; null when unavailable. */
  netBid: number;
  netAsk: number;
  legSpreads: number[];
  ageSeconds: number | null;
}

/** Thrown by a dep when the broker session has expired (HTTP 401). */
export class WalkAuthError extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'WalkAuthError';
  }
}

export interface WalkDeps {
  /** Submit the whole entry bracket at this price. Rejects on any failure. Returns the new order id. */
  submit(price: number): Promise<string>;
  getStatus(orderId: string): Promise<WalkOrderStatus>;
  /** Cancel the order. Rejects when the broker refuses (for example because it already filled). */
  cancel(orderId: string): Promise<void>;
  getQuote(): Promise<WalkQuote | null>;
  /** Is the price still on the safe side of the end price for this fresh quote? */
  priceValid(quote: WalkQuote, price: number): boolean;
  sleep(ms: number): Promise<void>;
  cancelRequested(): boolean;
  /** The page is closing or reloading: stop touching the broker and leave the live order as it is. */
  abandoned(): boolean;
  onLog?(log: WalkLogEntry[]): void;
}

export type WalkLogState = 'waiting' | 'no_fill' | 'filled' | 'partial' | 'cancelled' | 'stopped';
export interface WalkLogEntry {
  price: number;
  state: WalkLogState;
  detail?: string;
}

export type WalkStopReason =
  | 'stale_quote'
  | 'market_moved'
  | 'unknown_status'
  | 'order_closed'
  | 'cancel_failed'
  | 'resubmit_failed'
  | 'token_expired'
  | 'abandoned';

export type WalkOutcome =
  | { kind: 'filled'; price: number; orderId: string }
  | { kind: 'partial'; price: number; orderId: string; filledQty: number; totalQty: number }
  | { kind: 'cancelled' }
  | { kind: 'ended_working'; price: number; orderId: string }
  | { kind: 'stopped'; reason: WalkStopReason; orderLive: boolean; price: number | null; orderId: string | null; message: string };

export interface RunWalkInput {
  ladder: number[];
  firstOrderId: string;
  deps: WalkDeps;
  stepMs: number;
}

const SLICE_MS = 250;
/** After a cancel the broker can briefly report the order as still live; read the status a few times (a read, not a retry). */
const CONFIRM_READS = 4;
const CONFIRM_GAP_MS = 400;

export async function runWalk({ ladder, firstOrderId, deps, stepMs }: RunWalkInput): Promise<WalkOutcome> {
  const log: WalkLogEntry[] = [];
  const publish = () => deps.onLog?.(log.map(entry => ({ ...entry })));

  let index = 0;
  let orderId: string | null = firstOrderId;
  let price = ladder[0];
  log.push({ price, state: 'waiting' });
  publish();

  const mark = (state: WalkLogState, detail?: string) => {
    const entry = log[log.length - 1];
    if (entry) { entry.state = state; entry.detail = detail; publish(); }
  };
  const stop = (reason: WalkStopReason, message: string, orderLive: boolean): WalkOutcome => {
    mark('stopped', message);
    return { kind: 'stopped', reason, orderLive, price: orderLive ? price : null, orderId: orderLive ? orderId : null, message };
  };
  /** Wait one step, in short slices so Cancel and page close are noticed quickly. */
  const wait = async (): Promise<'ok' | 'cancel' | 'abandoned'> => {
    let waited = 0;
    while (waited < stepMs) {
      if (deps.abandoned()) return 'abandoned';
      if (deps.cancelRequested()) return 'cancel';
      const slice = Math.min(SLICE_MS, stepMs - waited);
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
  const settled = (status: WalkOrderStatus): WalkOutcome | null => {
    if (status.state === 'filled') { mark('filled'); return { kind: 'filled', price, orderId: orderId as string }; }
    if (status.state === 'partial') {
      mark('partial', `${status.filledQty} of ${status.totalQty} filled`);
      return { kind: 'partial', price, orderId: orderId as string, filledQty: status.filledQty, totalQty: status.totalQty };
    }
    return null;
  };

  try {
    for (;;) {
      const waitResult = await wait();
      if (waitResult === 'abandoned') return stop('abandoned', 'The page was closed. The order stays at its last price.', true);

      // 1. Always read the status first.
      let status = await deps.getStatus(orderId as string);
      let done = settled(status);
      if (done) return done;
      if (status.state === 'closed') return stop('order_closed', 'The order is no longer working.', false);
      if (status.state === 'unknown') return stop('unknown_status', 'The order status was not recognised. Nothing was changed.', true);

      // 2. The user pressed Cancel.
      if (waitResult === 'cancel') return await cancelAndFinish();

      mark('no_fill');
      if (index >= ladder.length - 1) return { kind: 'ended_working', price, orderId: orderId as string };

      // 3. Fresh quote: stale or moved means stop, leaving the working order as it is.
      const next = ladder[index + 1];
      let quote: WalkQuote | null = null;
      try { quote = await deps.getQuote(); } catch (error) { if (error instanceof WalkAuthError) throw error; quote = null; }
      if (!quote || quote.ageSeconds == null || quote.ageSeconds > WALK_QUOTE_MAX_AGE_SECONDS || !(quote.netBid > 0) || quote.netAsk < quote.netBid) {
        return stop('stale_quote', 'The quote went stale. Nothing was resubmitted.', true);
      }
      if (!deps.priceValid(quote, next)) return stop('market_moved', 'The market moved past the floor. Nothing was resubmitted.', true);
      if (deps.abandoned()) return stop('abandoned', 'The page was closed. The order stays at its last price.', true);
      if (deps.cancelRequested()) return await cancelAndFinish();

      // 4. Cancel, and confirm the cancel before anything is resubmitted.
      try {
        await deps.cancel(orderId as string);
      } catch (error) {
        if (error instanceof WalkAuthError) throw error;
        status = await deps.getStatus(orderId as string);
        done = settled(status);
        if (done) return done;
        return stop('cancel_failed', 'The broker did not confirm the cancel. Check Pending orders.', true);
      }
      status = await confirmCancel(orderId as string);
      done = settled(status);
      if (done) return done;
      if (status.state !== 'closed') return stop('cancel_failed', 'The cancel was not confirmed. Check Pending orders.', true);
      orderId = null;

      // 5. Cancel or page close during the cancel: nothing is live, so nothing is resubmitted.
      if (deps.cancelRequested()) { mark('cancelled'); return { kind: 'cancelled' }; }
      if (deps.abandoned()) return stop('abandoned', 'The page was closed before the next price was sent. Nothing is live.', false);

      // 6. Resubmit the whole bracket at the next price.
      index += 1;
      price = next;
      log.push({ price, state: 'waiting' });
      publish();
      try {
        orderId = await deps.submit(next);
      } catch (error) {
        if (error instanceof WalkAuthError) throw error;
        orderId = null;
        return stop('resubmit_failed', 'The next order was refused. Nothing is live. Check Pending orders.', false);
      }
    }
  } catch (error) {
    if (error instanceof WalkAuthError) {
      return stop('token_expired', 'The session expired. Nothing more was sent. Check Pending orders.', orderId != null);
    }
    return stop('unknown_status', error instanceof Error ? error.message : 'Unexpected error. Check Pending orders.', orderId != null);
  }

  async function cancelAndFinish(): Promise<WalkOutcome> {
    try {
      await deps.cancel(orderId as string);
    } catch (error) {
      if (error instanceof WalkAuthError) throw error;
      const status = await deps.getStatus(orderId as string);
      const done = settled(status);
      if (done) return done;
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
