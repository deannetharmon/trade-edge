// lib/entry-walk/__tests__/walk.test.ts

import { describe, expect, it } from 'vitest';
import { runWalk, WalkAuthError, type WalkDeps, type WalkOrderStatus, type WalkQuote } from '../walk';
import { bracketForPrice } from '../bracket';
import { buildCreditEntryOtoco } from '@/lib/screener/entryBracket';

const LADDER = [1.37, 1.36, 1.34, 1.32, 1.3];
const GOOD_QUOTE: WalkQuote = { netBid: 1.2, netAsk: 1.4, legSpreads: [0.1, 0.1], ageSeconds: 1 };
const st = (state: WalkOrderStatus['state'], filledQty = 0, totalQty = 1): WalkOrderStatus => ({ state, filledQty, totalQty });

/** A fake broker with a fake clock. Tracks every live order so the one-live-order rule is checked on every run. */
function makeBroker(opts: {
  /** Status the broker reports for the order live at the nth poll while it is working (1-based per order price). */
  fillAtPrice?: number;
  partialAtPrice?: number;
  /** Fill lands in the gap: the next cancel at this price is refused and the order is then reported filled. */
  fillDuringCancelAtPrice?: number;
  failCancelAtPrice?: number;
  failSubmitAtPrice?: number;
  authFailAtPrice?: number;
  quote?: WalkQuote | null | 'throw';
  validUntil?: number; // prices below this are no longer valid
  cancelRequestedAfterSleeps?: number;
  abandonedAfterSleeps?: number;
  /** After a cancel the broker reports `live` this many times before `closed`. */
  slowCancelReads?: number;
} = {}) {
  const live = new Set<string>();
  const priceOf = new Map<string, number>();
  const state = new Map<string, WalkOrderStatus['state'] | 'cancelling'>();
  const calls: string[] = [];
  let seq = 1;
  let maxLive = 1;
  let sleeps = 0;
  let cancelReadsLeft = new Map<string, number>();
  const first = 'order-1';
  live.add(first); priceOf.set(first, LADDER[0]); state.set(first, 'live');

  const deps: WalkDeps = {
    async submit(price) {
      calls.push(`submit ${price}`);
      if (opts.authFailAtPrice === price) throw new WalkAuthError();
      if (opts.failSubmitAtPrice === price) throw new Error('refused');
      const id = `order-${++seq}`;
      live.add(id); priceOf.set(id, price); state.set(id, 'live');
      maxLive = Math.max(maxLive, live.size);
      return id;
    },
    async getStatus(id) {
      calls.push(`status ${id}`);
      const price = priceOf.get(id) as number;
      if (state.get(id) === 'live' && opts.fillAtPrice === price) { state.set(id, 'filled'); live.delete(id); }
      if (state.get(id) === 'live' && opts.partialAtPrice === price) { state.set(id, 'partial'); }
      if (state.get(id) === 'cancelling') {
        const left = cancelReadsLeft.get(id) ?? 0;
        if (left > 0) { cancelReadsLeft.set(id, left - 1); return st('live'); }
        state.set(id, 'closed'); live.delete(id);
      }
      const s = state.get(id) as string;
      if (s === 'partial') return st('partial', 2, 3);
      return st(s as WalkOrderStatus['state']);
    },
    async cancel(id) {
      calls.push(`cancel ${id}`);
      const price = priceOf.get(id) as number;
      if (opts.fillDuringCancelAtPrice === price) { state.set(id, 'filled'); live.delete(id); throw new Error('already filled'); }
      if (opts.failCancelAtPrice === price) throw new Error('broker error');
      if (opts.slowCancelReads) { state.set(id, 'cancelling'); cancelReadsLeft.set(id, opts.slowCancelReads); return; }
      state.set(id, 'closed'); live.delete(id);
    },
    async getQuote() {
      calls.push('quote');
      if (opts.quote === 'throw') throw new Error('network');
      return opts.quote === undefined ? GOOD_QUOTE : opts.quote;
    },
    priceValid(_quote, price) { return opts.validUntil == null ? true : price >= opts.validUntil; },
    async sleep() { sleeps++; },
    cancelRequested() { return opts.cancelRequestedAfterSleeps != null && sleeps >= opts.cancelRequestedAfterSleeps; },
    abandoned() { return opts.abandonedAfterSleeps != null && sleeps >= opts.abandonedAfterSleeps; },
  };
  return { deps, calls, live, getMaxLive: () => maxLive, first };
}

