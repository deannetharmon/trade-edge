// lib/trademap/pop.ts
//
// OPTMAP-0001 S2 (Alan's spec): chance of profit at expiration.
// Lognormal terminal price: ln(S_T) ~ Normal(ln(S) + (r - q - sigma^2/2) T, sigma^2 T),
// with sigma the expiration's implied volatility. The strategy's expiration-day
// payoff is piecewise linear, so the profitable region is a union of intervals
// between the strikes and breakevens; the probability is the lognormal mass on
// those intervals. A model estimate, not a forecast. Fail closed: null when the
// legs span several expirations, or any input is unusable.

import { daysBetween, DAYS_PER_YEAR, normCdf } from './pricing';
import { expirationsOf, expiryMetrics, expiryPayoff, validateLegs, type TradeLeg } from './strategyLegs';

const PROFIT_EPS = 1e-9;

export function chanceOfProfit(
  legs: TradeLeg[],
  spot: number,
  asOf: string,
  expirationIv: number,
  riskFreeRate: number,
  dividendYield: number,
): number | null {
  if (validateLegs(legs) != null) return null;
  if (![spot, expirationIv, riskFreeRate, dividendYield].every(Number.isFinite)) return null;
  if (spot <= 0 || expirationIv <= 0 || dividendYield < 0) return null;
  const expirations = expirationsOf(legs);
  if (expirations.length !== 1) return null;
  const days = daysBetween(asOf, expirations[0]);
  if (days == null || days <= 0) return null;
  const metrics = expiryMetrics(legs);
  if (metrics == null) return null;

  const t = days / DAYS_PER_YEAR;
  const sd = expirationIv * Math.sqrt(t);
  const mean = Math.log(spot) + (riskFreeRate - dividendYield - (expirationIv * expirationIv) / 2) * t;
  const cdf = (x: number) => (x <= 0 ? 0 : normCdf((Math.log(x) - mean) / sd));

  const points: number[] = [0];
  for (const leg of legs) if (points.indexOf(leg.strike) < 0) points.push(leg.strike);
  for (const be of metrics.breakevens) if (points.indexOf(be) < 0) points.push(be);
  points.sort((a, b) => a - b);

  let probability = 0;
  for (let i = 0; i < points.length; i += 1) {
    const lo = points[i];
    const hi = i + 1 < points.length ? points[i + 1] : null;
    const probe = hi == null ? lo + 1 : (lo + hi) / 2;
    if (expiryPayoff(legs, probe) > PROFIT_EPS) probability += (hi == null ? 1 : cdf(hi)) - cdf(lo);
  }
  return Math.min(1, Math.max(0, probability));
}
