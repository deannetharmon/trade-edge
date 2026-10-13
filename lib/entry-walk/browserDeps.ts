// lib/entry-walk/browserDeps.ts
//
// ENTRY-WALK-0001: the browser-side broker calls behind the walk engine (TastyTrade is browser-side only).
// Every call here is a single attempt: nothing retries, and a 401 becomes WalkAuthError so the walk stops.

import { priceStillValid } from './ladder';
import { netQuoteFromLegs, parseComplexOrderStatus, type RawQuote, type WalkLeg } from './broker';
import { WalkAuthError, type WalkDeps, type WalkLogEntry } from './walk';
import type { TickTable } from '@/lib/portfolio/tickSize';

const BASE = 'https://api.tastytrade.com';

export interface BrowserWalkConfig {
  accountNumber: string;
  legs: WalkLeg[];
  tickTable: TickTable | null;
  getToken(): Promise<string>;
  fetchQuotes(symbols: string[], token: string): Promise<RawQuote[]>;
  /** Builds the whole entry bracket for one step price (the profit target and stop are recomputed from it). */
  buildPayload(price: number): unknown;
  /** Called after each resubmit so the pending-entry records follow the live order. Failures only warn. */
  onSubmitted?(response: any, price: number): Promise<void>;
  cancelRequested(): boolean;
  abandoned(): boolean;
  onLog?(log: WalkLogEntry[]): void;
  sleep?(ms: number): Promise<void>;
}

async function call(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (res.status === 401) throw new WalkAuthError();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? data?.errors?.[0]?.message ?? `Request failed (${res.status})`);
  return data;
}

export function createBrowserWalkDeps(config: BrowserWalkConfig): WalkDeps {
  const headers = async (json = false) => ({ Authorization: `Bearer ${await config.getToken()}`, ...(json ? { 'Content-Type': 'application/json' } : {}) });
  const orderUrl = (id: string) => `${BASE}/accounts/${config.accountNumber}/complex-orders/${encodeURIComponent(id)}`;
  return {
    async submit(price) {
      const data = await call(`${BASE}/accounts/${config.accountNumber}/complex-orders`, {
        method: 'POST', headers: await headers(true), body: JSON.stringify(config.buildPayload(price)),
      });
      const id = data?.data?.['complex-order']?.id ?? data?.data?.order?.id;
      if (id == null) throw new Error('The broker did not return an order id.');
      try { await config.onSubmitted?.(data, price); } catch (error) { console.warn(error); }
      return String(id);
    },
    async getStatus(id) {
      return parseComplexOrderStatus(await call(orderUrl(id), { method: 'GET', headers: await headers() }));
    },
    async cancel(id) {
      await call(orderUrl(id), { method: 'DELETE', headers: await headers() });
    },
    async getQuote() {
      const token = await config.getToken();
      const quotes = await config.fetchQuotes(config.legs.map(l => l.symbol), token);
      return netQuoteFromLegs(config.legs, quotes);
    },
    priceValid(quote, price) {
      return priceStillValid({ side: 'credit', netBid: quote.netBid, netAsk: quote.netAsk, legSpreads: quote.legSpreads, minCredit: null, tickTable: config.tickTable }, price);
    },
    sleep: config.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))),
    cancelRequested: config.cancelRequested,
    abandoned: config.abandoned,
    onLog: config.onLog,
  };
}