const run = (b: ReturnType<typeof makeBroker>) => runWalk({ ladder: LADDER, firstOrderId: b.first, deps: b.deps, stepMs: 3500 });
const submits = (b: ReturnType<typeof makeBroker>) => b.calls.filter(c => c.startsWith('submit'));

describe('walk outcomes', () => {
  it('fills at the first price: no cancel, no resubmit', async () => {
    const b = makeBroker({ fillAtPrice: 1.37 });
    const out = await run(b);
    expect(out).toMatchObject({ kind: 'filled', price: 1.37 });
    expect(b.calls.some(c => c.startsWith('cancel'))).toBe(false);
    expect(submits(b)).toHaveLength(0);
  });

  it('fills partway: stops at the filling price', async () => {
    const b = makeBroker({ fillAtPrice: 1.34 });
    const out = await run(b);
    expect(out).toMatchObject({ kind: 'filled', price: 1.34 });
    expect(submits(b)).toEqual(['submit 1.36', 'submit 1.34']);
    expect(b.getMaxLive()).toBe(1);
  });

  it('never fills: ends working at the last price with one live order', async () => {
    const b = makeBroker();
    const out = await run(b);
    expect(out).toMatchObject({ kind: 'ended_working', price: 1.3 });
    expect(submits(b)).toEqual(['submit 1.36', 'submit 1.34', 'submit 1.32', 'submit 1.3']);
    expect(b.live.size).toBe(1);
    expect(b.getMaxLive()).toBe(1);
  });

  it('a slow cancel is read again before the next price is sent', async () => {
    const b = makeBroker({ slowCancelReads: 2 });
    const out = await run(b);
    expect(out.kind).toBe('ended_working');
    expect(b.getMaxLive()).toBe(1);
  });
});

describe('race safety', () => {
  it('a fill that lands as the cancel goes out is a fill, never a retry', async () => {
    const b = makeBroker({ fillDuringCancelAtPrice: 1.36 });
    const out = await run(b);
    expect(out).toMatchObject({ kind: 'filled', price: 1.36 });
    expect(submits(b)).toEqual(['submit 1.36']);
    expect(b.getMaxLive()).toBe(1);
  });

  it('a partial fill stops the walk: no cancel, no resubmit', async () => {
    const b = makeBroker({ partialAtPrice: 1.36 });
    const out = await run(b);
    expect(out).toMatchObject({ kind: 'partial', price: 1.36, filledQty: 2, totalQty: 3 });
    expect(submits(b)).toEqual(['submit 1.36']);
    expect(b.calls.filter(c => c.startsWith('cancel'))).toHaveLength(1); // only the cancel that moved 1.37 -> 1.36
  });

  it('a failed cancel stops the walk and does not resubmit', async () => {
    const b = makeBroker({ failCancelAtPrice: 1.37 });
    const out = await run(b);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'cancel_failed', orderLive: true });
    expect(submits(b)).toHaveLength(0);
  });

  it('a refused resubmit stops the walk and says nothing is live', async () => {
    const b = makeBroker({ failSubmitAtPrice: 1.36 });
    const out = await run(b);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'resubmit_failed', orderLive: false });
    expect(b.live.size).toBe(0);
  });

  it('there is never more than one live entry order', async () => {
    for (const fillAtPrice of [undefined, 1.36, 1.32, 1.3]) {
      const b = makeBroker({ fillAtPrice });
      await run(b);
      expect(b.getMaxLive()).toBe(1);
    }
  });
});

