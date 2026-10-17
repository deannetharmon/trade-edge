// lib/exit-walk/__tests__/browserDeps.test.ts
//
// EXIT-WALK-0001B step 2: the broker calls behind the exit walk. fetch is faked; nothing leaves the process.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WalkAuthError } from '@/lib/entry-walk/walk';
import { runExitWalk } from '../run';
import {
  centsToPriceString,
  createBrowserExitWalkDeps,
  createDryRunExitWalkDeps,
  exitQuoteFromLegs,
  type BrowserExitWalkConfig,
} from '../browserDeps';

const NOW = Date.parse('2026-10-19T15:00:00Z');
const ACCT = '5WX12345';

interface Call { url: string; method: string; body: any; auth: string | null }
function fakeFetch(respond: (c: Call) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call: Call = {
      url, method: String(init?.method ?? 'GET'),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
    };
    calls.push(call);
    const r = respond(call);
    const status = r.status ?? 200;
    return { status, ok: status >= 200 && status < 300, json: async () => r.json ?? {} };
  });
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); });

const raw = (symbol: string, bid: number | null, ask: number | null, ageSeconds: number | null = 2) => ({ symbol, bid, ask, ageSeconds });
const SELL_LEG = [{ symbol: 'MRNA  261120P00140000', action: 'Sell to Close' }];
const BUY_LEG = [{ symbol: 'TQQQ  261106P00075500', action: 'Buy to Close' }];

function config(over: Partial<BrowserExitWalkConfig> = {}): BrowserExitWalkConfig {
  return {
    accountNumber: ACCT,
    side: 'sell',
    legs: SELL_LEG,
    getToken: async () => 'tok',
    fetchQuotes: async () => [raw(SELL_LEG[0].symbol, 2.08, 3.0)],
    buildPayload: price_c => ({ 'order-type': 'Limit', price: centsToPriceString(price_c), legs: [{ symbol: SELL_LEG[0].symbol, action: 'Sell to Close' }] }),
    nowMs: () => NOW,
    cancelRequested: () => false,
    abandoned: () => false,
    sleep: async () => {},
    ...over,
  };
}

describe('exitQuoteFromLegs', () => {
  it('sell: bid and ask pass through in cents', () => {
    expect(exitQuoteFromLegs('sell', SELL_LEG, [raw(SELL_LEG[0].symbol, 2.08, 3.0)], NOW)).toMatchObject({ bid_c: 208, ask_c: 300 });
  });
  it('buy: the debit range, lowest first', () => {
    expect(exitQuoteFromLegs('buy', BUY_LEG, [raw(BUY_LEG[0].symbol, 8.3, 9.5)], NOW)).toMatchObject({ bid_c: 830, ask_c: 950 });
  });
  it('a credit spread close (buy short, sell long) reads as a debit range', () => {
    const legs = [{ symbol: 'S', action: 'Buy to Close' }, { symbol: 'L', action: 'Sell to Close' }];
    const quote = exitQuoteFromLegs('buy', legs, [raw('S', 1.5, 1.7), raw('L', 0.4, 0.5)], NOW);
    expect(quote).toMatchObject({ bid_c: 100, ask_c: 130 }); // pay 1.70-0.40 worst, 1.50-0.50 best
  });
  it('timestamps the quote from its age', () => {
    const quote = exitQuoteFromLegs('sell', SELL_LEG, [raw(SELL_LEG[0].symbol, 2.08, 3.0, 20)], NOW);
    expect(quote?.t).toBe(new Date(NOW - 20000).toISOString());
  });
  it('is null for a missing, crossed or zero-bid leg, or an unknown age', () => {
    expect(exitQuoteFromLegs('sell', SELL_LEG, [], NOW)).toBeNull();
    expect(exitQuoteFromLegs('sell', SELL_LEG, [raw(SELL_LEG[0].symbol, 3.0, 2.0)], NOW)).toBeNull();
    expect(exitQuoteFromLegs('sell', SELL_LEG, [raw(SELL_LEG[0].symbol, 0, 0.05)], NOW)).toBeNull();
    expect(exitQuoteFromLegs('sell', SELL_LEG, [raw(SELL_LEG[0].symbol, 2.08, 3.0, null)], NOW)).toBeNull();
  });
});

