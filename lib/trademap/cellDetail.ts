// lib/trademap/cellDetail.ts
//
// OPTMAP-0001 S4a: everything the cell-detail panel shows for one scenario (stock price on a date): P/L, chance of
// profit from there, net Greeks and each leg's delta. All from the grid's own model and inputs (rate, dividend yield,
// IV x multiplier). Pure; null when any leg cannot be valued (never a guess).

import { positionAt, type PricingParams } from './gridModel';
import { bsGreeks, positionGreeksAt, type Greeks } from './greeks';
import { chanceOfProfit } from './pop';
import { daysBetween, DAYS_PER_YEAR } from './pricing';
import { expirationsOf, netDebit as netDebitOf, type TradeLeg } from './strategyLegs';

export interface LegDelta { side: 'long' | 'short'; right: 'C' | 'P' | 'S'; strike: number; delta: number }

export interface CellDetail {
  price: number;
  date: string;
  /** Calendar days from today to the scenario date. */
  daysOut: number;
  /** Calendar days from the scenario date to the earliest expiration. */
  daysToExpiry: number;
  pl: number;
  /** P/L as a percent of the premium (debit paid or credit received); null when there is no premium. */
  plPctOfPremium: number | null;
  /** Model chance of profit at expiration starting from this price and date; null at/after expiration or with several expirations. */
  chanceOfProfit: number | null;
  greeks: Greeks;
  legs: LegDelta[];
}

export function cellDetail(
  legs: TradeLeg[],
  price: number,
  dateIso: string,
  todayIso: string,
  params: PricingParams,
  expirationIv: number | null,
): CellDetail | null {
  const cell = positionAt(legs, price, dateIso, params);
  const greeks = positionGreeksAt(legs, price, dateIso, params);
  const debit = netDebitOf(legs);
  const daysOut = daysBetween(todayIso, dateIso);
  const earliest = expirationsOf(legs)[0];
  const daysToExpiry = earliest ? daysBetween(dateIso, earliest) : null;
  if (!cell || !greeks || debit == null || daysOut == null || daysToExpiry == null) return null;

  const legDeltas: LegDelta[] = [];
  for (const leg of legs) {
    const d = daysBetween(dateIso, leg.expiration);
    if (d == null) return null;
    const g = leg.right === 'S' ? { delta: 1, gamma: 0, theta: 0, vega: 0 } : bsGreeks(leg.right, price, leg.strike, d / DAYS_PER_YEAR, params.riskFreeRate, params.dividendYield, leg.iv * params.ivMultiplier);
    if (!g) return null;
    legDeltas.push({ side: leg.side, right: leg.right, strike: leg.strike, delta: g.delta });
  }

  const premium = Math.abs(debit);
  const pop = expirationIv != null && daysToExpiry > 0
    ? chanceOfProfit(legs, price, dateIso, expirationIv * params.ivMultiplier, params.riskFreeRate, params.dividendYield)
    : null;
  return {
    price,
    date: dateIso,
    daysOut,
    daysToExpiry,
    pl: cell.pl,
    plPctOfPremium: premium > 1e-9 ? (cell.pl / premium) * 100 : null,
    chanceOfProfit: pop,
    greeks,
    legs: legDeltas,
  };
}
