// lib/market/marketQuotes.ts
//
// MARKET-MAP-0001: batched stock quotes for the Market Map. TastyTrade caps a market-data request at 100 instruments, so tickers go in
// batches of 100, a few at a time. Nothing here guesses: a stock without a usable last price or previous close gets null and is drawn
// gray, and the result counts how many came back so the page can say so.

import { brokerSymbol } from './universe';
import { pctChange } from './marketMapMath';

export const QUOTE_BATCH_SIZE = 100;
export const QUOTE_BATCH_CONCURRENCY = 3;

export interface StockQuote {
  ticker: string;
  last: number | null;
  prevClose: number | null;
  pct: number | null;
}

export interface QuoteReport {
  quotes: Map<string, StockQuote>;
  requested: number;
  /** Tickers the broker returned an item for. */
  received: number;
  /** Tickers with both a last price and a previous close (so a % change). */
  withChange: number;
  /** Batches that failed outright (network or broker error). */
  failedBatches: number;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** One TastyTrade market-data item -> last price and previous close. Field names follow the broker's: `prev-close`. */
export function normalizeEquityItem(item: any): { symbol: string; last: number | null; prevClose: number | null } {
  const bid = num(item?.bid);
  const ask = num(item?.ask);
  const mid = bid != null && ask != null && bid > 0 && ask >= bid ? (bid + ask) / 2 : null;
  const last = num(item?.last) ?? num(item?.mark) ?? num(item?.mid) ?? mid;
  const prevClose = num(item?.['prev-close']) ?? num(item?.['previous-close']) ?? num(item?.prevClose);
  return { symbol: String(item?.symbol ?? ''), last, prevClose };
}

export type MarketFetcher = (path: string) => Promise<any>;

export async function fetchStockQuotes(tickers: string[], fetcher: MarketFetcher): Promise<QuoteReport> {
  const unique = Array.from(new Set(tickers));
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += QUOTE_BATCH_SIZE) batches.push(unique.slice(i, i + QUOTE_BATCH_SIZE));
  const bySymbol = new Map<string, ReturnType<typeof normalizeEquityItem>>();
  let failedBatches = 0;
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const qs = batch.map(t => `equity=${encodeURIComponent(brokerSymbol(t))}`).join('&');
      try {
        const data = await fetcher(`/market-data/by-type?${qs}`);
        for (const item of data?.data?.items ?? []) {
          const q = normalizeEquityItem(item);
          if (q.symbol) bySymbol.set(q.symbol, q);
        }
      } catch { failedBatches++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(QUOTE_BATCH_CONCURRENCY, batches.length) }, worker));

  const quotes = new Map<string, StockQuote>();
  let received = 0;
  let withChange = 0;
  for (const ticker of unique) {
    const q = bySymbol.get(brokerSymbol(ticker));
    if (q) received++;
    const pct = pctChange(q?.last, q?.prevClose);
    if (pct != null) withChange++;
    quotes.set(ticker, { ticker, last: q?.last ?? null, prevClose: q?.prevClose ?? null, pct });
  }
  return { quotes, requested: unique.length, received, withChange, failedBatches };
}
