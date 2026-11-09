// features/portfolio/positions-workspace/model/longOptionPath.ts
//
// LONG-OPTION-PATH-0001 -- for a bought single call or put, separate three things a trader confuses: how far the stock is
// from the STRIKE (where intrinsic value begins), how far from the expiration BREAKEVEN (strike +/- premium paid, where
// profit at expiration begins), and what today's option value is made of (intrinsic vs extrinsic). Pure and display-only:
// null when anything needed is missing, never an estimate.

import type { Position } from '@/lib/portfolio-data/types';

export interface LongOptionPath {
  symbol: string;
  kind: 'C' | 'P';
  stock: number;
  strike: number;
  premium: number;
  breakeven: number;
  /** Dollars the stock still has to move to reach the strike; positive = not there yet, negative = already past it. */
  toStrike: number;
  /** Same, to the expiration breakeven. */
  toBreakeven: number;
  /** Per share. Null when the broker mark is missing. */
  value: number | null;
  intrinsic: number;
  extrinsic: number | null;
  /** True when the stock is on the strike's profitable side (the option has intrinsic value). */
  hasIntrinsic: boolean;
  /** True when the stock is already past the expiration breakeven. */
  pastBreakeven: boolean;
  status: string;
}

const usd = (n: number) => `$${Math.abs(n).toFixed(2)}`;

export function buildLongOptionPath(p: Pick<Position, 'symbol' | 'stockPrice' | 'legs'>): LongOptionPath | null {
  const legs = p.legs ?? [];
  if (legs.length !== 1) return null;
  const leg = legs[0];
  const stock = p.stockPrice;
  if (leg.direction !== 'Long' || !(leg.optionType === 'C' || leg.optionType === 'P')) return null;
  if (stock == null || !Number.isFinite(stock) || stock <= 0) return null;
  if (!Number.isFinite(leg.strikePrice) || leg.strikePrice <= 0) return null;
  if (leg.avgOpenPrice == null || !Number.isFinite(leg.avgOpenPrice) || leg.avgOpenPrice <= 0) return null;

  const call = leg.optionType === 'C';
  const strike = leg.strikePrice;
  const premium = leg.avgOpenPrice;
  const breakeven = call ? strike + premium : strike - premium;
  const sign = call ? 1 : -1;
  const toStrike = sign * (strike - stock);
  const toBreakeven = sign * (breakeven - stock);
  const intrinsic = Math.max(0, sign * (stock - strike));
  const mark = leg.currentPrice != null && Number.isFinite(leg.currentPrice) && leg.currentPrice >= 0 ? leg.currentPrice : null;
  const extrinsic = mark === null ? null : Math.max(0, mark - intrinsic);
  const hasIntrinsic = toStrike < 0;
  const pastBreakeven = toBreakeven <= 0;
  const side = call ? 'below' : 'above';
  const beyond = call ? 'above' : 'below';
  const sym = p.symbol;

  const status = !hasIntrinsic
    ? `${sym} is ${side} your strike, so this ${call ? 'call' : 'put'} has no intrinsic value today.${extrinsic !== null ? ' Its current value is entirely time and volatility value.' : ''} At expiration, ${sym} must be ${beyond} ${usd(breakeven)} to recover your original cost.`
    : !pastBreakeven
      ? `${sym} is ${beyond} your strike, so ${usd(intrinsic)} of this option's value is intrinsic.${extrinsic !== null ? ` The other ${usd(extrinsic)} is time and volatility value.` : ''} At expiration, ${sym} must be ${beyond} ${usd(breakeven)} to recover your original cost.`
      : `${sym} is ${beyond} your ${usd(breakeven)} breakeven. Held to expiration at today's price, this option would recover its cost.`;

  return { symbol: sym, kind: leg.optionType, stock, strike, premium, breakeven, toStrike, toBreakeven, value: mark, intrinsic, extrinsic, hasIntrinsic, pastBreakeven, status };
}

/** Chip text for a bought option's distance to its strike: plain direction, never "OTM", which reads as a protective buffer. */
export function longStrikeChipLabel(path: Pick<LongOptionPath, 'kind' | 'toStrike'>, distancePct: number): string {
  const short = path.toStrike > 0; // the stock has not reached the strike yet
  const word = (path.kind === 'C') === short ? 'below' : 'above';
  return `${distancePct.toFixed(1)}% ${word} strike`;
}
