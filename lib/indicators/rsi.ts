// lib/indicators/rsi.ts
//
// RSI-TURN-0001 (Alan's validated spec): RSI(14) with Wilder smoothing from daily closes.
// Pure and fail-closed: any invalid input returns null; bad elements are never skipped or repaired
// (skipping would shift the bar spacing). Nothing is rounded here; round for display only.

export const RSI_PERIOD = 14;

/** Minimum closes needed for one RSI value (14 changes need 15 closes). */
export const RSI_MIN_CLOSES = RSI_PERIOD + 1;

/**
 * RSI for close indexes 14..n-1 (so result[j] belongs to closes[j + 14]), oldest first.
 * Returns null when the input is not an array, is shorter than 15 closes, or contains anything that is
 * not a finite number greater than zero.
 */
export function rsiSeries(closes: unknown): number[] | null {
  if (!Array.isArray(closes) || closes.length < RSI_MIN_CLOSES) return null;
  for (const value of closes) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  }
  const c = closes as number[];
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= RSI_PERIOD; i += 1) {
    const change = c[i] - c[i - 1];
    if (change > 0) gains += change; else losses -= change;
  }
  let avgGain = gains / RSI_PERIOD;
  let avgLoss = losses / RSI_PERIOD;
  const out: number[] = [toRsi(avgGain, avgLoss)];
  for (let i = RSI_PERIOD + 1; i < c.length; i += 1) {
    const change = c[i] - c[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (RSI_PERIOD - 1) + gain) / RSI_PERIOD;
    avgLoss = (avgLoss * (RSI_PERIOD - 1) + loss) / RSI_PERIOD;
    out.push(toRsi(avgGain, avgLoss));
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgGain === 0 && avgLoss === 0) return 50; // flat: neutral, cannot trigger any state
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}
