// lib/trademap/greeks.ts
//
// OPTMAP-0001 S4a (Alan's spec): Black-Scholes Greeks for a position at a scenario price and date, from the SAME model
// and inputs that price the P/L grid (rate, dividend yield, IV x multiplier), so the panel always agrees with the grid.
//
// Units (position level, all legs summed, long = +, short = -, times contracts x 100):
//   delta  share-equivalents: dollars of P/L per $1.00 move in the stock
//   gamma  change in delta (share-equivalents) per $1.00 move in the stock
//   theta  dollars per calendar day (negative = the position loses value as time passes)
//   vega   dollars per 1 percentage-point change in implied volatility
// Model estimates (European exercise). Fail closed: null when any leg cannot be valued.

import { daysBetween, DAYS_PER_YEAR, normCdf, type OptionRight } from './pricing';
import { CONTRACT_MULTIPLIER, legSign, validateLegs, type TradeLeg } from './strategyLegs';
import { validateParams, type PricingParams } from './gridModel';

export interface Greeks { delta: number; gamma: number; theta: number; vega: number }

const SQRT_2PI = Math.sqrt(2 * Math.PI);
export const normPdf = (x: number): number => Math.exp(-(x * x) / 2) / SQRT_2PI;

/**
 * Greeks of ONE option, per share. theta is per calendar day, vega per 1.00 of volatility divided by 100 (per point).
 * At expiry (t = 0) or zero volatility only delta survives, as the intrinsic step; gamma, theta and vega are 0.
 */
export function bsGreeks(right: OptionRight, spot: number, strike: number, t: number, rate: number, dividendYield: number, sigma: number): Greeks | null {
  if (right !== 'C' && right !== 'P') return null;
  if (![spot, strike, t, rate, dividendYield, sigma].every(Number.isFinite)) return null;
  if (spot <= 0 || strike <= 0 || t < 0 || sigma < 0) return null;
  if (t === 0 || sigma === 0) {
    const itm = right === 'C' ? spot > strike : spot < strike;
    return { delta: itm ? (right === 'C' ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const sd = sigma * Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (rate - dividendYield + (sigma * sigma) / 2) * t) / sd;
  const d2 = d1 - sd;
  const eq = Math.exp(-dividendYield * t);
  const er = Math.exp(-rate * t);
  const pdf = normPdf(d1);
  const decay = -(spot * eq * pdf * sigma) / (2 * Math.sqrt(t));
  const delta = right === 'C' ? eq * normCdf(d1) : eq * (normCdf(d1) - 1);
  const thetaYear = right === 'C'
    ? decay - rate * strike * er * normCdf(d2) + dividendYield * spot * eq * normCdf(d1)
    : decay + rate * strike * er * normCdf(-d2) - dividendYield * spot * eq * normCdf(-d1);
  return {
    delta,
    gamma: (eq * pdf) / (spot * sd),
    theta: thetaYear / DAYS_PER_YEAR,
    vega: (spot * eq * pdf * Math.sqrt(t)) / 100,
  };
}

/** Net position Greeks if the stock is `spot` at the close of `dateIso`; null when any leg cannot be valued. */
export function positionGreeksAt(legs: TradeLeg[], spot: number, dateIso: string, params: PricingParams): Greeks | null {
  if (validateLegs(legs) != null || !validateParams(params)) return null;
  const net: Greeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const leg of legs) {
    const days = daysBetween(dateIso, leg.expiration);
    if (days == null || days < 0) return null;
    const g = leg.right === 'S' ? { delta: 1, gamma: 0, theta: 0, vega: 0 } : bsGreeks(leg.right, spot, leg.strike, days / DAYS_PER_YEAR, params.riskFreeRate, params.dividendYield, leg.iv * params.ivMultiplier);
    if (g == null) return null;
    const k = legSign(leg) * leg.quantity * CONTRACT_MULTIPLIER;
    net.delta += k * g.delta;
    net.gamma += k * g.gamma;
    net.theta += k * g.theta;
    net.vega += k * g.vega;
  }
  return net;
}
