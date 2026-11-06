// lib/market-movers/candidates.ts

import { volumeMultiple } from './gates';
import type { Candidate, MarketMoversSettings, TickerInput } from './types';

/** Day change = (last - prior close) / prior close, as a percent. Null when either price is missing. */
export function dayChangePct(last: number | null, priorClose: number | null): number | null {
  if (last == null || priorClose == null || !Number.isFinite(last) || !Number.isFinite(priorClose) || priorClose <= 0) return null;
  return ((last - priorClose) / priorClose) * 100;
}

/**
 * Builds the candidate list: IV below the minimum or missing IV excludes the ticker with a visible reason (fail closed);
 * the rest are sorted by day change ascending. A decliner smaller than the minimum drop is a watch item, never the pick.
 */
export function buildCandidates(tickers: TickerInput[], settings: MarketMoversSettings): Candidate[] {
  const rows: Candidate[] = tickers.map((t) => {
    const change = dayChangePct(t.last, t.priorClose);
    const mult = volumeMultiple(t.volume, t.avgVolume20);
    const base = { symbol: t.symbol, dayChangePct: change, ivPct: t.ivPct, volumeMultiple: mult };
    if (t.ivPct == null) return { ...base, status: 'EXCLUDED', reason: 'IV unavailable.' };
    if (t.ivPct < settings.minIvPct) return { ...base, status: 'EXCLUDED', reason: `IV ${Math.round(t.ivPct)}% is below ${settings.minIvPct}%.` };
    if (change == null) return { ...base, status: 'EXCLUDED', reason: 'Price change unavailable.' };
    if (mult != null && mult >= settings.volumeNoGoMultiple) {
      return { ...base, status: 'EXCLUDED', reason: `Volume ${mult.toFixed(1)}x its 20-day average.` };
    }
    if (change > -settings.minDropPct) {
      return { ...base, status: 'WATCH', reason: `Down ${Math.max(0, -change).toFixed(1)}%, under the ${settings.minDropPct}% minimum drop.` };
    }
    return { ...base, status: 'PICK_ELIGIBLE', reason: '' };
  });

  const rank = (c: Candidate) => (c.status === 'EXCLUDED' ? 1 : 0);
  return rows.sort((a, b) => rank(a) - rank(b) || (a.dayChangePct ?? Infinity) - (b.dayChangePct ?? Infinity) || a.symbol.localeCompare(b.symbol));
}

/** The pick is the first eligible candidate (biggest decliner at least the minimum drop), or null: "no pick today". */
export function topPick(candidates: Candidate[]): Candidate | null {
  return candidates.find((c) => c.status === 'PICK_ELIGIBLE') ?? null;
}
