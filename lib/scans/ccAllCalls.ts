// lib/scans/ccAllCalls.ts

// CHAIN-ALL-0001 slice 1: the "Show all calls" list. Every call on one expiration, nothing hidden, each row tagged with the
// plain reasons it is not a pick. Open interest is a column, not a reason. Pure; the broker reads happen in CcAllCallsModal. A row is a pick only when it has no
// reasons; below-cost and in-the-money rows are never offered an order button (Dean, 2026-11-27).
//
// Reasons use the same rules as the scan: price gap (hybridSpread), minimum pay (ccEffectiveMinPay), POP = 1 - delta.

import type { ChainRow } from '@/lib/tradeLookup/lookupTypes';
import { DEFAULT_CC_RULES } from './constants';
import { CC_GAP_FLOOR_DOLLARS } from './covered-call-finder';
import { evaluateHybridSpread } from './hybridSpread';
import { ccEffectiveMinPay, ccPopPct, ccPriceGapPct } from './ccGuidance';
import { computeCcLotLoss, ccLotLossLine, type CcLot } from './ccLotLoss';

export type CcAllReason = 'below_cost' | 'in_the_money' | 'wide' | 'pays_under' | 'no_quote';

/** Price gap colour: green under 5% of the mid, yellow up to the allowed limit, red when it breaks the rule. Null with no quote. */
export type CcGapTone = 'green' | 'yellow' | 'red';
export function gapTone(row: Pick<CcAllRow, 'gapCents' | 'reasons' | 'bid' | 'ask'>): CcGapTone | null {
  if (row.gapCents === null || row.bid === null || row.ask === null) return null;
  if (row.reasons.includes('wide')) return 'red';
  const pct = ccPriceGapPct(row.bid, row.ask);
  return pct !== null && pct < 5 ? 'green' : 'yellow';
}

export const CC_ALL_REASON_TEXT: Record<CcAllReason, string> = {
  below_cost: 'Below your cost',
  in_the_money: 'Under the stock price',
  wide: 'Price gap too big',
  pays_under: 'Pays under',
  no_quote: 'No quote',
};

export interface CcAllRow {
  expiration: string;
  dte: number;
  strike: number;
  occSymbol: string;
  bid: number | null;
  ask: number | null;
  /** Mid per share, whole cents rounded down (same as the order dialog); null with no two-sided quote. */
  mid: number | null;
  /** Dollars collected for one contract at the mid; null with no quote. On a call under the stock price most of this is stock value, not premium. */
  collect: number | null;
  /** The real premium for one contract: collect minus what the call is worth just from the stock being above the strike. */
  timeValue: number | null;
  /** The delta as given, absolute; null when unknown. */
  delta: number | null;
  abovePricePct: number | null;
  /** Chance of keeping the shares, percent; null when the broker gave no delta. */
  popPct: number | null;
  gapCents: number | null;
  /** Open interest as given; shown as its own column, not a reason (Dean, 2026-11-27). */
  openInterest: number | null;
  reasons: CcAllReason[];
  isPick: boolean;
  /** The plain-words line for a below-cost row (CC-LOTS-0001), when the lots are proven. */
  lotLossLine: string | null;
}

