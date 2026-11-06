// lib/scans/cleanCard.ts
//
// CLEAN-CARD-0001 -- pure math and color bands for the Clean view of a CSP screener card.
// No React, no fetching. Every colored number on the Clean line is decided here so the bands
// live in one place and are tested. Display only: nothing here changes qualification or scores.

export type Tone = 'green' | 'yellow' | 'red' | 'none';

/** Bands proposed in the mock: green inside the rule, yellow near the edge, red outside. */
export const CLEAN_BANDS = {
  /** Annualized yield % (same cut-offs the Full card already uses). */
  yieldGreen: 20, yieldYellow: 10,
  /** Probability of profit %. */
  popGreen: 80, popYellow: 70,
  /** Break-even distance % and OTM % (rinse-repeat convention). */
  distGreen: 7, distYellow: 4,
  /** Allocation % of net liquidation after the trade (Dean's Oct 7 tiers). */
  allocYellow: 15, allocRed: 25,
} as const;

const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

export function yieldTone(annualizedPct: number | null | undefined): Tone {
  if (!finite(annualizedPct)) return 'none';
  return annualizedPct >= CLEAN_BANDS.yieldGreen ? 'green' : annualizedPct >= CLEAN_BANDS.yieldYellow ? 'yellow' : 'red';
}

export function popTone(popPct: number | null | undefined): Tone {
  if (!finite(popPct)) return 'none';
  return popPct >= CLEAN_BANDS.popGreen ? 'green' : popPct >= CLEAN_BANDS.popYellow ? 'yellow' : 'red';
}

/** Used for both OTM % and BE distance %. */
export function distanceTone(pct: number | null | undefined): Tone {
  if (!finite(pct)) return 'none';
  return pct >= CLEAN_BANDS.distGreen ? 'green' : pct >= CLEAN_BANDS.distYellow ? 'yellow' : 'red';
}

export function allocTone(afterPct: number | null | undefined): Tone {
  if (!finite(afterPct)) return 'none';
  return afterPct > CLEAN_BANDS.allocRed ? 'red' : afterPct >= CLEAN_BANDS.allocYellow ? 'yellow' : 'green';
}

/** OI is advisory: yellow when below the preferred floor, never red. */
export function oiTone(oi: number | null | undefined, floor: number): Tone {
  if (!finite(oi)) return 'none';
  return oi >= floor ? 'none' : 'yellow';
}

/**
 * Break-even distance %: how far the stock can fall before the put loses money, as a % of price.
 * Uses the candidate's own breakeven when present, else strike minus credit per share.
 */
export function breakevenDistancePct(input: {
  price: number | null | undefined; breakeven?: number | null; strike?: number | null; creditPerShare?: number | null;
}): number | null {
  const { price } = input;
  if (!finite(price) || price <= 0) return null;
  const be = finite(input.breakeven) ? input.breakeven
    : finite(input.strike) && finite(input.creditPerShare) ? input.strike - input.creditPerShare : null;
  return be == null ? null : ((price - be) / price) * 100;
}

export function otmPct(price: number | null | undefined, strike: number | null | undefined): number | null {
  if (!finite(price) || price <= 0 || !finite(strike)) return null;
  return ((price - strike) / price) * 100;
}

export interface AllocBook {
  /** Net liquidating value of the account. */
  netLiq: number;
  /** Dollars already committed per underlying: shares at market + cash secured by short puts. */
  bySymbol: Record<string, number>;
}

export interface AllocResult { currentPct: number; afterPct: number; currentDollars: number; addDollars: number; afterDollars: number; netLiq: number }

/** Fail closed: no book, no net liquidation, or no cash figure means no allocation (never a guess). */
export function allocationFor(book: AllocBook | null | undefined, symbol: string, addDollars: number | null | undefined): AllocResult | null {
  if (!book || !finite(book.netLiq) || book.netLiq <= 0 || !finite(addDollars) || addDollars < 0) return null;
  const currentDollars = book.bySymbol[symbol] ?? 0;
  const afterDollars = currentDollars + addDollars;
  return {
    currentPct: (currentDollars / book.netLiq) * 100,
    afterPct: (afterDollars / book.netLiq) * 100,
    currentDollars, addDollars, afterDollars, netLiq: book.netLiq,
  };
}

export function fmtPct0(n: number): string { return `${Math.round(n)}%`; }
export function fmtMoney0(n: number): string { return `$${Math.round(n).toLocaleString('en-US')}`; }

/** Tailwind text class per tone, shared by the Clean line and the expanded grid. */
export const TONE_CLASS: Record<Tone, string> = {
  green: 'text-emerald-400', yellow: 'text-yellow-400', red: 'text-red-400', none: '',
};
