// lib/exit-walk/__tests__/run.test.ts
//
// EXIT-WALK-0001B step 1: Quinn's list for the exit step loop. Fake broker, fake clock, fake quotes: no network, no timers.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { WalkAuthError, type WalkOrderStatus } from '@/lib/entry-walk/walk';
import type { TickTable } from '@/lib/portfolio/tickSize';
import { buildExitWalk } from '../exitWalk';
import { checkWalkStart, runExitWalk, type ExitWalkDeps, type ExitWalkLogEntry, type ExitWalkOutcome } from '../run';
import type { ExitSide, Quote } from '../types';

const T1: TickTable = [{ threshold: null, value: 0.01 }];
// Mon Oct 19 2026, 11:00 ET (EDT, UTC-4): outside the opening window.
const T0 = Date.parse('2026-10-19T15:00:00Z');
const DWELL = 90000;

interface Harness {
  deps: ExitWalkDeps;
  submits: number[];
  cancels: string[];
  calls: string[];
  clock: { now: number };
  log: ExitWalkLogEntry[][];
  quote: { bid: number; ask: number; ageMs: number };
  maxLive(): number;
}
interface Opts {
  start?: number;
  /** Status override per read; return undefined to use the default (live or closed). */
  status?: (id: string, reads: number, h: Harness) => WalkOrderStatus | undefined;
  cancelThrows?: (id: string) => boolean;
  submitThrows?: (n: number) => Error | null;
  statusThrows?: (n: number) => Error | null;
  stuckLiveAfterCancel?: boolean;
  cancelRequested?: (h: Harness) => boolean;
  abandoned?: (h: Harness) => boolean;
  onSleep?: (h: Harness) => void;
  bid: number;
  ask: number;
}

function harness(o: Opts): Harness {
  const clock = { now: o.start ?? T0 };
  const live = new Map<string, boolean>();
  const reads = new Map<string, number>();
  let n = 0;
  let statusCalls = 0;
  let peak = 0;
  const h: Harness = {
    submits: [], cancels: [], calls: [], clock, log: [],
    quote: { bid: o.bid, ask: o.ask, ageMs: 1000 },
    maxLive: () => peak,
    deps: undefined as unknown as ExitWalkDeps,
  };
  const liveCount = () => { let c = 0; live.forEach(v => { if (v) c += 1; }); return c; };
  h.deps = {
    async submit(price) {
      h.calls.push('submit');
      const err = o.submitThrows?.(h.submits.length + 1);
      if (err) throw err;
      if (liveCount() > 0) throw new Error('TEST: submit while an order is live');
      n += 1;
      const id = `o${n + 1}`;
      live.set(id, true);
      peak = Math.max(peak, liveCount());
      h.submits.push(price);
      return id;
    },
    async getStatus(id) {
      h.calls.push('status');
      statusCalls += 1;
      const err = o.statusThrows?.(statusCalls);
      if (err) throw err;
      const r = (reads.get(id) ?? 0) + 1;
      reads.set(id, r);
      const forced = o.status?.(id, r, h);
      if (forced) return forced;
      return { state: live.get(id) ? 'live' : 'closed', filledQty: 0, totalQty: 1 };
    },
    async cancel(id) {
      h.calls.push('cancel');
      h.cancels.push(id);
      if (o.cancelThrows?.(id)) throw new Error('broker refused cancel');
      if (!o.stuckLiveAfterCancel) live.set(id, false);
    },
    async getQuote(): Promise<Quote | null> {
      return { t: new Date(clock.now - h.quote.ageMs).toISOString(), bid_c: h.quote.bid, ask_c: h.quote.ask };
    },
    nowMs: () => clock.now,
    async sleep(ms) { clock.now += ms; o.onSleep?.(h); },
    cancelRequested: () => o.cancelRequested?.(h) ?? false,
    abandoned: () => o.abandoned?.(h) ?? false,
    onLog: l => { h.log.push(l); },
  };
  live.set('o1', true);
  peak = 1;
  return h;
}

const q = (bid: number, ask: number): Quote => ({ t: new Date(T0 - 1000).toISOString(), bid_c: bid, ask_c: ask });

function run(h: Harness, side: ExitSide, bid: number, ask: number, firstPrice: number, over: Partial<Parameters<typeof runExitWalk>[0]> = {}): Promise<ExitWalkOutcome> {
  return runExitWalk({ side, tickTable: T1, firstOrderId: 'o1', firstPrice_c: firstPrice, anchor: q(bid, ask), deps: h.deps, ...over });
}

