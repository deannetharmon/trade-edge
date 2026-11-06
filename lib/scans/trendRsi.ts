// lib/scans/trendRsi.ts

/** The RSI to show: the real value, or null (display "—") when it could not be computed. Never a made-up 50. */
export function trendRsiForDisplay(metrics: { rsi14?: number | null; rsi14Known?: boolean } | null | undefined): number | null {
  if (!metrics || metrics.rsi14Known === false) return null;
  return typeof metrics.rsi14 === 'number' && Number.isFinite(metrics.rsi14) ? metrics.rsi14 : null;
}
