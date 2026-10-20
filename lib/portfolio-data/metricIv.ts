// lib/portfolio-data/metricIv.ts
// IV-FIELD-0001: one reader for implied volatility on a Tastytrade /market-metrics item.
// The broker's documented field is `implied-volatility-index` (a fraction, e.g. 0.3412). The older
// aliases are kept first so existing behaviour is unchanged wherever they are present.

import { ivToPercent } from '../ivUnits';

const IV_FIELDS = ['implied-volatility', 'iv', 'implied-volatility-30-day', 'iv-30-day', 'implied-volatility-index'] as const;

/** Whole-number percent (41 for 41%), or null when no usable field is present. */
export function readMetricIvPercent(item: Record<string, unknown> | null | undefined): number | null {
  if (!item) return null;
  for (const field of IV_FIELDS) {
    const raw = item[field];
    const pct = ivToPercent(raw); // IV-BLANK-0001: unit-safe, so IV of 100% or more is not read as 1%
    if (pct != null) return Math.round(pct);
  }
  return null;
}
