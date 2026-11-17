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
  /** Calls whose POP is inside the range but whose price gap is too big (counted from the strike grid). */
  widePopInRange?: number;
  floor: number | null;
  price: number | null;
}

const d2 = (n: number) => n.toFixed(2);
const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

export interface CcFloorExplanationInput {
  floor: number | null;
  price: number | null;
}

/**
 * CC-VISIBILITY-0001: when the cost-basis floor sits above the stock price, say so in plain words with the numbers, so an
 * empty scan is not mistaken for a delta or DTE problem. Null when the floor is not what is blocking (no floor, or floor
 * at or below the price). Display only.
 */
export function ccFloorExplanation(i: CcFloorExplanationInput): string | null {
  if (i.floor === null || i.price === null || !(i.price > 0) || !(i.floor > i.price)) return null;
  const pct = Math.round((i.floor / i.price - 1) * 100);
  return `Your floor is your cost basis, ${usd(i.floor)}, ${pct}% above the price, ${usd(i.price)}. No call is offered below it.`;
}

/** Not used for the earnings advisory: it carries the report date, so it keeps its own sentence. */
export function ccBriefReason(i: CcBriefInput): string {
  if (i.capacityBlocked) return i.oversubscribed ? 'Short calls already cover your shares' : 'Shares already covered';
  if (i.floorMissing) return 'Cost basis unknown';
  // CC-PMCC-GUIDANCE-0001: POP, not delta. POP = (1 - delta) x 100.
  const pop = (d: number) => Math.round((1 - d) * 100);
  const range = `${pop(i.deltaMax)}–${pop(i.deltaMin)}%`;
  // The real blocker: calls exist in the range, but none can be filled near the middle price.
  if ((i.widePopInRange ?? 0) > 0) return `${i.widePopInRange} call${i.widePopInRange === 1 ? ' has' : 's have'} POP ${range}, but the price gap is too big on ${i.widePopInRange === 1 ? 'it' : 'every one'}`;
  const parts = [`No call with POP ${range}`];
  if (i.nearest) parts.push(`nearest POP ${pop(i.nearest.delta)}% at ${usd(i.nearest.strike)}`);
  // The floor is not repeated here: the cost line and the timing line under the row already say it.
  return parts.join(' · ');
}