describe('createBrowserExitWalkDeps (live)', () => {
  it('submit POSTs a simple order and returns its id', async () => {
    const calls = fakeFetch(() => ({ json: { data: { order: { id: 98765 } } } }));
    const deps = createBrowserExitWalkDeps(config());
    expect(await deps.submit(245)).toBe('98765');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `https://api.tastytrade.com/accounts/${ACCT}/orders`, auth: 'Bearer tok' });
    expect(calls[0].body.price).toBe('2.45');
  });
  it('submit fails when the broker returns no order id', async () => {
    fakeFetch(() => ({ json: { data: {} } }));
    await expect(createBrowserExitWalkDeps(config()).submit(245)).rejects.toThrow(/order id/);
  });
  it('a failing onSubmitted only warns', async () => {
    fakeFetch(() => ({ json: { data: { order: { id: 1 } } } }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = createBrowserExitWalkDeps(config({ onSubmitted: async () => { throw new Error('record failed'); } }));
    expect(await deps.submit(245)).toBe('1');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('getStatus GETs the order and parses it', async () => {
    const calls = fakeFetch(() => ({ json: { data: { id: 7, status: 'Live', legs: [{ quantity: 2, fills: [] }] } } }));
    const status = await createBrowserExitWalkDeps(config()).getStatus('7');
    expect(status).toMatchObject({ state: 'live', totalQty: 2 });
    expect(calls[0]).toMatchObject({ method: 'GET', url: `https://api.tastytrade.com/accounts/${ACCT}/orders/7` });
  });
  it('getStatus reads a filled order and an unrecognised one', async () => {
    fakeFetch(() => ({ json: { data: { status: 'Filled', legs: [{ quantity: 1, fills: [{ quantity: 1 }] }] } } }));
    expect((await createBrowserExitWalkDeps(config()).getStatus('7')).state).toBe('filled');
    fakeFetch(() => ({ json: { data: { status: 'Something New', legs: [{ quantity: 1 }] } } }));
    expect((await createBrowserExitWalkDeps(config()).getStatus('7')).state).toBe('unknown');
  });
  it('cancel DELETEs the order', async () => {
    const calls = fakeFetch(() => ({}));
    await createBrowserExitWalkDeps(config()).cancel('7');
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: `https://api.tastytrade.com/accounts/${ACCT}/orders/7` });
  });
  it('a 401 on any call is a WalkAuthError', async () => {
    fakeFetch(() => ({ status: 401 }));
    const deps = createBrowserExitWalkDeps(config());
    await expect(deps.submit(245)).rejects.toBeInstanceOf(WalkAuthError);
    await expect(deps.getStatus('7')).rejects.toBeInstanceOf(WalkAuthError);
    await expect(deps.cancel('7')).rejects.toBeInstanceOf(WalkAuthError);
  });
  it('other failures carry the broker message and are never retried', async () => {
    const calls = fakeFetch(() => ({ status: 422, json: { error: { message: 'price outside tick' } } }));
    await expect(createBrowserExitWalkDeps(config()).submit(245)).rejects.toThrow('price outside tick');
    expect(calls).toHaveLength(1);
  });
  it('getQuote reads the position quote through the injected fetcher', async () => {
    const quote = await createBrowserExitWalkDeps(config()).getQuote();
    expect(quote).toMatchObject({ bid_c: 208, ask_c: 300 });
  });
});

describe('createDryRunExitWalkDeps (Ian C2): nothing is ever placed', () => {
  it('submit validates at /orders/dry-run and never POSTs a real order', async () => {
    const calls = fakeFetch(() => ({ json: { data: { order: {} }, warnings: [] } }));
    const deps = createDryRunExitWalkDeps(config());
    expect(await deps.submit(245)).toBe('dry-1');
    expect(await deps.submit(236)).toBe('dry-2');
    expect(calls.map(c => c.url)).toEqual([
      `https://api.tastytrade.com/accounts/${ACCT}/orders/dry-run`,
      `https://api.tastytrade.com/accounts/${ACCT}/orders/dry-run`,
    ]);
    expect(calls.map(c => c.body.price)).toEqual(['2.45', '2.36']);
  });
  it('a validation error rejects, so the walk stops with nothing live', async () => {
    fakeFetch(() => ({ json: { data: {}, errors: [{ message: 'tick size' }] } }));
    await expect(createDryRunExitWalkDeps(config()).submit(245)).rejects.toThrow('tick size');
  });
  it('a synthetic order reads live until cancelled; cancel makes no request', async () => {
    const calls = fakeFetch(() => ({}));
    const deps = createDryRunExitWalkDeps(config());
    expect((await deps.getStatus('dry-1')).state).toBe('live');
    await deps.cancel('dry-1');
    expect((await deps.getStatus('dry-1')).state).toBe('closed');
    expect((await deps.getStatus('dry-2')).state).toBe('live');
    expect(calls).toHaveLength(0);
  });
  it('a 401 is a WalkAuthError', async () => {
    fakeFetch(() => ({ status: 401 }));
    await expect(createDryRunExitWalkDeps(config()).submit(245)).rejects.toBeInstanceOf(WalkAuthError);
  });
  it('end to end: the walk steps through every price on real-shaped quotes and places nothing', async () => {
    const calls = fakeFetch(() => ({ json: { data: { order: {} } } }));
    let now = NOW;
    const deps = createDryRunExitWalkDeps(config({ nowMs: () => now, sleep: async ms => { now += ms; } }));
    const first = await deps.submit(254);
    const out = await runExitWalk({
      side: 'sell', tickTable: [{ threshold: null, value: 0.01 }], firstOrderId: first, firstPrice_c: 254,
      anchor: { t: new Date(NOW - 2000).toISOString(), bid_c: 208, ask_c: 300 }, deps,
    });
    expect(out).toMatchObject({ kind: 'ended_working' });
    expect(calls.every(c => c.url.endsWith('/orders/dry-run') && c.method === 'POST')).toBe(true);
    expect(calls.map(c => c.body.price)).toEqual(['2.54', '2.45', '2.36', '2.27', '2.18', '2.09', '2.08']);
  });
});
