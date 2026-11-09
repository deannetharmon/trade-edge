// features/portfolio/positions-workspace/model/longOptionPath.ts
//
// LONG-OPTION-PATH-0001 -- for a bought single call or put, separate three things a trader confuses: how far the stock is
// from the STRIKE (where intrinsic value begins), how far from the expiration BREAKEVEN (strike +/- premium paid, where
// profit at expiration begins), and what today's option value is made of (intrinsic vs extrinsic). Pure and display-only:
// null when anything needed is missing, never an estimate.

import type { Position } from '@/lib/portfolio-data/types';
import { normalCdf } from '@/lib/scans/scan-utils';
import { PMCC_START_PRICE_RISK_FREE_RATE } from '@/lib/scans/pmccStartPrice';

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
  /** Percent the stock must move from today's price to reach breakeven; positive = still to go. */
  neededMovePct: number;
  /** Model estimate (0..1) of finishing past breakeven at expiration; null without a usable IV or time left. */
  probability: number | null;
  ivPct: number | null;
  /** Where the IV came from: this contract's own quote, or the stock's current IV as a fallback. */
  ivSource: 'contract' | 'stock' | null;
  dte: number | null;
}

/**
 * Chance the stock finishes past breakeven at expiration: lognormal, risk-neutral drift, the position's current IV.
 * A model estimate, not a forecast. Null when IV or time to expiration is missing.
 */
export function breakevenProbability(kind: 'C' | 'P', stock: number, breakeven: number, ivPct: number | null | undefined, dte: number | null | undefined, rate = PMCC_START_PRICE_RISK_FREE_RATE): number | null {
  if (ivPct == null || !Number.isFinite(ivPct) || ivPct <= 0 || dte == null || !Number.isFinite(dte) || dte <= 0) return null;
  if (!(breakeven > 0) || !(stock > 0)) return null;
  const sigma = ivPct / 100;
  const t = dte / 365;
  const d2 = (Math.log(stock / breakeven) + (rate - 0.5 * sigma * sigma) * t) / (sigma * Math.sqrt(t));
  return kind === 'C' ? normalCdf(d2) : normalCdf(-d2);
}

/** "~12%", "<1%", ">99%". */
export function probabilityLabel(probability: number): string {
  const pct = probability * 100;
  return pct < 1 ? '<1%' : pct > 99 ? '>99%' : `~${Math.round(pct)}%`;
}

/** Chip tone from the chance of reaching breakeven: 40%+ green, 20-40% amber, under 20% red; no estimate is neutral. */
export function breakevenTone(probability: number | null): 'ok' | 'warn' | 'bad' | 'info' {
  if (probability == null) return 'info';
  return probability >= 0.4 ? 'ok' : probability >= 0.2 ? 'warn' : 'bad';
}

const usd = (n: number) => `$${Math.abs(n).toFixed(2)}`;

export function buildLongOptionPath(p: Pick<Position, 'symbol' | 'stockPrice' | 'legs'> & Partial<Pick<Position, 'iv' | 'dte'>>): LongOptionPath | null {
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

  // The contract's own IV first (a LEAP's IV differs from the stock's near-term IV); the stock's IV only as a fallback.
  const contractIv = leg.currentIv != null && Number.isFinite(leg.currentIv) && leg.currentIv > 0 ? leg.currentIv : null;
  const stockIv = p.iv != null && Number.isFinite(p.iv) && p.iv > 0 ? p.iv : null;
  const ivPct = contractIv ?? stockIv;
  const ivSource: 'contract' | 'stock' | null = contractIv != null ? 'contract' : stockIv != null ? 'stock' : null;
  const dte = p.dte != null && Number.isFinite(p.dte) ? p.dte : null;
  return { symbol: sym, kind: leg.optionType, stock, strike, premium, breakeven, toStrike, toBreakeven, value: mark, intrinsic, extrinsic, hasIntrinsic, pastBreakeven, status, neededMovePct: (toBreakeven / stock) * 100, probability: breakevenProbability(leg.optionType, stock, breakeven, ivPct, dte), ivPct, ivSource, dte };
}

/** Chip text for a bought option's distance to its strike: plain direction, never "OTM", which reads as a protective buffer. */
export function longStrikeChipLabel(path: Pick<LongOptionPath, 'kind' | 'toStrike'>, distancePct: number): string {
  const short = path.toStrike > 0; // the stock has not reached the strike yet
  const word = (path.kind === 'C') === short ? 'below' : 'above';
  return `${distancePct.toFixed(1)}% ${word} strike`;
}
