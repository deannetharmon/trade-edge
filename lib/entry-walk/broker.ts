// lib/entry-walk/broker.ts
//
// ENTRY-WALK-0001: pure helpers between the TastyTrade responses and the walk engine. Anything this file does not
// recognise becomes state 'unknown', which stops the walk without touching the order.

import type { WalkOrderStatus, WalkQuote } from './walk';

const LIVE = new Set(['received', 'routed', 'in flight', 'live', 'contingent', 'cancel requested', 'replace requested', 'pending']);
const CLOSED = new Set(['cancelled', 'canceled', 'expired', 'rejected', 'removed', 'partially removed']);

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Status of the ENTRY order inside a GET /accounts/{acct}/complex-orders/{id} response.
 * The entry is the OTOCO's trigger order; the contingent exits are never opening-fill evidence.
 */
export function parseComplexOrderStatus(json: unknown): WalkOrderStatus {
  const data = (json as { data?: Record<string, any> } | null)?.data;
  const entry = data?.['trigger-order'] ?? data;
  const rawStatus = typeof entry?.status === 'string' ? entry.status : typeof data?.status === 'string' ? data.status : null;
  const legs: any[] = Array.isArray(entry?.legs) ? entry.legs : [];
  if (!rawStatus || legs.length === 0) return { state: 'unknown', filledQty: 0, totalQty: 0 };

  // Contracts filled = the smallest per-leg fill (a spread only counts as filled once every leg has).
  const perLeg = legs.map(leg => {
    const total = num(leg?.quantity);
    const fills: any[] = Array.isArray(leg?.fills) ? leg.fills : [];
    const filledFromFills = fills.reduce((sum, fill) => sum + num(fill?.quantity), 0);
    const filledFromRemaining = leg?.['remaining-quantity'] != null ? Math.max(0, total - num(leg['remaining-quantity'])) : 0;
    return { total, filled: Math.max(filledFromFills, filledFromRemaining) };
  });
  const totalQty = Math.max(...perLeg.map(l => l.total));
  const filledQty = Math.min(...perLeg.map(l => l.filled));
  const status = rawStatus.trim().toLowerCase();

  if (status === 'filled') return { state: 'filled', filledQty: totalQty, totalQty };
  if (filledQty > 0 && filledQty < totalQty) return { state: 'partial', filledQty, totalQty };
  if (LIVE.has(status)) return { state: 'live', filledQty: 0, totalQty };
  if (CLOSED.has(status)) return { state: 'closed', filledQty: 0, totalQty };
  return { state: 'unknown', filledQty, totalQty };
}

export interface WalkLeg { symbol: string; action: string }
export interface RawQuote { symbol: string; bid: number | null; ask: number | null; ageSeconds: number | null }

/**
 * Net executable quote for a whole order. Sold legs count at their bid/ask, bought legs at their ask/bid, so
 * netBid is what the order would receive immediately and netAsk is the best case. Null when any leg has no quote.
 */
export function netQuoteFromLegs(legs: WalkLeg[], quotes: RawQuote[]): WalkQuote | null {
  const bySymbol = new Map(quotes.map(q => [q.symbol, q]));
  let netBid = 0;
  let netAsk = 0;
  let age: number | null = 0;
  const legSpreads: number[] = [];
  for (const leg of legs) {
    const q = bySymbol.get(leg.symbol);
    if (!q || q.bid == null || q.ask == null || q.bid <= 0 || q.ask < q.bid) return null;
    legSpreads.push(Number((q.ask - q.bid).toFixed(2)));
    const sold = leg.action.startsWith('Sell');
    netBid += sold ? q.bid : -q.ask;
    netAsk += sold ? q.ask : -q.bid;
    age = q.ageSeconds == null || age == null ? null : Math.max(age, q.ageSeconds);
  }
  return { netBid: Number(netBid.toFixed(2)), netAsk: Number(netAsk.toFixed(2)), legSpreads, ageSeconds: age };
}
