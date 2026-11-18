// lib/trademap/strategyLegs.ts
//
// OPTMAP-0001 S1: the leg model for the Trade Map, plus the expiration-day
// economics of a strategy (net debit/credit, max profit, max loss, breakevens).
// Pure functions. Fail closed: invalid legs return null, never a guess.
//
// Conventions: entryPrice is per share; quantity is contracts; 100 shares per
// contract. A long leg is paid for (debit), a short leg is received (credit).
// netDebit is positive for a debit and negative for a credit, in dollars.

import { intrinsicValue, isoToUtcMs, type OptionRight } from './pricing';

export const CONTRACT_MULTIPLIER = 100;
const EPS = 1e-9;

export type LegSide = 'long' | 'short';

/** 'C' call, 'P' put, 'S' shares (covered call): quantity is lots of 100 shares, entryPrice the cost basis, no IV or strike meaning. */
export type LegRight = OptionRight | 'S';

export interface TradeLeg {
  right: LegRight;
  side: LegSide;
  strike: number;
  /** YYYY-MM-DD */
  expiration: string;
  /** Contracts, positive integer. */
  quantity: number;
  /** Premium per share at entry. */
  entryPrice: number;
  /** Implied volatility as a fraction (1.84 = 184%). */
  iv: number;
}

export function legSign(leg: Pick<TradeLeg, 'side'>): 1 | -1 {
  return leg.side === 'long' ? 1 : -1;
}

/** A human-readable reason the legs are unusable, or null when they are valid. */
export function validateLegs(legs: TradeLeg[]): string | null {
  if (!Array.isArray(legs) || legs.length === 0) return 'no legs';
  for (const leg of legs) {
    if (leg.right !== 'C' && leg.right !== 'P' && leg.right !== 'S') return 'bad option type';
    if (leg.side !== 'long' && leg.side !== 'short') return 'bad side';
    if (!Number.isFinite(leg.strike) || leg.strike <= 0) return 'bad strike';
    if (!Number.isInteger(leg.quantity) || leg.quantity <= 0) return 'bad quantity';
    if (!Number.isFinite(leg.entryPrice) || leg.entryPrice < 0) return 'bad entry price';
    if (!Number.isFinite(leg.iv) || leg.iv < 0) return 'bad iv';
    if (isoToUtcMs(leg.expiration) == null) return 'bad expiration';
  }
  return null;
}

/** Sorted distinct expiration dates. */
export function expirationsOf(legs: TradeLeg[]): string[] {
  const seen: string[] = [];
  for (const leg of legs) if (seen.indexOf(leg.expiration) < 0) seen.push(leg.expiration);
  return seen.sort();
}

/** Dollars paid (positive) or received (negative) to open the strategy; null when the legs are invalid. */
export function netDebit(legs: TradeLeg[]): number | null {
  if (validateLegs(legs) != null) return null;
  let total = 0;
  for (const leg of legs) total += legSign(leg) * leg.quantity * leg.entryPrice * CONTRACT_MULTIPLIER;
  return total;
}

/** Strategy profit/loss in dollars if the stock ends at `spot` on a date when every leg is expired. */
export function expiryPayoff(legs: TradeLeg[], spot: number): number {
  let total = 0;
  for (const leg of legs) {
    total += legSign(leg) * leg.quantity * ((leg.right === 'S' ? spot : intrinsicValue(leg.right, spot, leg.strike)) - leg.entryPrice) * CONTRACT_MULTIPLIER;
  }
  return total;
}

export interface ExpiryMetrics {
  /** Positive = debit paid, negative = credit received, dollars. */
  netDebit: number;
  /** Best case in dollars; null when unbounded (see maxProfitUnbounded). */
  maxProfit: number | null;
  maxProfitUnbounded: boolean;
  /** Worst case as a positive dollar amount; null when unbounded (see maxLossUnbounded). */
  maxLoss: number | null;
  maxLossUnbounded: boolean;
  /** Stock prices (> 0) where the expiration-day result is zero, ascending. */
  breakevens: number[];
}

/**
 * Expiration-day economics. Only defined when every leg shares one expiration;
 * a multi-expiration strategy (PMCC, calendar) has no single payoff curve and
 * returns null. The payoff is piecewise linear with kinks at the strikes, so
 * checking the kinks plus the slope above the highest strike is exact.
 */
export function expiryMetrics(legs: TradeLeg[]): ExpiryMetrics | null {
  const debit = netDebit(legs);
  if (debit == null) return null;
  if (expirationsOf(legs).length !== 1) return null;

  const strikes: number[] = [];
  for (const leg of legs) if (strikes.indexOf(leg.strike) < 0) strikes.push(leg.strike);
  strikes.sort((a, b) => a - b);
  const xs = [0].concat(strikes);
  const vs = xs.map(x => expiryPayoff(legs, x));

  // Above the highest strike only calls still move with the stock.
  let slope = 0;
  for (const leg of legs) if (leg.right === 'C' || leg.right === 'S') slope += legSign(leg) * leg.quantity * CONTRACT_MULTIPLIER;

  const best = Math.max.apply(null, vs);
  const worst = Math.min.apply(null, vs);
  const maxProfitUnbounded = slope > EPS;
  const maxLossUnbounded = slope < -EPS;

  const roots: number[] = [];
  const addRoot = (x: number) => {
    if (x > EPS && !roots.some(r => Math.abs(r - x) < 1e-7)) roots.push(x);
  };
  const last = xs.length - 1;
  const rightOf = (i: number) => (i < last ? vs[i + 1] : vs[last] + slope);
  for (let i = 0; i < xs.length; i += 1) {
    if (Math.abs(vs[i]) < EPS) {
      const leftFlat = i === 0 || Math.abs(vs[i - 1]) < EPS;
      const rightFlat = Math.abs(rightOf(i)) < EPS;
      if (!(leftFlat && rightFlat)) addRoot(xs[i]);
    }
    if (i < last && Math.abs(vs[i]) >= EPS && Math.abs(vs[i + 1]) >= EPS && vs[i] * vs[i + 1] < 0) {
      addRoot(xs[i] + (-vs[i] * (xs[i + 1] - xs[i])) / (vs[i + 1] - vs[i]));
    }
  }
  if (Math.abs(slope) > EPS && Math.abs(vs[last]) >= EPS) {
    const x = xs[last] - vs[last] / slope;
    if (x > xs[last] + EPS) addRoot(x);
  }
  roots.sort((a, b) => a - b);

  return {
    netDebit: debit,
    maxProfit: maxProfitUnbounded ? null : best,
    maxProfitUnbounded,
    maxLoss: maxLossUnbounded ? null : Math.max(0, -worst),
    maxLossUnbounded,
    breakevens: roots,
  };
}

/** The covered-call share leg: 100 shares per lot at the cost basis, tied to the call's expiration so the leg set stays on one date. */
export function shareLeg(costBasis: number, expiration: string, lots = 1): TradeLeg {
  return { right: 'S', side: 'long', strike: costBasis, expiration, quantity: lots, entryPrice: costBasis, iv: 0 };
}
