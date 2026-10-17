// lib/exit-walk/browserDeps.ts
//
// EXIT-WALK-0001B step 2: the browser-side TastyTrade calls behind the exit walk (TastyTrade is browser-side only).
// Every call is a single attempt: nothing retries, and a 401 becomes WalkAuthError so the walk stops.
// Two variants share one shape: live (real orders) and dry run (Ian's C2: the order is validated at /orders/dry-run at
// every price, nothing is placed, and a synthetic order reads live until cancelled so the walk steps through its prices).
// Still unwired: the portfolio page does not call this yet (step 3).

import { netQuoteFromLegs, parseComplexOrderStatus, type RawQuote, type WalkLeg } from '@/lib/entry-walk/broker';
import { WalkAuthError } from '@/lib/entry-walk/walk';
import type { ExitWalkDeps, ExitWalkLogEntry } from './run';
import type { ExitSide, Quote } from './types';

const BASE = 'https://api.tastytrade.com';

export interface BrowserExitWalkConfig {
  accountNumber: string;
  side: ExitSide;
  /** The legs being closed, with their closing actions (for example Sell to Close). */
  legs: WalkLeg[];
  getToken(): Promise<string>;
  fetchQuotes(symbols: string[], token: string): Promise<RawQuote[]>;
  /** Builds the whole closing order body for one step price in integer cents. */
  buildPayload(price_c: number): unknown;
  /** Called after each (re)submit so pending-order records follow the live order. Failures only warn. */
  onSubmitted?(response: any, price_c: number): Promise<void>;
  nowMs?(): number;
  cancelRequested(): boolean;
  abandoned(): boolean;
  onLog?(log: ExitWalkLogEntry[]): void;
  sleep?(ms: number): Promise<void>;
}

/**
 * Net executable quote for the position being closed, in integer cents, as the exit walk reads it.
 * sell = receive a credit: bid is what it pays now, ask is the best case.
 * buy = pay a debit: bid is the best case (lowest debit), ask is what it costs now.
 * Null when any leg has no usable quote or the quote has no age (an unknown age is treated as stale).
 */
export function exitQuoteFromLegs(side: ExitSide, legs: WalkLeg[], quotes: RawQuote[], nowMs: number): Quote | null {
  const net = netQuoteFromLegs(legs, quotes);
  if (!net || net.ageSeconds == null) return null;
  const c = (dollars: number) => Math.round(dollars * 100);
  const bid_c = side === 'sell' ? c(net.netBid) : c(-net.netAsk);
  const ask_c = side === 'sell' ? c(net.netAsk) : c(-net.netBid);
  return { t: new Date(nowMs - net.ageSeconds * 1000).toISOString(), bid_c, ask_c };
}

export const centsToPriceString = (price_c: number): string => (price_c / 100).toFixed(2);

async function call(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (res.status === 401) throw new WalkAuthError();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? data?.errors?.[0]?.message ?? `Request failed (${res.status})`);
  return data;
}

function shared(config: BrowserExitWalkConfig) {
  const nowMs = config.nowMs ?? (() => Date.now());
  const headers = async (json = false) => ({ Authorization: `Bearer ${await config.getToken()}`, ...(json ? { 'Content-Type': 'application/json' } : {}) });
  return {
    headers,
    base: {
      async getQuote(): Promise<Quote | null> {
        const token = await config.getToken();
        const quotes = await config.fetchQuotes(config.legs.map(l => l.symbol), token);
        return exitQuoteFromLegs(config.side, config.legs, quotes, nowMs());
      },
      nowMs,
      sleep: config.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))),
      cancelRequested: config.cancelRequested,
      abandoned: config.abandoned,
      onLog: config.onLog,
    },
  };
}

/** Live exit walk: simple closing orders at /accounts/{acct}/orders. */
export function createBrowserExitWalkDeps(config: BrowserExitWalkConfig): ExitWalkDeps {
  const { headers, base } = shared(config);
  const orderUrl = (id: string) => `${BASE}/accounts/${config.accountNumber}/orders/${encodeURIComponent(id)}`;
  return {
    ...base,
    async submit(price_c) {
      const data = await call(`${BASE}/accounts/${config.accountNumber}/orders`, {
        method: 'POST', headers: await headers(true), body: JSON.stringify(config.buildPayload(price_c)),
      });
      const id = data?.data?.order?.id;
      if (id == null) throw new Error('The broker did not return an order id.');
      try { await config.onSubmitted?.(data, price_c); } catch (error) { console.warn(error); }
      return String(id);
    },
    async getStatus(id) {
      return parseComplexOrderStatus(await call(orderUrl(id), { method: 'GET', headers: await headers() }));
    },
    async cancel(id) {
      await call(orderUrl(id), { method: 'DELETE', headers: await headers() });
    },
  };
}

/**
 * Dry-run exit walk (Ian C2). Each price is validated at /orders/dry-run; no order is ever placed. Order ids are
 * synthetic, a synthetic order reads live until it is cancelled (cancel makes no request), so the walk steps through every price on real quotes.
 */
export function createDryRunExitWalkDeps(config: BrowserExitWalkConfig): ExitWalkDeps {
  const { headers, base } = shared(config);
  let n = 0;
  const cancelled = new Set<string>();
  return {
    ...base,
    async submit(price_c) {
      const data = await call(`${BASE}/accounts/${config.accountNumber}/orders/dry-run`, {
        method: 'POST', headers: await headers(true), body: JSON.stringify(config.buildPayload(price_c)),
      });
      const errors: any[] = Array.isArray(data?.data?.errors) ? data.data.errors : Array.isArray(data?.errors) ? data.errors : [];
      if (errors.length > 0) throw new Error(errors.map(e => e?.message ?? String(e)).join('; '));
      n += 1;
      try { await config.onSubmitted?.(data, price_c); } catch (error) { console.warn(error); }
      return `dry-${n}`;
    },
    async getStatus(id) { return { state: cancelled.has(id) ? 'closed' : 'live', filledQty: 0, totalQty: 1 }; },
    async cancel(id) { cancelled.add(id); /* no request: nothing was placed */ },
  };
}
