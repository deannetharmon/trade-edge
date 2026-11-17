// lib/scans/pmccFilterConflict.ts

import type { PmccLegRejection } from './pmccTypes';

export interface PmccFilterConflict {
  /** One plain sentence naming both settings and why no strike can meet both. */
  line: string;
  /** Highest rejected strike that only failed the above-price floor (so its delta fits). */
  closestStrike: number;
  closestBid: number | null;
  /** The largest whole % that would let that strike through. */
  suggestedMinAbovePct: number;
}

const ABOVE_RE = /less than (\d+(?:\.\d+)?)% above the \$(\d+(?:\.\d+)?) price/;
const DELTA_RE = /outside (\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/;

/**
 * PMCC-FILTER-CONFLICT-0001: a held-LEAP scan can come back empty because two of the trader's own settings
 * cannot both be met (strikes that fit the delta range sit under the above-price floor, strikes above the
 * floor fall outside the delta range). Detect that from the rejections the scan already carries.
 * Returns null unless both groups exist, so it never fires for an ordinary empty result.
 */
export function detectPmccFilterConflict(rejections: readonly PmccLegRejection[] | null | undefined): PmccFilterConflict | null {
  if (!rejections || rejections.length === 0) return null;
  const shorts = rejections.filter(r => r.role === 'short');
  const floorOnly = shorts.filter(r => r.reasons.length > 0 && r.reasons.every(x => x.code === 'STRIKE_TOO_CLOSE_TO_PRICE'));
  const deltaOnly = shorts.filter(r => r.reasons.some(x => x.code === 'DELTA_OUT_OF_RANGE') && !r.reasons.some(x => x.code === 'STRIKE_TOO_CLOSE_TO_PRICE'));
  if (floorOnly.length === 0 || deltaOnly.length === 0) return null;

  let pct: number | null = null;
  let price: number | null = null;
  for (const r of floorOnly) {
    const m = r.reasons.map(x => ABOVE_RE.exec(x.message)).find(Boolean);
    if (m) { pct = parseFloat(m[1]); price = parseFloat(m[2]); break; }
  }
  let dMin: number | null = null;
  let dMax: number | null = null;
  for (const r of deltaOnly) {
    const m = r.reasons.map(x => DELTA_RE.exec(x.message)).find(Boolean);
    if (m) { dMin = parseFloat(m[1]); dMax = parseFloat(m[2]); break; }
  }
  if (pct == null || price == null || dMin == null || dMax == null || price <= 0) return null;

  const best = [...floorOnly].sort((a, b) => b.strike - a.strike)[0];
  const strikes = floorOnly.map(r => r.strike);
  const lo = Math.min(...strikes);
  const hi = Math.max(...strikes);
  const floor = price * (1 + pct / 100);
  const bestPct = (best.strike / price - 1) * 100;
  const suggested = Math.max(0, Math.floor(bestPct));
  const strikeText = lo === hi ? `$${hi}` : `$${lo}-$${hi}`;
  const bidText = best.bid != null ? `, bid $${best.bid.toFixed(2)}` : '';
  const line = `Your settings conflict: calls inside delta ${dMin.toFixed(2)}-${dMax.toFixed(2)} (${strikeText}) are under your ${pct}% above-price floor ($${floor.toFixed(2)}), and strikes above the floor fall outside that delta range. Closest: the $${best.strike} call${bidText}, ${bestPct.toFixed(1)}% above price. Set Min % above price to ${suggested}% or lower, or widen the delta range, then rescan.`;
  return { line, closestStrike: best.strike, closestBid: best.bid ?? null, suggestedMinAbovePct: suggested };
}
