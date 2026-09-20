// lib/scans/pmccStartPrice.ts
//
// LEAPS-PMCC-START-0001 -- "PMCC start price" for a LEAPS candidate.
//
// The one hard PMCC rule this supports: never sell a short call whose strike is below the long LEAPS's breakeven
// (strike + debit paid), or an assignment locks in a loss. The breakeven is exact and already shown on every row.
// The start price answers the follow-on question -- "from what stock price up does a call in MY short-call range
// sit at or above that breakeven?" -- so the trader knows when the first call can be sold.
//
// Definition (Ian, 2026-09-20): the stock price S* at which a call struck AT the breakeven has the trader's
// highest allowed short delta, using the shortest allowed short DTE. Those two choices are the conservative
// extremes: a higher delta puts the strike closer to the money, and a shorter DTE narrows the strike's distance
// from the money, both of which raise S*. From S* upward, every call in the trader's delta range (delta <= max,
// DTE >= min) clears the breakeven.
//
// Model: Black-Scholes call delta N(d1), no dividends, the underlying's IVx (its ~30-day implied volatility, the
// closest available proxy for a short-dated call's IV) and a fixed risk-free rate. This is an ESTIMATE, always
// labelled as such in the UI; the real short-call chain is the source of truth when the trader sells the call.
//
// Solving delta = N(d1) for the strike K at spot S:  ln(S/K) = d1*sigma*sqrt(T) - (r + sigma^2/2)*T,  d1 = N^-1(delta).
// Setting K = breakeven B and solving for S:  S* = B * exp(d1*sigma*sqrt(T) - (r + sigma^2/2)*T).

export const PMCC_START_PRICE_RISK_FREE_RATE = 0.04;

export type PmccStartPriceStatus = 'above' | 'below' | 'unavailable';

export interface PmccStartPrice {
  status: PmccStartPriceStatus;
  /** Estimated stock price from which every call in the trader's short-call range clears the breakeven. */
  startPrice: number | null;
  /** When status is 'below': the % rise from the current price needed to reach the start price. */
  pctToStart: number | null;
}

export interface PmccStartPriceInput {
  spot: number | null | undefined;
  breakeven: number | null | undefined;
  /** Underlying IVx as a percent (36.4 means 36.4%). */
  ivxPct: number | null | undefined;
  /** Trader's highest allowed short-call delta (PMCC default 0.35). */
  shortDeltaMax: number;
  /** Trader's shortest allowed short-call DTE in days (PMCC default 21). */
  shortDteMin: number;
  riskFreeRate?: number;
}

const UNAVAILABLE: PmccStartPrice = { status: 'unavailable', startPrice: null, pctToStart: null };
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Inverse of the standard normal CDF (Acklam's rational approximation, relative error ~1e-9). */
export function normalInv(p: number): number {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function computePmccStartPrice(input: PmccStartPriceInput): PmccStartPrice {
  const { spot, breakeven, ivxPct, shortDeltaMax, shortDteMin } = input;
  const rate = input.riskFreeRate ?? PMCC_START_PRICE_RISK_FREE_RATE;
  if (!positive(spot) || !positive(breakeven) || !positive(ivxPct)) return UNAVAILABLE;
  if (!positive(shortDteMin) || !(shortDeltaMax > 0 && shortDeltaMax < 1) || !Number.isFinite(rate)) return UNAVAILABLE;

  const sigma = ivxPct / 100;
  const years = shortDteMin / 365;
  const d1 = normalInv(shortDeltaMax);
  const lnSpotOverStrike = d1 * sigma * Math.sqrt(years) - (rate + (sigma * sigma) / 2) * years;
  const startPrice = Math.round(breakeven * Math.exp(lnSpotOverStrike) * 100) / 100;
  if (!Number.isFinite(startPrice) || startPrice <= 0) return UNAVAILABLE;

  if (spot >= startPrice) return { status: 'above', startPrice, pctToStart: null };
  return { status: 'below', startPrice, pctToStart: (startPrice / spot - 1) * 100 };
}
