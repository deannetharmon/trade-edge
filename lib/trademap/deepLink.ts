// lib/trademap/deepLink.ts
//
// OPTMAP-0001 S2d: URL parameters that prefill the Trade Map, so a screener
// result or portfolio position can open it on an exact trade:
//   /trade-map?symbol=SOXL&strategy=bps&expiry=2026-12-18&strike=45&width=2
// Parsing is strict: anything malformed is dropped (never guessed), and the
// view still checks strike and expiry against the live chain.

import { STRATEGIES, type StrategyId } from './strategies';

export interface TradeMapPrefill {
  symbol?: string;
  strategy?: StrategyId;
  expiry?: string;
  strike?: number;
  /** Spread width in strike steps. */
  width?: number;
}

export function parseTradeMapParams(search: string): TradeMapPrefill {
  const q = new URLSearchParams(search.charAt(0) === '?' ? search.slice(1) : search);
  const out: TradeMapPrefill = {};
  const symbol = (q.get('symbol') ?? '').trim().toUpperCase();
  if (/^[A-Z][A-Z0-9.\-/]{0,9}$/.test(symbol)) out.symbol = symbol;
  const strategy = q.get('strategy');
  if (strategy && STRATEGIES.some(s => s.id === strategy)) out.strategy = strategy as StrategyId;
  const expiry = q.get('expiry');
  if (expiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry)) out.expiry = expiry;
  const strike = parseFloat(q.get('strike') ?? '');
  if (Number.isFinite(strike) && strike > 0) out.strike = strike;
  const width = Number(q.get('width') ?? 'x');
  if (Number.isInteger(width) && width >= 1 && width <= 10) out.width = width;
  return out;
}

export function buildTradeMapUrl(p: TradeMapPrefill): string {
  const q = new URLSearchParams();
  if (p.symbol) q.set('symbol', p.symbol);
  if (p.strategy) q.set('strategy', p.strategy);
  if (p.expiry) q.set('expiry', p.expiry);
  if (p.strike != null) q.set('strike', String(p.strike));
  if (p.width != null) q.set('width', String(p.width));
  const s = q.toString();
  return s ? `/trade-map?${s}` : '/trade-map';
}
