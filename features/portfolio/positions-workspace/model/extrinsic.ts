// features/portfolio/positions-workspace/model/extrinsic.ts
//
// Extrinsic (time and volatility) value of a single bought option, now and at entry, per share. Display only.
// extrinsic = option price - intrinsic, where intrinsic is how far the stock is in the money at that moment.
// Fails closed: any missing input, or an extrinsic that comes out clearly negative (a stale or crossed quote), gives null, never a guess.

export interface ExtrinsicPositionShape {
  quantity: number;
  stockPrice: number | null;
  stockPriceAtEntry?: number | null;
  legs: ReadonlyArray<{ direction: string; optionType?: string; strikePrice?: number; avgOpenPrice?: number | null; currentPrice?: number | null }>;
}

export interface ExtrinsicView {
  /** Extrinsic per share now. */
  now: number;
  /** Extrinsic per share at entry, or null when the entry stock price or premium is unavailable. */
  atEntry: number | null;
  /** Change since entry per share (now minus entry), or null when either is unavailable. */
  change: number | null;
  /** Extrinsic as a percent of the option's current price. */
  pctOfValue: number | null;
  /** Extrinsic for the whole position, in dollars (per share x 100 x contracts). */
  totalNow: number;
}

/** A small negative can come from rounding; beyond this the price is treated as unreliable. */
const NEGATIVE_TOLERANCE = 0.05;

function extrinsicPerShare(optionPrice: number, stock: number, strike: number, optionType: string): number | null {
  const intrinsic = optionType === 'C' ? Math.max(0, stock - strike) : Math.max(0, strike - stock);
  const value = optionPrice - intrinsic;
  if (value < -NEGATIVE_TOLERANCE) return null;
  return Math.max(0, value);
}

const usable = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Only a single bought option has a meaningful "extrinsic paid for"; spreads, short options and shares return null. */
export function buildExtrinsicView(position: ExtrinsicPositionShape): ExtrinsicView | null {
  if (position.legs.length !== 1) return null;
  const leg = position.legs[0];
  if (leg.direction !== 'Long' || (leg.optionType !== 'C' && leg.optionType !== 'P')) return null;
  if (!usable(leg.strikePrice) || !usable(leg.currentPrice) || !usable(position.stockPrice)) return null;
  const now = extrinsicPerShare(leg.currentPrice, position.stockPrice, leg.strikePrice, leg.optionType);
  if (now == null) return null;
  const atEntry = usable(leg.avgOpenPrice) && usable(position.stockPriceAtEntry)
    ? extrinsicPerShare(leg.avgOpenPrice, position.stockPriceAtEntry, leg.strikePrice, leg.optionType)
    : null;
  return {
    now,
    atEntry,
    change: atEntry == null ? null : now - atEntry,
    pctOfValue: (now / leg.currentPrice) * 100,
    totalNow: now * 100 * Math.max(1, position.quantity),
  };
}
