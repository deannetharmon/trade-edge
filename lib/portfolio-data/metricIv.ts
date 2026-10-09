// lib/portfolio-data/metricIv.ts
// IV-FIELD-0001: one reader for implied volatility on a Tastytrade /market-metrics item.
// The broker's documented field is `implied-volatility-index` (a fraction, e.g. 0.3412). The older
// aliases are kept first so existing behaviour is unchanged wherever they are present.

const IV_FIELDS = ['implied-volatility', 'iv', 'implied-volatility-30-day', 'iv-30-day', 'implied-volatility-index'] as const;

/** Whole-number percent (41 for 41%), or null when no usable field is present. */
export function readMetricIvPercent(item: Record<string, unknown> | null | undefined): number | null {
  if (!item) return null;
  for (const field of IV_FIELDS) {
    const raw = item[field];
    if (raw == null) continue;
    const parsed = parseFloat(String(raw));
    if (Number.isFinite(parsed)) return parsed < 1 ? Math.round(parsed * 100) : Math.round(parsed);
  }
  return null;
}
