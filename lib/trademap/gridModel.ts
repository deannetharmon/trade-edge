// lib/trademap/gridModel.ts
//
// OPTMAP-0001 S1: the Trade Map P/L grid (stock price x date), per Alan's spec.
// Every cell is a Black-Scholes MODEL ESTIMATE of the whole strategy's profit
// or loss if the stock is at that price at the close of that date, each leg on
// its own IV (scaled by ivMultiplier), rate and dividend yield from params.
// Pure functions. Fail closed: a cell that cannot be priced is null, never
// zero and never a guess.
//
// A date after the earliest leg expiration has no defined result (the expired
// leg's cash would have to be carried forward), so those cells are null. The
// UI axis should end at the earliest expiration (see buildDateAxis).

import {
  DEFAULT_RISK_FREE_RATE,
  bsPrice,
  daysBetween,
  DAYS_PER_YEAR,
  isoToUtcMs,
  utcMsToIso,
} from './pricing';
import { CONTRACT_MULTIPLIER, expirationsOf, legSign, netDebit, validateLegs, type TradeLeg } from './strategyLegs';

export interface PricingParams {
  /** Continuous risk-free rate, default 4%. */
  riskFreeRate: number;
  /** Continuous dividend yield, default 0 (label "dividends approximate" when non-zero). */
  dividendYield: number;
  /** Multiplies every leg's IV; 1 = as quoted. */
  ivMultiplier: number;
}

export const DEFAULT_PRICING_PARAMS: PricingParams = {
  riskFreeRate: DEFAULT_RISK_FREE_RATE,
  dividendYield: 0,
  ivMultiplier: 1,
};

const MS_PER_DAY = 86_400_000;

export function validateParams(p: PricingParams): boolean {
  return (
    Number.isFinite(p.riskFreeRate) &&
    Number.isFinite(p.dividendYield) &&
    p.dividendYield >= 0 &&
    Number.isFinite(p.ivMultiplier) &&
    p.ivMultiplier > 0
  );
}

export interface GridCell {
  /** Strategy value in dollars (long legs positive, short legs negative). */
  value: number;
  /** Profit/loss in dollars versus the entry prices. */
  pl: number;
}

/** Strategy value and profit/loss if the stock is `spot` at the close of `dateIso`; null when any leg cannot be priced. */
export function positionAt(legs: TradeLeg[], spot: number, dateIso: string, params: PricingParams): GridCell | null {
  if (validateLegs(legs) != null || !validateParams(params)) return null;
  let value = 0;
  let cost = 0;
  for (const leg of legs) {
    const days = daysBetween(dateIso, leg.expiration);
    if (days == null || days < 0) return null;
    const price = bsPrice(leg.right, spot, leg.strike, days / DAYS_PER_YEAR, params.riskFreeRate, params.dividendYield, leg.iv * params.ivMultiplier);
    if (price == null) return null;
    value += legSign(leg) * leg.quantity * price * CONTRACT_MULTIPLIER;
    cost += legSign(leg) * leg.quantity * leg.entryPrice * CONTRACT_MULTIPLIER;
  }
  return { value, pl: value - cost };
}

export interface PlGrid {
  prices: number[];
  dates: string[];
  /** cells[priceIndex][dateIndex] */
  cells: Array<Array<GridCell | null>>;
  /** Dollars paid (positive) or received (negative) to open. */
  netDebit: number;
  /** Earliest leg expiration; the last date the grid is defined for. */
  earliestExpiration: string;
}

export function computeGrid(legs: TradeLeg[], prices: number[], dates: string[], params: PricingParams): PlGrid | null {
  const debit = netDebit(legs);
  if (debit == null || !validateParams(params)) return null;
  const earliest = expirationsOf(legs)[0];
  const cells = prices.map(price => dates.map(date => positionAt(legs, price, date, params)));
  return { prices, dates, cells, netDebit: debit, earliestExpiration: earliest };
}

/** Stock-price rows, highest first, evenly spread across spot +/- rangePct, rounded to cents. */
export function buildPriceAxis(spot: number, rangePct: number, rows: number): number[] | null {
  if (!Number.isFinite(spot) || spot <= 0) return null;
  if (!Number.isFinite(rangePct) || rangePct <= 0 || rangePct >= 1) return null;
  if (!Number.isInteger(rows) || rows < 2 || rows > 200) return null;
  const top = spot * (1 + rangePct);
  const step = (2 * rangePct * spot) / (rows - 1);
  const axis: number[] = [];
  for (let i = 0; i < rows; i += 1) {
    const price = Math.max(0.01, Math.round((top - i * step) * 100) / 100);
    if (axis.length === 0 || axis[axis.length - 1] !== price) axis.push(price);
  }
  return axis;
}

/**
 * Date columns from asOf to endDate inclusive: asOf, then weekdays, ending on
 * endDate. Exchange holidays are not modeled. When there are more than
 * maxCols, columns are thinned evenly, always keeping the first and last.
 */
export function buildDateAxis(asOf: string, endDate: string, maxCols: number): string[] | null {
  const start = isoToUtcMs(asOf);
  const end = isoToUtcMs(endDate);
  if (start == null || end == null || end < start) return null;
  if (!Number.isInteger(maxCols) || maxCols < 2) return null;
  const all: string[] = [asOf];
  for (let ms = start + MS_PER_DAY; ms <= end; ms += MS_PER_DAY) {
    const dow = new Date(ms).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    all.push(utcMsToIso(ms));
  }
  if (all[all.length - 1] !== endDate) all.push(endDate);
  if (all.length <= maxCols) return all;
  const thinned: string[] = [];
  for (let i = 0; i < maxCols; i += 1) {
    const date = all[Math.round((i * (all.length - 1)) / (maxCols - 1))];
    if (thinned.indexOf(date) < 0) thinned.push(date);
  }
  return thinned;
}