const MRNA = { bid: 208, ask: 300, first: 254 }; // sell
const TQQQ = { bid: 830, ask: 950, first: 890 }; // buy

describe('runExitWalk: the walk itself', () => {
  it('MRNA sell walks down to the live bid and ends working there', async () => {
    const h = harness(MRNA);
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(h.submits).toEqual([245, 236, 227, 218, 209, 208]);
    expect(out.kind).toBe('ended_working');
    if (out.kind === 'ended_working') expect(out.price_c).toBe(208);
    expect(Math.min(...h.submits)).toBeGreaterThanOrEqual(MRNA.bid); // never below the live bid
    expect(h.maxLive()).toBe(1);
  });

  it('TQQQ buy walks up to the live ask and never above it', async () => {
    const h = harness(TQQQ);
    const out = await run(h, 'buy', TQQQ.bid, TQQQ.ask, TQQQ.first);
    expect(h.submits).toEqual([902, 914, 926, 938, 950]);
    expect(out.kind).toBe('ended_working');
    expect(Math.max(...h.submits)).toBeLessThanOrEqual(TQQQ.ask);
    expect(h.maxLive()).toBe(1);
  });

  it('waits the full dwell between prices (fake clock)', async () => {
    const h = harness(MRNA);
    const stamps: number[] = [];
    const base = h.deps.submit;
    h.deps.submit = async p => { stamps.push(h.clock.now); return base(p); };
    await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    for (let i = 1; i < stamps.length; i++) expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(DWELL);
    expect(stamps[0] - T0).toBeGreaterThanOrEqual(DWELL);
  });

  it('honours a configured dwell', async () => {
    const h = harness(MRNA);
    await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first, { config: { dwellMs: 30000 } });
    expect(h.clock.now - T0).toBe(7 * 30000); // 6 resubmits + the final dwell at the floor
  });

  it('reads the status before every cancel, and cancels once per step (no retries)', async () => {
    const h = harness(MRNA);
    await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(h.cancels.length).toBe(h.submits.length);
    h.calls.forEach((call, i) => { if (call === 'cancel') expect(h.calls[i - 1]).toBe('status'); });
    const cancelIdx = h.calls.map((c, i) => (c === 'cancel' ? i : -1)).filter(i => i >= 0);
    cancelIdx.forEach(i => { expect(h.calls[i + 1]).toBe('status'); }); // the cancel is confirmed by a status read
  });

  it('publishes a log with one entry per price', async () => {
    const h = harness(MRNA);
    await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    const last = h.log[h.log.length - 1];
    expect(last.map(e => e.price_c)).toEqual([254, 245, 236, 227, 218, 209, 208]);
  });
});

describe('runExitWalk: fills and races', () => {
  it('a fill at any step stops the walk with no resubmit', async () => {
    const h = harness({ ...MRNA, status: (id) => (id === 'o3' ? { state: 'filled', filledQty: 1, totalQty: 1 } : undefined) });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out.kind).toBe('filled');
    if (out.kind === 'filled') { expect(out.price_c).toBe(236); expect(out.orderId).toBe('o3'); }
    expect(h.submits).toEqual([245, 236]);
  });

  it('a partial fill stops the walk and never resubmits', async () => {
    const h = harness({ ...MRNA, status: (id) => (id === 'o2' ? { state: 'partial', filledQty: 1, totalQty: 2 } : undefined) });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'partial', filledQty: 1, totalQty: 2, price_c: 245 });
    expect(h.submits).toEqual([245]);
  });

  it('a cancel that fails because the order filled is a fill', async () => {
    const h = harness({
      ...MRNA,
      cancelThrows: () => true,
      status: (id, reads) => (id === 'o1' && reads >= 2 ? { state: 'filled', filledQty: 1, totalQty: 1 } : undefined),
    });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out.kind).toBe('filled');
    expect(h.submits).toEqual([]);
  });

  it('a cancel that fails with the order still live stops and says an order is live', async () => {
    const h = harness({ ...MRNA, cancelThrows: () => true });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'cancel_failed', orderLive: true, orderId: 'o1', price_c: 254 });
    expect(h.submits).toEqual([]);
    expect(h.cancels.length).toBe(1); // no retry
  });

  it('a cancel the broker never confirms stops with an order live and resubmits nothing', async () => {
    const h = harness({ ...MRNA, stuckLiveAfterCancel: true });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'cancel_failed', orderLive: true });
    expect(h.submits).toEqual([]);
  });

  it('an order that closed on its own is reported, not resubmitted', async () => {
    const h = harness({ ...MRNA, status: (id) => (id === 'o1' ? { state: 'closed', filledQty: 0, totalQty: 1 } : undefined) });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'order_closed', orderLive: false });
    expect(h.submits).toEqual([]);
  });

  it('an unrecognised status stops and leaves the order alone', async () => {
    const h = harness({ ...MRNA, status: () => ({ state: 'unknown', filledQty: 0, totalQty: 1 }) });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'unknown_status', orderLive: true });
    expect(h.cancels).toEqual([]);
  });

  it('a refused resubmit stops with nothing live', async () => {
    const h = harness({ ...MRNA, submitThrows: () => new Error('rejected') });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'resubmit_failed', orderLive: false, orderId: null });
    expect(h.cancels.length).toBe(1);
  });
});

