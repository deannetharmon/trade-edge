// lib/__tests__/tradeMapSend.test.ts

import { describe, expect, it } from 'vitest';
import { brokerErrorText, placeSend, validateSend, type BrokerResponse, type SendDeps, type SendInput } from '../orders/tradeMapSend';
import type { LegSpec } from '../trademap/strategies';

const SHORT = 'SOXL  261218P00045000';
const LONG = 'SOXL  261218P00040000';
const specs: LegSpec[] = [
  { right: 'P', side: 'short', strike: 45, symbol: SHORT },
  { right: 'P', side: 'long', strike: 40, symbol: LONG },
];
const input: SendInput = { strategy: 'bps', specs, isIndex: false, displayedCredit: 1.45, quantity: 1, tickTable: null, root: 'SOXL' };

function deps(over: Partial<SendDeps> & { clock?: { t: number } } = {}) {
  const calls: Array<{ path: string; body: any }> = [];
  const clock = over.clock ?? { t: 1_000_000 };
  const d: SendDeps = {
    now: () => clock.t,
    marketOpen: () => true,
    getToken: async () => 'tok',
    getAccountNumber: async () => '5WX00000',
    fetchQuotes: async () => [
      { symbol: SHORT, bid: 2.0, ask: 2.1, ageSeconds: 3 },
      { symbol: LONG, bid: 0.6, ask: 0.7, ageSeconds: 4 },
    ],
    post: async (path, _t, body): Promise<BrokerResponse> => { calls.push({ path, body }); return { ok: true, status: 200, data: { data: { 'complex-order': { id: 987 } } } }; },
    ...over,
  };
  return { d, calls, clock };
}

describe('ORDER-SEND-0001 S3c: validate', () => {
  it('market closed: nothing is read or sent', async () => {
    const { d, calls } = deps({ marketOpen: () => false });
    const r = await validateSend(d, input);
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it('stale, crossed or missing quotes stop it before any dry run', async () => {
    for (const q of [
      [{ symbol: SHORT, bid: 2, ask: 2.1, ageSeconds: 40 }, { symbol: LONG, bid: 0.6, ask: 0.7, ageSeconds: 2 }],
      [{ symbol: SHORT, bid: 2.2, ask: 2.1, ageSeconds: 2 }, { symbol: LONG, bid: 0.6, ask: 0.7, ageSeconds: 2 }],
      [{ symbol: SHORT, bid: 2, ask: 2.1, ageSeconds: 2 }],
    ]) {
      const { d, calls } = deps({ fetchQuotes: async () => q });
      expect((await validateSend(d, input)).ok).toBe(false);
      expect(calls).toEqual([]);
    }
  });
  it('re-price: the credit moved more than 5 cents aborts and names the new credit', async () => {
    const { d, calls } = deps();
    const r = await validateSend(d, { ...input, displayedCredit: 1.2 });
    expect(r.ok).toBe(false);
    expect((r as any).reason).toContain('$1.40');
    expect(calls).toEqual([]);
  });
  it('a good validation dry-runs the exact payload at the fresh mid with the 50% target and 2x stop', async () => {
    const { d, calls } = deps();
    const r = await validateSend(d, input);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/accounts/5WX00000/complex-orders/dry-run');
    const v = r as any;
    expect(v.freshMid).toBe(1.4);
    expect(v.entry).toBe(1.4);
    expect(v.profitBuyback).toBe(0.7);
    expect(v.record.payloadJson).toBe(JSON.stringify(calls[0].body));
  });
  it('a broker rejection of the dry run is reported with its nested reason and nothing is placed', async () => {
    const { d, calls } = deps({ post: async () => { return { ok: false, status: 422, data: { error: { message: 'Preflight failed', errors: [{ message: 'Insufficient buying power' }] } } }; } });
    const r = await validateSend(d, input);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toContain('Insufficient buying power');
  });
  it('a refused token is replaced and the dry run sent once more', async () => {
    let n = 0;
    const { d } = deps({ post: async () => (n++ === 0 ? { ok: false, status: 401, data: { error: { message: 'token expired' } } } : { ok: true, status: 200, data: {} }) });
    expect((await validateSend(d, input)).ok).toBe(true);
    expect(n).toBe(2);
  });
});

describe('ORDER-SEND-0001 S3c: place (live submit is unreachable without a fresh valid dry run)', () => {
  async function validated() {
    const ctx = deps();
    const v = await validateSend(ctx.d, input);
    if (!v.ok) throw new Error('setup');
    ctx.calls.length = 0;
    return { ...ctx, v };
  }
  it('places once, to the live endpoint, with the validated payload', async () => {
    const { d, calls, v } = await validated();
    const r = await placeSend(d, v);
    expect(r).toEqual({ ok: true, orderId: '987' });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/accounts/5WX00000/complex-orders');
    expect(JSON.stringify(calls[0].body)).toBe(v.record.payloadJson);
  });
  it('a validation older than 15 seconds is refused and nothing is sent', async () => {
    const { d, calls, v, clock } = await validated();
    clock.t += 16_000;
    const r = await placeSend(d, v);
    expect(r.ok).toBe(false);
    expect((r as any).sent).toBe(false);
    expect(calls).toEqual([]);
  });
  it('a changed payload is refused', async () => {
    const { d, calls, v } = await validated();
    const r = await placeSend(d, { ...v, payload: { ...(v.payload as object), price: 9 } });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it('market closing between validate and place is refused', async () => {
    const { d, calls, v } = await validated();
    const r = await placeSend({ ...d, marketOpen: () => false }, v);
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it('a rejection is shown once and never resent', async () => {
    const { d, calls, v } = await validated();
    const r = await placeSend({ ...d, post: async (p, _t, b) => { calls.push({ path: p, body: b }); return { ok: false, status: 422, data: { error: { message: 'Rejected' } } }; } }, v);
    expect(r.ok).toBe(false);
    expect((r as any).sent).toBe(true);
    expect(calls).toHaveLength(1);
  });
  it('a network failure says the order may exist and is not resent', async () => {
    const { d, calls, v } = await validated();
    const r = await placeSend({ ...d, post: async () => { throw new Error('net'); } }, v);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toContain('Pending orders');
    expect(calls).toEqual([]);
  });
  it('a response with no order id is reported', async () => {
    const { d, v } = await validated();
    const r = await placeSend({ ...d, post: async () => ({ ok: true, status: 200, data: {} }) }, v);
    expect(r.ok).toBe(false);
  });
});

describe('brokerErrorText', () => {
  it('joins the top message and nested reasons without duplicates', () => {
    expect(brokerErrorText({ error: { message: 'A', errors: [{ message: 'B' }, { code: 'A' }] } }, 'x')).toBe('A — B');
    expect(brokerErrorText({}, 'fallback')).toBe('fallback');
  });
});