describe('stops', () => {
  it('Cancel mid-walk cancels the working order and leaves nothing live', async () => {
    const b = makeBroker({ cancelRequestedAfterSleeps: 16 }); // after the first full step plus part of the second
    const out = await run(b);
    expect(out.kind).toBe('cancelled');
    expect(b.live.size).toBe(0);
  });

  it('Cancel during the cancel-and-resubmit does not create a new order', async () => {
    const b = makeBroker();
    let reads = 0;
    const original = b.deps.getStatus;
    b.deps.getStatus = async id => { reads++; const s = await original(id); return s; };
    let requested = false;
    const originalCancel = b.deps.cancel;
    b.deps.cancel = async id => { await originalCancel(id); requested = true; };
    b.deps.cancelRequested = () => requested;
    const out = await run(b);
    expect(out.kind).toBe('cancelled');
    expect(submits(b)).toHaveLength(0);
    expect(b.live.size).toBe(0);
    expect(reads).toBeGreaterThan(0);
  });

  it('page unload stops touching the broker and leaves the live order', async () => {
    const b = makeBroker({ abandonedAfterSleeps: 7 });
    const out = await run(b);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'abandoned', orderLive: true });
    expect(b.calls.filter(c => c.startsWith('cancel'))).toHaveLength(0);
    expect(b.live.size).toBe(1);
  });

  it('an expired token stops the walk with no resubmit', async () => {
    const b = makeBroker({ authFailAtPrice: 1.36 });
    const out = await run(b);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'token_expired', orderLive: false });
  });

  it('a stale quote stops the walk and leaves the working order', async () => {
    for (const quote of [{ ...GOOD_QUOTE, ageSeconds: 16 }, { ...GOOD_QUOTE, ageSeconds: null }, null, 'throw' as const, { ...GOOD_QUOTE, netBid: 1.5 }]) {
      const b = makeBroker({ quote });
      const out = await run(b);
      expect(out).toMatchObject({ kind: 'stopped', reason: 'stale_quote', orderLive: true, price: 1.37 });
      expect(b.calls.filter(c => c.startsWith('cancel'))).toHaveLength(0);
    }
  });

  it('a market that moves past the floor stops the walk', async () => {
    const b = makeBroker({ validUntil: 1.35 });
    const out = await run(b);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'market_moved', orderLive: true, price: 1.36 });
  });

  it('an unrecognised status stops without cancelling', async () => {
    const b = makeBroker();
    b.deps.getStatus = async () => st('unknown');
    const out = await run(b);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'unknown_status', orderLive: true });
    expect(b.calls.filter(c => c.startsWith('cancel'))).toHaveLength(0);
  });
});

describe('bracket follows every step (Ian condition 1)', () => {
  it("matches Alan's bracket fixtures at all five prices (50% target, 2x stop)", () => {
    const expected: Array<[number, number, number, number]> = [
      [1.37, 0.69, 2.74, 3.01], [1.36, 0.68, 2.72, 2.99], [1.34, 0.67, 2.68, 2.95], [1.32, 0.66, 2.64, 2.9], [1.3, 0.65, 2.6, 2.86],
    ];
    for (const [price, target, stop, limit] of expected) {
      const b = bracketForPrice(price, 50, 2);
      expect([b.profitBuyback, b.stopTrigger, b.stopLimit]).toEqual([target, stop, limit]);
    }
  });

  it('each step builds its own OTOCO from that step price', () => {
    const legs = [{ action: 'Sell to Open', quantity: 1, symbol: 'XYZ   261120P00095000' }, { action: 'Buy to Open', quantity: 1, symbol: 'XYZ   261120P00090000' }];
    const payloads = LADDER.map(price => buildCreditEntryOtoco({ ...bracketForPrice(price, 50, 2), quantity: 1, legs }));
    expect(payloads.map(p => p['trigger-order'].price)).toEqual(['1.37', '1.36', '1.34', '1.32', '1.30']);
    expect(new Set(payloads.map(p => JSON.stringify(p.orders))).size).toBe(5);
  });
});
