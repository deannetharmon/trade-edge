// lib/trademap/pricing.ts
//
// OPTMAP-0001 S1 (Alan's spec, decision record 2026-11-17): Black-Scholes
// pricing for the Trade Map P/L grid. Pure functions, no network, no UI.
//
//   - European exercise only. Early exercise of American options is ignored,
//     so deep in-the-money puts (and calls before a dividend) are priced
//     above what an American-exercise model shows. Always labeled a model
//     estimate by the caller.
//   - IV is a FRACTION here (1.84 = 184%), the same unit the broker sends in
//     the option quote field `volatility`. Convert with lib/ivUnits first.
//   - Time is calendar days / 365; a date column is valued at that day's
//     close, so the expiration date itself prices at intrinsic value.
//   - Fail closed: any invalid input returns null, never a guessed number.

export type OptionRight = 'C' | 'P';

export const DEFAULT_RISK_FREE_RATE = 0.04;
export const DAYS_PER_YEAR = 365;
const MS_PER_DAY = 86_400_000;

/** Standard normal CDF (Hart/West double-precision algorithm, error ~1e-15). */
export function normCdf(x: number): number {
  const xabs = Math.abs(x);
  let c: number;
  if (xabs > 37) {
    c = 0;
  } else {
    const e = Math.exp((-xabs * xabs) / 2);
    if (xabs < 7.07106781186547) {
      let b = 3.52624965998911e-2 * xabs + 0.700383064443688;
      b = b * xabs + 6.37396220353165;
      b = b * xabs + 33.912866078383;
      b = b * xabs + 112.079291497871;
      b = b * xabs + 221.213596169931;
      b = b * xabs + 220.206867912376;
      c = e * b;
      let d = 8.83883476483184e-2 * xabs + 1.75566716318264;
      d = d * xabs + 16.064177579207;
      d = d * xabs + 86.7807322029461;
      d = d * xabs + 296.564248779674;
      d = d * xabs + 637.333633378831;
      d = d * xabs + 793.826512519948;
      d = d * xabs + 440.413735824752;
      c = c / d;
    } else {
      let b = xabs + 0.65;
      b = xabs + 4 / b;
      b = xabs + 3 / b;
      b = xabs + 2 / b;
      b = xabs + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

/** Calendar days from isoA to isoB (both YYYY-MM-DD), or null if either is not a valid date. */
export function daysBetween(isoA: string, isoB: string): number | null {
  const a = isoToUtcMs(isoA);
  const b = isoToUtcMs(isoB);
  if (a == null || b == null) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

export function isoToUtcMs(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  // Reject rollovers such as 2026-02-31.
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return ms;
}

export function utcMsToIso(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

export function intrinsicValue(right: OptionRight, spot: number, strike: number): number {
  return right === 'C' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

/**
 * Black-Scholes value of one option, per share.
 * @param t     years to expiration (calendar days / 365); 0 prices at intrinsic value
 * @param rate  continuous risk-free rate
 * @param yield continuous dividend yield
 * @param sigma implied volatility as a fraction; 0 prices at the discounted-forward intrinsic value
 */
export function bsPrice(
  right: OptionRight,
  spot: number,
  strike: number,
  t: number,
  rate: number,
  dividendYield: number,
  sigma: number,
): number | null {
  if (right !== 'C' && right !== 'P') return null;
  if (![spot, strike, t, rate, dividendYield, sigma].every(Number.isFinite)) return null;
  if (spot <= 0 || strike <= 0 || t < 0 || sigma < 0) return null;

  if (t === 0) return intrinsicValue(right, spot, strike);

  const discountedSpot = spot * Math.exp(-dividendYield * t);
  const discountedStrike = strike * Math.exp(-rate * t);
  if (sigma === 0) {
    const forward = discountedSpot - discountedStrike;
    return right === 'C' ? Math.max(forward, 0) : Math.max(-forward, 0);
  }

  const sd = sigma * Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (rate - dividendYield + (sigma * sigma) / 2) * t) / sd;
  const d2 = d1 - sd;
  return right === 'C'
    ? discountedSpot * normCdf(d1) - discountedStrike * normCdf(d2)
    : discountedStrike * normCdf(-d2) - discountedSpot * normCdf(-d1);
}
