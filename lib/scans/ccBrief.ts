// lib/scans/ccBrief.ts
//
// CC-SIMPLIFY-0001G -- the one-line reason a covered-call ticker did not qualify. Pure. The long diagnostic sentence stays
// in the scan's failReasons; this is what the results screen shows.

export interface CcBriefInput {
  capacityBlocked: boolean;
  oversubscribed: boolean;
  floorMissing: boolean;
  deltaMin: number;
  deltaMax: number;
  nearest: { strike: number; delta: number } | null;
  floor: number | null;
  price: number | null;
}

const d2 = (n: number) => n.toFixed(2);
const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** Not used for the earnings advisory: it carries the report date, so it keeps its own sentence. */
export function ccBriefReason(i: CcBriefInput): string {
  if (i.capacityBlocked) return i.oversubscribed ? 'Short calls already cover your shares' : 'Shares already covered';
  if (i.floorMissing) return 'Cost basis unknown';
  const parts = [`No call in Δ${d2(i.deltaMin)}–${d2(i.deltaMax)}`];
  if (i.nearest) parts.push(`nearest Δ${d2(i.nearest.delta)} at ${usd(i.nearest.strike)}`);
  if (i.floor !== null && i.price !== null && i.floor > i.price) parts.push(`floor ${usd(i.floor)}`);
  return parts.join(' · ');
}
