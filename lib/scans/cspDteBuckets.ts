// CSP-DTE-BEST-0001 — "Best by DTE": top picks per target expiry bucket, then everything else.
import type { ScreenResult } from './types';
import { INTENT_FLOORS, type CspIntent } from './cspIntent';

export const CSP_DTE_BUCKETS = [7, 14, 21, 28, 35, 42] as const;
export const CSP_DTE_BUCKET_TOLERANCE = 3; // days either side of a bucket
export const CSP_BEST_PER_BUCKET = 3;

export interface CspDteBucketGroup { bucket: number; results: ScreenResult[] }
export interface CspDteSplit { groups: CspDteBucketGroup[]; rest: ScreenResult[] }

export function cspBucketFor(dte: number | null | undefined): number | null {
  if (dte == null || !Number.isFinite(dte)) return null;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const b of CSP_DTE_BUCKETS) {
    const d = Math.abs(dte - b);
    if (d <= CSP_DTE_BUCKET_TOLERANCE && d < bestDist) { best = b; bestDist = d; }
  }
  return best;
}

// Income rank (Ian/Alan): trades that clear the Clean-card floors (yield >= 10%, POP >= 70, BE distance >= 4%)
// come first, then higher annualized return. Score is NOT used here: it rewards cushion, which favours
// far-OTM, tiny-credit puts.
export const INCOME_FLOORS = INTENT_FLOORS.premium;

export function incomeKey(r: ScreenResult, intent: CspIntent = 'premium'): [number, number] {
  const f = INTENT_FLOORS[intent];
  const c = r.bestCandidate as any;
  const ann = Number(c?.annualizedRoc);
  const pop = Number(c?.pop);
  const price = Number(r.price);
  const be = Number(c?.breakeven);
  const dist = price > 0 && Number.isFinite(be) ? ((price - be) / price) * 100 : NaN;
  const ok = Number.isFinite(ann) && Number.isFinite(pop) && Number.isFinite(dist)
    && ann >= f.yieldPct && pop >= f.pop && dist >= f.beDistPct;
  return [ok ? 1 : 0, Number.isFinite(ann) ? ann : -Infinity];
}

function byIncome(intent: CspIntent) {
  return (x: { r: ScreenResult; i: number }, y: { r: ScreenResult; i: number }): number => {
  const [xt, xv] = incomeKey(x.r, intent); const [yt, yv] = incomeKey(y.r, intent);
  return yt - xt || yv - xv || x.i - y.i;
  };
}

/** `ordered` is the list in the user's current sort order; `rest` keeps that order. */
export function splitCspByDte(ordered: ScreenResult[], intent: CspIntent = 'premium'): CspDteSplit {
  const byBucket = new Map<number, ScreenResult[]>();
  for (const r of ordered) {
    const b = cspBucketFor(r.bestCandidate?.dte);
    if (b == null) continue;
    byBucket.set(b, [...(byBucket.get(b) ?? []), r]);
  }
  const picked = new Set<ScreenResult>();
  const groups: CspDteBucketGroup[] = [];
  for (const b of CSP_DTE_BUCKETS) {
    const list = byBucket.get(b);
    if (!list?.length) continue;
    // stable: ties keep the incoming order
    const top = list.map((r, i) => ({ r, i })).sort(byIncome(intent))
      .slice(0, CSP_BEST_PER_BUCKET).map(x => x.r);
    top.forEach(r => picked.add(r));
    groups.push({ bucket: b, results: top });
  }
  return { groups, rest: ordered.filter(r => !picked.has(r)) };
}
