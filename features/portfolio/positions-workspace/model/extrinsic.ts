// features/portfolio/positions-workspace/model/extrinsic.ts
//
// Splits a position's option value into intrinsic (how far in the money) and extrinsic (time and volatility), now and at entry, per share.
// Display only. The split is always from the trader's side:
//   side 'long'  (net bought: LEAP, bought put or call, debit spread, PMCC): the value you own. Up is good for you.
//   side 'short' (net sold: CSP, short call, credit spread, iron condor): the value you owe to close. Down is good for you.
// For a spread it nets the legs, so intrinsic + extrinsic equals the net price to close.
// Fails closed: any missing input, or an extrinsic that comes out clearly negative (a stale or crossed quote), gives null, never a guess.

export interface ValuePositionShape {
  quantity: number;
  stockPrice: number | null;
  stockPriceAtEntry?: number | null;
  entryPriceEffect?: 'Credit' | 'Debit' | 'Unknown' | null;
  legs: ReadonlyArray<{ direction: string; optionType?: string; strikePrice?: number; avgOpenPrice?: number | null; currentPrice?: number | null }>;
}

export interface ValueAmount {
  now: number;
  /** null when the entry stock price or an entry premium is unavailable. */
  atEntry: number | null;
  /** now minus entry, or null when either is unavailable. */
  change: number | null;
}

export interface ValueSplit {
  side: 'long' | 'short';
  intrinsic: ValueAmount;
  extrinsic: ValueAmount;
  /** Extrinsic as a percent of the net option price now (of what you own, or of what it costs to close). */
  extrinsicPctOfValue: number | null;
  /** Extrinsic for the whole position, in dollars (per share x 100 x contracts). */
  extrinsicTotalNow: number;
}

/** A small negative can come from rounding; beyond this the price is treated as unreliable. */
const NEGATIVE_TOLERANCE = 0.05;
const usable = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

interface LegParts { intrinsic: number; extrinsic: number }

function legParts(price: number, stock: number, strike: number, optionType: string): LegParts | null {
  const intrinsic = optionType === 'C' ? Math.max(0, stock - strike) : Math.max(0, strike - stock);
  const extrinsic = price - intrinsic;
  if (extrinsic < -NEGATIVE_TOLERANCE) return null;
  return { intrinsic, extrinsic: Math.max(0, extrinsic) };
}

/** Signed sums across legs from the holder's view: bought legs count +, sold legs count -. Null when any leg cannot be split. */
function holderSums(legs: ValuePositionShape['legs'], stock: number, priceOf: (leg: ValuePositionShape['legs'][number]) => number | null | undefined): { intrinsic: number; extrinsic: number; price: number } | null {
  let intrinsic = 0, extrinsic = 0, price = 0;
  for (const leg of legs) {
    const px = priceOf(leg);
    if (!usable(leg.strikePrice) || !usable(px) || (leg.optionType !== 'C' && leg.optionType !== 'P')) return null;
    const parts = legParts(px, stock, leg.strikePrice, leg.optionType);
    if (!parts) return null;
    const sign = leg.direction === 'Long' ? 1 : leg.direction === 'Short' ? -1 : 0;
    if (sign === 0) return null;
    intrinsic += sign * parts.intrinsic;
    extrinsic += sign * parts.extrinsic;
    price += sign * px;
  }
  return { intrinsic, extrinsic, price };
}

export function buildValueSplit(position: ValuePositionShape): ValueSplit | null {
  if (position.legs.length === 0 || !usable(position.stockPrice)) return null;
  const now = holderSums(position.legs, position.stockPrice, leg => leg.currentPrice);
  if (!now) return null;
  const effect = position.entryPriceEffect;
  const side: 'long' | 'short' = effect === 'Debit' ? 'long' : effect === 'Credit' ? 'short' : now.price >= 0 ? 'long' : 'short';
  const sign = side === 'long' ? 1 : -1;
  const nowIntrinsic = sign * now.intrinsic;
  const nowExtrinsic = sign * now.extrinsic;
  const entry = usable(position.stockPriceAtEntry) ? holderSums(position.legs, position.stockPriceAtEntry, leg => leg.avgOpenPrice) : null;
  const entryIntrinsic = entry ? sign * entry.intrinsic : null;
  const entryExtrinsic = entry ? sign * entry.extrinsic : null;
  // Each leg is checked on its own (a leg priced under its intrinsic is a stale quote). The NET of a spread can legitimately be
  // negative, for example a credit spread whose short leg is in the money, so the net is shown as it is.
  const clean = (value: number): number => (value === 0 ? 0 : value); // no negative zero from the sign flip
  const amount = (nowValue: number, entryValue: number | null): ValueAmount => ({ now: clean(nowValue), atEntry: entryValue == null ? null : clean(entryValue), change: entryValue == null ? null : clean(nowValue - entryValue) });
  const netPrice = sign * now.price;
  return {
    side,
    intrinsic: amount(nowIntrinsic, entryIntrinsic),
    extrinsic: amount(nowExtrinsic, entryExtrinsic),
    extrinsicPctOfValue: netPrice > 0 && nowExtrinsic >= 0 ? (nowExtrinsic / netPrice) * 100 : null,
    extrinsicTotalNow: nowExtrinsic * 100 * Math.max(1, position.quantity),
  };
}
