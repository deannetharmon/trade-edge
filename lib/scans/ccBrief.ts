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

export interface CcFloorExplanationInput {
  floor: number | null;
  price: number | null;
  allowBelowBasis: boolean;
}

/**
 * CC-VISIBILITY-0001: when the cost-basis floor sits above the stock price (and the trader has not opted in), say so in
 * plain words with the numbers, so an empty scan is not mistaken for a delta or DTE problem. Null when the floor is not
 * what is blocking (no floor, floor at or below the price, or already opted in). Display only.
 */
export function ccFloorExplanation(i: CcFloorExplanationInput): string | null {
  if (i.allowBelowBasis || i.floor === null || i.price === null || !(i.price > 0) || !(i.floor > i.price)) return null;
  const pct = Math.round((i.floor / i.price - 1) * 100);
  return `Your floor is your cost basis, ${usd(i.floor)}, ${pct}% above the price, ${usd(i.price)}. Calls below it are hidden unless you allow them for this stock.`;
}

/** Not used for the earnings advisory: it carries the report date, so it keeps its own sentence. */
export function ccBriefReason(i: CcBriefInput): string {
  if (i.capacityBlocked) return i.oversubscribed ? 'Short calls already cover your shares' : 'Shares already covered';
  if (i.floorMissing) return 'Cost basis unknown';
  const parts = [`No call in Δ${d2(i.deltaMin)}–${d2(i.deltaMax)}`];
  if (i.nearest) parts.push(`nearest Δ${d2(i.nearest.delta)} at ${usd(i.nearest.strike)}`);
  if (i.floor !== null && i.price !== null && i.floor > i.price) parts.push(`floor ${usd(i.floor)}`);
  return parts.join(' · ');
}
