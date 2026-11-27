// lib/scans/ccOrderDeps.ts

// CC-ORDERS-0001 slice B: the real broker wiring for the covered-call order dialog. Browser-side only (TastyTrade
// blocks Vercel server IPs). Every call the dialog makes to the outside world goes through this one object, so the
// dialog itself is tested with fakes. Same endpoints and checks the CSP dialog uses.

import { derivePmccMarketSession } from '@/lib/scans/pmccProduction';
import { getAccessToken, getExecutableOptionQuotes, ttFetch } from '@/lib/scans/tastytrade-client';
import { requireActiveBrokerAccount } from '@/lib/tastytrade/accountSelection';
import { defaultLookupDeps } from '@/lib/tradeLookup/defaultDeps';
import type { CoverageReports } from '@/lib/tradeLookup/loadLookup';
import { deriveStockEntry } from '@/lib/portfolio/entryFromTransactions';
import { loadHistory } from '@/features/screener/useCcAdjustedBasis';
import type { CcLot } from '@/lib/scans/ccLotLoss';

export interface CcExecutableQuote {
  bid: number | null;
  ask: number | null;
  ageSeconds: number | null;
}

export interface CcOrderDeps {
  isMarketOpen(): boolean;
  /** Live executable quote for one option symbol, or null when none came back. */
  fetchQuote(occSymbol: string): Promise<CcExecutableQuote | null>;
  /** Fresh broker reading of share and LEAP coverage. Throws or returns nulls when it cannot verify. */
  readCoverage(): Promise<CoverageReports>;
  /**
   * CC-LOTS-0001: the open share lots, oldest first, rebuilt from the broker's transactions. Null when they cannot be
   * proven to equal the shares held (the dialog then falls back to the average cost basis). Optional so fakes may omit it.
   */
  readLots?(symbol: string, sharesOwned: number): Promise<CcLot[] | null>;
  /** Broker dry run of the payload. Returns the broker's `data` object. */
  dryRun(payload: unknown): Promise<any>;
  /** Places the payload. Returns the broker order id. */
  place(payload: unknown): Promise<{ orderId: string }>;
  now(): number;
}

/** TastyTrade nests the real reason under error.errors[]; show both the headline and the details. */
export function brokerErrorText(data: any, fallback: string): string {
  const parts: string[] = [];
  const top = data && data.error && data.error.message;
  if (top) parts.push(String(top));
  const details = data && data.error && Array.isArray(data.error.errors) ? data.error.errors : data && Array.isArray(data.errors) ? data.errors : [];
  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    const m = d && (d.message || d.code);
    if (m && parts.indexOf(String(m)) === -1) parts.push(String(m));
  }
  return parts.length ? parts.join(' — ') : fallback;
}

async function accountAndToken(): Promise<{ token: string; accountNumber: string }> {
  const token = await getAccessToken();
  const accountNumber = await requireActiveBrokerAccount(token, ttFetch, { forceValidation: true });
  if (!accountNumber) throw new Error('No active broker account is selected. Select one and try again.');
  return { token, accountNumber };
}

async function postComplexOrder(path: 'complex-orders/dry-run' | 'complex-orders', payload: unknown): Promise<any> {
  const { token, accountNumber } = await accountAndToken();
  const res = await fetch('https://api.tastytrade.com/accounts/' + accountNumber + '/' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(brokerErrorText(data, (path === 'complex-orders' ? 'Order failed (' : 'Dry run failed (') + res.status + ')'));
  return data;
}

export const defaultCcOrderDeps: CcOrderDeps = {
  isMarketOpen() {
    return derivePmccMarketSession(new Date()) === 'open';
  },
  async fetchQuote(occSymbol) {
    const token = await getAccessToken();
    const quotes = await getExecutableOptionQuotes([occSymbol], token);
    const q = quotes[0];
    return q ? { bid: q.bid, ask: q.ask, ageSeconds: q.ageSeconds } : null;
  },
  async readCoverage() {
    const token = await getAccessToken();
    return defaultLookupDeps.getCoverageReports(token);
  },
  async readLots(symbol, sharesOwned) {
    // The same history the stock card loads, fetched once per page visit and shared (no extra broker calls per dialog).
    // Null when the fetch failed, and deriveStockEntry returns null when the lots do not add up to today's shares, so a
    // stale history can only ever fall back to the average, never invent a lot.
    const tx = await loadHistory();
    if (!tx) return null;
    const entry = deriveStockEntry({ transactions: tx, symbol, sharesOwned });
    return entry ? entry.lots.map(l => ({ shares: l.shares, price: l.price, day: l.day })) : null;
  },
  async dryRun(payload) {
    const data = await postComplexOrder('complex-orders/dry-run', payload);
    return data && data.data;
  },
  async place(payload) {
    const data = await postComplexOrder('complex-orders', payload);
    const id = data && data.data && ((data.data['complex-order'] && data.data['complex-order'].id) || (data.data.order && data.data.order.id));
    return { orderId: String(id == null ? 'submitted' : id) };
  },
  now() {
    return Date.now();
  },
};
