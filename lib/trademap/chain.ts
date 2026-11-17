// lib/trademap/chain.ts
//
// OPTMAP-0001 S2: TastyTrade chain, quote and metrics parsing for the Trade
// Map. Shapes come from the live spike (2026-11-17): option quotes carry bid,
// ask, mark, delta, `volatility` (IV as a fraction), `updated-at`,
// `is-trading-halted`; market-metrics carries per-expiration IV, earnings and
// dividend yield. Parsers never invent a value: anything missing is null.
// Fetch helpers take an injected fetcher (the existing same-origin proxy
// client in the app, a stub in tests). Read-only.

import { daysBetween, ivToFraction } from './pricing';

export type ChainFetcher = (path: string) => Promise<any>;

/** Whitespace-free key for matching space-padded OCC symbols. */
export function symbolKey(symbol: string): string {
  return symbol.replace(/\s+/g, '');
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function timeMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export interface ChainStrike {
  strike: number;
  /** OCC symbol exactly as the broker sends it (space padded). */
  call: string | null;
  put: string | null;
}

export interface ChainExpiration {
  date: string;
  dte: number;
  strikes: ChainStrike[];
}

/** Expirations with at least one day left, ascending, strikes ascending. */
export function parseNestedChain(data: any, todayIso: string): ChainExpiration[] {
  const groups: any[] = data?.data?.items?.[0]?.expirations ?? [];
  const out: ChainExpiration[] = [];
  for (const g of groups) {
    const date = g?.['expiration-date'];
    if (typeof date !== 'string') continue;
    const dte = daysBetween(todayIso, date);
    if (dte == null || dte < 1) continue;
    const strikes: ChainStrike[] = [];
    for (const s of g?.strikes ?? []) {
      const strike = num(s?.['strike-price']);
      if (strike == null || strike <= 0) continue;
      strikes.push({ strike, call: typeof s?.call === 'string' ? s.call : null, put: typeof s?.put === 'string' ? s.put : null });
    }
    strikes.sort((a, b) => a.strike - b.strike);
    if (strikes.length > 0) out.push({ date, dte, strikes });
  }
  return out.sort((a, b) => a.dte - b.dte);
}

export interface OptionQuote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  /** (bid + ask) / 2 when the market is two-sided and uncrossed, else null. */
  mid: number | null;
  /** Implied volatility as a fraction (1.84 = 184%). */
  iv: number | null;
  delta: number | null;
  updatedAtMs: number | null;
  halted: boolean | null;
}

export function parseOptionQuote(item: any): OptionQuote | null {
  if (typeof item?.symbol !== 'string') return null;
  const bid = num(item.bid);
  const ask = num(item.ask);
  const mid = bid != null && ask != null && bid > 0 && ask >= bid ? (bid + ask) / 2 : null;
  return {
    symbol: item.symbol,
    bid,
    ask,
    mid,
    iv: ivToFraction(item.volatility),
    delta: num(item.delta),
    updatedAtMs: timeMs(item['updated-at']),
    halted: typeof item['is-trading-halted'] === 'boolean' ? item['is-trading-halted'] : null,
  };
}

export interface UnderlyingQuote {
  symbol: string;
  price: number;
  prevClose: number | null;
  updatedAtMs: number | null;
}

export function parseUnderlyingQuote(item: any): UnderlyingQuote | null {
  if (typeof item?.symbol !== 'string') return null;
  const bid = num(item.bid);
  const ask = num(item.ask);
  const mid = bid != null && ask != null && bid > 0 && ask >= bid ? (bid + ask) / 2 : null;
  const price = num(item.last) ?? num(item.mark) ?? num(item.mid) ?? mid;
  if (price == null || price <= 0) return null;
  return { symbol: item.symbol, price, prevClose: num(item['prev-close']), updatedAtMs: timeMs(item['updated-at']) };
}

export interface UnderlyingMetrics {
  /** Per-expiration implied volatility as a fraction, keyed by YYYY-MM-DD. */
  ivByExpiration: Record<string, number>;
  earningsDate: string | null;
  /** Continuous dividend yield as a fraction; null when absent. Approximate: see Alan's note. */
  dividendYield: number | null;
}

export function parseMetrics(item: any): UnderlyingMetrics {
  const ivByExpiration: Record<string, number> = {};
  for (const e of item?.['option-expiration-implied-volatilities'] ?? []) {
    const iv = ivToFraction(e?.['implied-volatility']);
    if (typeof e?.['expiration-date'] === 'string' && iv != null) ivByExpiration[e['expiration-date']] = iv;
  }
  const earnings = item?.earnings?.['expected-report-date'];
  const yieldRaw = num(item?.['dividend-yield']);
  return {
    ivByExpiration,
    earningsDate: typeof earnings === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(earnings) ? earnings : null,
    dividendYield: yieldRaw != null && yieldRaw > 0 && yieldRaw < 1 ? yieldRaw : null,
  };
}

const QUOTE_CHUNK = 50;

export async function fetchNestedChain(fetch: ChainFetcher, symbol: string, todayIso: string): Promise<ChainExpiration[]> {
  return parseNestedChain(await fetch(`/option-chains/${encodeURIComponent(symbol)}/nested`), todayIso);
}

/** Quotes keyed by whitespace-free symbol. */
export async function fetchOptionQuotes(fetch: ChainFetcher, symbols: string[]): Promise<Record<string, OptionQuote>> {
  const out: Record<string, OptionQuote> = {};
  for (let i = 0; i < symbols.length; i += QUOTE_CHUNK) {
    const qs = symbols.slice(i, i + QUOTE_CHUNK).map(s => `equity-option=${encodeURIComponent(s)}`).join('&');
    const data = await fetch(`/market-data/by-type?${qs}`);
    for (const item of data?.data?.items ?? []) {
      const q = parseOptionQuote(item);
      if (q) out[symbolKey(q.symbol)] = q;
    }
  }
  return out;
}

export async function fetchUnderlyingQuote(fetch: ChainFetcher, symbol: string): Promise<UnderlyingQuote | null> {
  const data = await fetch(`/market-data/by-type?equity=${encodeURIComponent(symbol)}`);
  return parseUnderlyingQuote(data?.data?.items?.[0]);
}

export async function fetchMetrics(fetch: ChainFetcher, symbol: string): Promise<UnderlyingMetrics> {
  const data = await fetch(`/market-metrics?symbols=${encodeURIComponent(symbol)}`);
  return parseMetrics(data?.data?.items?.[0]);
}
