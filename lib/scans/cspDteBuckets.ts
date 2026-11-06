// lib/scans/cspDteBuckets.ts

// CSP-DTE-BEST-0001 — "Best by DTE": top picks per target expiry bucket, then everything else.
import type { ScreenResult } from './types';
import { INTENT_FLOORS, type CspIntent } from './cspIntent';

export const CSP_DTE_BUCKETS = [7, 14, 21, 28, 35, 42] as const;
export const CSP_DTE_BUCKET_TOLERANCE = 3; // days either side of a bucket
export const CSP_BEST_PER_BUCKET = 1; // one line per DTE (Dean)

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

// LIQUIDITY-PICK-0001 (Dean): a Best-by-DTE pick must also have a non-POOR spread (SPREAD-ONLY-0001: no open-interest floor; zero OI is already excluded).
// Income rank (Ian/Alan): trades that clear the Clean-card floors (yield >= 10%, POP >= 70, BE distance >= 4%)
// come first, then higher annualized return. Score is NOT used here: it rewards cushion, which favours
// far-OTM, tiny-credit puts.
export const INCOME_FLOORS = INTENT_FLOORS.premium;

// PICK-OTM-0001 (Dean, TQQQ screenshot): a pick must be OTM or ATM (strike <= price). A deep-ITM put's credit is mostly
// intrinsic value, so its raw annualized return (284% on TQQQ) is not income. Yield is the extrinsic-only annualized
// return, the same figure the CSP score already uses. When nothing at a DTE clears the floors, the safest (higher POP,
// OTM first) line is shown instead of the highest-yield one.
export function incomeKey(r: ScreenResult, intent: CspIntent = 'premium'): [number, number, number] {
  const f = INTENT_FLOORS[intent];
  const c = r.bestCandidate as any;
  const ext = Number(c?.cspExtrinsicAnnualizedRoc);
  const yieldPct = Number.isFinite(ext) ? ext : Number(c?.annualizedRoc);
  const pop = Number(c?.pop);
  const price = Number(r.price);
  const strike = Number(c?.shortStrike);
  const be = Number(c?.breakeven);
  const otm = price > 0 && Number.isFinite(strike) && strike <= price;
  const dist = price > 0 && Number.isFinite(be) ? ((price - be) / price) * 100 : NaN;
  const ok = otm && Number.isFinite(yieldPct) && Number.isFinite(pop) && Number.isFinite(dist)
    && c?.cspLiquidityClass !== 'POOR'
    && yieldPct >= f.yieldPct && pop >= f.pop && dist >= f.beDistPct;
  return [ok ? 1 : 0, otm ? 1 : 0, ok ? yieldPct : (Number.isFinite(pop) ? pop : -Infinity)];
}

function byIncome(intent: CspIntent) {
  return (x: { r: ScreenResult; i: number }, y: { r: ScreenResult; i: number }): number => {
  const [xt, xo, xv] = incomeKey(x.r, intent); const [yt, yo, yv] = incomeKey(y.r, intent);
  return yt - xt || yo - xo || yv - xv || x.i - y.i;
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
    if (!list?.length) continue; // no contracts at this DTE at all: no line
    // stable: ties keep the incoming order
    // NO-JUNK-PICK-0001 (Dean, TQQQ 7 DTE: Put 35, $19 credit, OI 18, Poor spread): a line is only a pick when it clears
    // every floor. A DTE where nothing does shows an empty line, never a filler pick.
    const top = list.map((r, i) => ({ r, i })).sort(byIncome(intent))
      .filter(x => incomeKey(x.r, intent)[0] === 1)
      .slice(0, CSP_BEST_PER_BUCKET).map(x => x.r);
    top.forEach(r => picked.add(r));
    groups.push({ bucket: b, results: top }); // results may be empty: contracts exist but none clear the floors
  }
  return { groups, rest: ordered.filter(r => !picked.has(r)) };
}
