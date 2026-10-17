// lib/salvage/salvageChainClient.ts
//
// SALVAGE-0001 slice C -- browser-side chain + quote load for ONE expiration.
// Reads only (the proxy path); never places or changes an order. Fails closed:
// any missing piece throws, and the panel shows "Salvage unavailable".

import { ttFetch } from '@/lib/scans/tastytrade-client';
import type { ChainQuote } from './salvageCandidates';
import type { OptionRight } from './salvageMath';

export interface SalvageChain {
  symbol: string;
  expDate: string;
  quotes: ChainQuote[];
  /** Epoch ms when this load finished. */
  fetchedAtMs: number;
}

type Fetcher = (path: string, token: string) => Promise<any>;

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Loads puts or calls (`right`) for `expDate`. A quote with no broker quote
 * time is dated at the moment this load finished (the data was just fetched);
 * a quote with a broker time keeps it, so a genuinely old quote still goes stale.
 */
export async function loadSalvageChain(
  symbol: string,
  expDate: string,
  right: OptionRight,
  token: string,
  fetcher: Fetcher = ttFetch,
  nowMs: () => number = Date.now,
): Promise<SalvageChain> {
  const nested = await fetcher(`/option-chains/${encodeURIComponent(symbol)}/nested`, token);
  const group = (nested?.data?.items?.[0]?.expirations ?? []).find(
    (e: any) => e?.['expiration-date'] === expDate,
  );
  if (!group) throw new Error(`No ${expDate} expiration found for ${symbol}.`);

  const meta: Record<string, number> = {};
  const symbols: string[] = [];
  for (const s of group.strikes ?? []) {
    const strike = num(s?.['strike-price']);
    const occ: string | undefined = right === 'P' ? s?.put : s?.call;
    if (strike == null || !occ) continue;
    meta[occ] = strike;
    symbols.push(occ);
  }
  if (symbols.length === 0) throw new Error(`No ${right === 'P' ? 'put' : 'call'} strikes found for ${symbol} ${expDate}.`);

  const quotes: ChainQuote[] = [];
  for (let i = 0; i < symbols.length; i += 100) {
    const qs = symbols.slice(i, i + 100).map((s) => `equity-option=${encodeURIComponent(s)}`).join('&');
    const data = await fetcher(`/market-data/by-type?${qs}`, token);
    const loadedAt = nowMs();
    for (const item of data?.data?.items ?? []) {
      const strike = meta[item?.symbol];
      if (strike == null) continue;
      const t = item?.['quote-time'] ?? item?.['updated-at'] ?? item?.timestamp ?? null;
      const parsed = t != null ? Date.parse(String(t)) : NaN;
      quotes.push({
        right,
        strike,
        bid: num(item.bid),
        ask: num(item.ask),
        delta: num(item.delta),
        asOfMs: Number.isFinite(parsed) ? parsed : loadedAt,
      });
    }
  }
  if (quotes.length === 0) throw new Error('No option quotes came back.');
  return { symbol, expDate, quotes, fetchedAtMs: nowMs() };
}