export interface CcAllInput {
  rows: ReadonlyArray<ChainRow>;
  dte: number;
  stockPrice: number | null;
  /** The cost the strike is judged against (highest lot when known, else the basis); null = unknown. */
  floorBasis: number | null;
  lots: ReadonlyArray<CcLot> | null;
  /** The minimum-pay chip from the scan. */
  minPayChip: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function buildCcAllRows(i: CcAllInput): CcAllRow[] {
  const calls = i.rows.filter(r => r.right === 'C');
  const minPay = ccEffectiveMinPay(i.minPayChip);
  const out: CcAllRow[] = [];
  for (const r of calls) {
    const twoSided = r.bid !== null && r.ask !== null && r.bid > 0 && r.ask > 0 && r.ask >= r.bid;
    const mid = twoSided ? Math.floor((((r.bid as number) + (r.ask as number)) / 2) * 100 + 1e-9) / 100 : null;
    const collect = mid === null ? null : cents(mid * 100);
    const wide = twoSided && evaluateHybridSpread(r.bid as number, r.ask as number, { rejectPct: DEFAULT_CC_RULES.WIDTH_PCT_MAX, warnPct: 5, ceiling: DEFAULT_CC_RULES.WIDTH_CEILING, floorDollars: CC_GAP_FLOOR_DOLLARS }).reject;
    const reasons: CcAllReason[] = [];
    if (i.floorBasis !== null && r.strike < i.floorBasis) reasons.push('below_cost');
    if (i.stockPrice !== null && r.strike < i.stockPrice) reasons.push('in_the_money');
    if (!twoSided) reasons.push('no_quote');
    else if (wide) reasons.push('wide');
    // A wide row is judged on its bid, like the scan's grid: the middle price is not real there.
    const payTotal = wide ? cents((r.bid as number) * 100) : collect;
    if (twoSided && payTotal !== null && payTotal < minPay) reasons.push('pays_under');
    let lotLossLine: string | null = null;
    if (reasons.includes('below_cost') && i.lots && mid !== null) {
      const l = computeCcLotLoss({ lots: i.lots, strike: r.strike, premiumPerShare: mid, contracts: 1 });
      lotLossLine = l ? ccLotLossLine(l) : null;
    }
    out.push({
      expiration: r.expiration, dte: i.dte, strike: r.strike, occSymbol: r.occSymbol, bid: r.bid, ask: r.ask, mid, collect,
      timeValue: collect === null ? null : cents(Math.max(0, collect - (i.stockPrice !== null ? Math.max(0, i.stockPrice - r.strike) * 100 : 0))),
      delta: r.delta === null ? null : Math.abs(r.delta),
      abovePricePct: i.stockPrice !== null && i.stockPrice > 0 ? Math.round(((r.strike - i.stockPrice) / i.stockPrice) * 1000) / 10 : null,
      popPct: r.delta === null ? null : ccPopPct(r.delta),
      gapCents: twoSided ? Math.round(((r.ask as number) - (r.bid as number)) * 100) : null,
      openInterest: typeof r.openInterest === 'number' ? r.openInterest : null,
      reasons, isPick: reasons.length === 0, lotLossLine,
    });
  }
  return out.sort((a, b) => a.strike - b.strike);
}

/** True when every row carries the below-cost reason: the screen then says it once at the top instead of on every row. */
export function allBelowCost(rows: ReadonlyArray<CcAllRow>): boolean {
  return rows.length > 0 && rows.every(r => r.reasons.includes('below_cost'));
}

/** The chips a row shows. When allBelowCost the shared reason is dropped from the rows (it is in the top band). */
export function rowChips(row: CcAllRow, minPayChip: number, dropBelowCost: boolean): string[] {
  // The price gap is shown by its colour in its own column, so it gets no chip.
  return row.reasons
    .filter(x => x !== 'wide' && !(dropBelowCost && x === 'below_cost'))
    .map(x => (x === 'pays_under' ? `Pays under $${ccEffectiveMinPay(minPayChip)}` : CC_ALL_REASON_TEXT[x]));
}

/** Balanced goal (CC_GOALS.balanced): keep-shares chance 65 to 80%. The balanced pick is the PICK closest to the middle of that. */
export const CC_BALANCED_POP = { lo: 65, hi: 80 } as const;

/** The strike of the balanced pick, or null. Only a pick can be one, so a below-cost or waiting-on-RSI chain has none. */
export function balancedPickStrike(rows: ReadonlyArray<CcAllRow>): number | null {
  const mid = (CC_BALANCED_POP.lo + CC_BALANCED_POP.hi) / 2;
  const pool = rows.filter(r => r.isPick && r.popPct !== null && r.popPct >= CC_BALANCED_POP.lo && r.popPct <= CC_BALANCED_POP.hi);
  if (pool.length === 0) return null;
  const best = pool.reduce((b, r) => {
    const db = Math.abs((b.popPct as number) - mid), dr = Math.abs((r.popPct as number) - mid);
    if (dr !== db) return dr < db ? r : b;
    return (r.collect ?? 0) > (b.collect ?? 0) ? r : b;
  }, pool[0]);
  return best.strike;
}

export type CcAllSortKey = 'strike' | 'premium' | 'above' | 'keep' | 'gap' | 'oi';

/** A sorted copy. A missing value always sorts last, whichever way the column goes; ties fall back to strike. */
export function sortCcAllRows(rows: ReadonlyArray<CcAllRow>, key: CcAllSortKey, dir: 'asc' | 'desc'): CcAllRow[] {
  const val = (r: CcAllRow): number | null => key === 'strike' ? r.strike : key === 'premium' ? r.timeValue : key === 'above' ? r.abovePricePct : key === 'keep' ? r.popPct : key === 'gap' ? r.gapCents : r.openInterest;
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x === null && y === null) return a.strike - b.strike;
    if (x === null) return 1;
    if (y === null) return -1;
    return x !== y ? (x - y) * sign : a.strike - b.strike;
  });
}