describe('runExitWalk: halts leave the working order as it is', () => {
  it('a stale quote halts with no cancel and no resubmit', async () => {
    const h = harness(MRNA);
    h.quote.ageMs = 120000;
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'halted', haltReason: 'quote_stale', orderLive: true, orderId: 'o1' });
    expect(h.cancels).toEqual([]);
    expect(h.submits).toEqual([]);
  });

  it('a missing quote halts', async () => {
    const h = harness(MRNA);
    h.deps.getQuote = async () => null;
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'halted', haltReason: 'quote_missing', orderLive: true });
    expect(h.cancels).toEqual([]);
  });

  it('a crossed market halts', async () => {
    const h = harness(MRNA);
    h.quote.bid = 300; h.quote.ask = 208;
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'halted', haltReason: 'invalid_market', orderLive: true });
    expect(h.submits).toEqual([]);
  });

  it('a step that lands in the opening window halts', async () => {
    // 09:42 ET start: the first dwell ends at 09:43:30, still inside [09:30, 09:45).
    const h = harness({ ...MRNA, start: Date.parse('2026-10-19T13:42:00Z') });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'halted', haltReason: 'opening_window', orderLive: true });
    expect(h.cancels).toEqual([]);
  });

  it('a transient quote error is a halt, not a crash', async () => {
    const h = harness(MRNA);
    h.deps.getQuote = async () => { throw new Error('network'); };
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'halted', haltReason: 'quote_missing', orderLive: true });
  });
});

describe('runExitWalk: market moves', () => {
  it('re-anchors when the mid moves more than a step, keeping the step index and never going below the live bid', async () => {
    const moved = { bid: 150, ask: 242 };
    const h = harness({
      ...MRNA,
      onSleep: x => { if (x.submits.length === 2) { x.quote.bid = moved.bid; x.quote.ask = moved.ask; } },
    });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out.kind).toBe('ended_working');
    const plan = buildExitWalk({ side: 'sell', quote: { t: new Date(T0).toISOString(), bid_c: moved.bid, ask_c: moved.ask }, nowMs: T0, tickTable: T1 });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(h.submits[2]).toBe(plan.prices_c[3]); // step index 3 on the new schedule
      expect(Math.min(...h.submits.slice(2))).toBeGreaterThanOrEqual(moved.bid);
    }
    expect(h.maxLive()).toBe(1);
  });

  it('keeps the working order when the market moves away (sell, mid rises)', async () => {
    const h = harness({ ...MRNA, onSleep: x => { x.quote.bid = 260; x.quote.ask = 320; } });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out.kind).toBe('ended_working');
    expect(h.cancels).toEqual([]);
    expect(h.submits).toEqual([]);
  });

  it('keeps the working order when the market moves away (buy, mid falls)', async () => {
    const h = harness({ ...TQQQ, onSleep: x => { x.quote.bid = 700; x.quote.ask = 820; } });
    const out = await run(h, 'buy', TQQQ.bid, TQQQ.ask, TQQQ.first);
    expect(out.kind).toBe('ended_working');
    expect(h.cancels).toEqual([]);
    expect(h.submits).toEqual([]);
  });
});

