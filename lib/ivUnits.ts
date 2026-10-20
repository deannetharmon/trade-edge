// lib/ivUnits.ts
// IV-BLANK-0001: one unit rule for implied volatility. The broker returns IV as a fraction (0.62 = 62%, 1.35 = 135%).
// Leveraged single-stock ETFs routinely exceed 100%, so a "below 1 means fraction" test misreads 1.35 as 1.35%.
// Same threshold as normalizeIv in lib/scans/scan-utils.ts: anything up to 5 (500%) is a fraction, larger is already a percent.

/** IV as a percent number (62.34 for 62.34%), or null when the value is missing, unparseable or not positive. */
export function ivToPercent(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n <= 5 ? n * 100 : n;
}