describe('runExitWalk: Stop walk, page close, session expiry', () => {
  it('Stop during the wait cancels the working order and finishes', async () => {
    const h = harness({ ...MRNA, cancelRequested: x => x.clock.now - T0 >= 10000 });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out.kind).toBe('cancelled');
    expect(h.cancels).toEqual(['o1']);
    expect(h.submits).toEqual([]);
  });

  it('Stop still cancels the working order when the quote is stale', async () => {
    const h = harness({ ...MRNA, cancelRequested: x => x.clock.now - T0 >= 10000 });
    h.quote.ageMs = 120000;
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out.kind).toBe('cancelled');
    expect(h.cancels).toEqual(['o1']);
  });

  it('Stop still cancels the working order when it is already at the boundary', async () => {
    const h = harness({ ...MRNA, cancelRequested: x => x.clock.now - T0 >= 10000 });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, 208);
    expect(out.kind).toBe('cancelled');
    expect(h.cancels).toEqual(['o1']);
  });

  it('Stop pressed during a cancel: nothing is resubmitted', async () => {
    let stop = false;
    const h = harness({ ...MRNA, cancelRequested: () => stop });
    const base = h.deps.cancel;
    h.deps.cancel = async id => { await base(id); stop = true; };
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out.kind).toBe('cancelled');
    expect(h.submits).toEqual([]);
  });

  it('a fill that lands while Stop is cancelling is reported as a fill', async () => {
    const h = harness({
      ...MRNA,
      cancelRequested: x => x.clock.now - T0 >= 10000,
      status: (id, reads) => (id === 'o1' && reads >= 2 ? { state: 'filled', filledQty: 1, totalQty: 1 } : undefined),
    });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out.kind).toBe('filled');
  });

  it('page close during the wait leaves the order working and touches nothing', async () => {
    const h = harness({ ...MRNA, abandoned: x => x.clock.now - T0 >= 10000 });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'abandoned', orderLive: true, orderId: 'o1' });
    expect(h.calls).toEqual([]);
  });

  it('page close during a cancel: nothing is resubmitted and nothing is live', async () => {
    let closed = false;
    const h = harness({ ...MRNA, abandoned: () => closed });
    const base = h.deps.cancel;
    h.deps.cancel = async id => { await base(id); closed = true; };
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'abandoned', orderLive: false });
    expect(h.submits).toEqual([]);
  });

  it('a 401 on a status read stops with the order live', async () => {
    const h = harness({ ...MRNA, statusThrows: () => new WalkAuthError() });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'token_expired', orderLive: true });
    expect(h.cancels).toEqual([]);
  });

  it('a 401 on the resubmit stops with nothing live', async () => {
    const h = harness({ ...MRNA, submitThrows: () => new WalkAuthError() });
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'token_expired', orderLive: false });
  });

  it('a 401 on the cancel stops with the order live and does not re-read or retry', async () => {
    const h = harness(MRNA);
    h.deps.cancel = async id => { h.calls.push('cancel'); h.cancels.push(id); throw new WalkAuthError(); };
    const out = await run(h, 'sell', MRNA.bid, MRNA.ask, MRNA.first);
    expect(out).toMatchObject({ kind: 'stopped', reason: 'token_expired', orderLive: true });
    expect(h.cancels.length).toBe(1);
  });
});

describe('checkWalkStart: refused before any order exists', () => {
  const base = { side: 'sell' as ExitSide, quote: q(208, 300), nowMs: T0, tickTable: T1, hardRisk: false, gapBlocked: false };

  it('starts a normal exit and returns the plan', () => {
    const r = checkWalkStart(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.prices_c[0]).toBe(254);
  });
  it('refuses a hard-risk exit (stop or max loss)', () => {
    expect(checkWalkStart({ ...base, hardRisk: true })).toMatchObject({ ok: false, reason: 'hard_risk' });
  });
  it('refuses when the gap rule blocked the ladder', () => {
    expect(checkWalkStart({ ...base, gapBlocked: true })).toMatchObject({ ok: false, reason: 'gap_block' });
  });
  it('hard risk wins over a gap block', () => {
    expect(checkWalkStart({ ...base, hardRisk: true, gapBlocked: true })).toMatchObject({ ok: false, reason: 'hard_risk' });
  });
  it('passes halts through: opening window, stale, missing, crossed', () => {
    expect(checkWalkStart({ ...base, nowMs: Date.parse('2026-10-19T13:35:00Z'), quote: { t: '2026-10-19T13:34:59Z', bid_c: 208, ask_c: 300 } })).toMatchObject({ ok: false, reason: 'opening_window' });
    expect(checkWalkStart({ ...base, nowMs: T0 + 120000 })).toMatchObject({ ok: false, reason: 'quote_stale' });
    expect(checkWalkStart({ ...base, quote: null })).toMatchObject({ ok: false, reason: 'quote_missing' });
    expect(checkWalkStart({ ...base, quote: q(300, 208) })).toMatchObject({ ok: false, reason: 'invalid_market' });
  });
});

describe('run.ts purity guard', () => {
  it('has no clock, randomness, timers, network or UI imports', () => {
    const src = readFileSync(join(__dirname, '..', 'run.ts'), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(src).not.toMatch(/Date\.now|new Date\(|Math\.random|setTimeout|setInterval|fetch\(|localStorage|window\./);
    expect(src).not.toMatch(/from '@\/(app|components|features)/);
  });
});
