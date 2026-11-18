// lib/trademap/optimize.ts
//
// SUPERSEDED for the Optimize button by lib/trademap/optimizeRank.ts (S5b, 2026-11-18): the button runs the screener's RANKED scan,
// which is what produces the screener's Best opportunity. This per-width finder wrapper is kept for candidateToMap and its tests.
//
// OPTMAP-0001 S5 (Dean, Ian, Alan, Quinn, 2026-11-17): "Optimize" shows the SCREENER'S OWN pick for the symbol, never a
// second ranking. It maps the Trade Map's quotes into the screener's leg format and calls the screener's finders
// (trySpreadAtWidth, findBestSpread) with the trader's saved scan criteria. No scoring or qualification lives here.
// Bull put and bear call spreads only (the condor's call side is not a free choice on the map yet).
//
// Fail closed: a strike without a complete two-sided quote, a delta and open interest is left out, because the
// screener's own checks would read a missing number as zero.

import { symbolKey, type ChainExpiration, type OptionQuote } from './chain';
import type { RulesType } from '@/lib/scans/constants';
import type { SpreadCandidate } from '@/lib/scans/types';
import { findBestSpread, trySpreadAtWidth } from '@/lib/scans/spread-finder';
import { getWidthSteps, normalizeIv } from '@/lib/scans/scan-utils';

export type OptimizeStrategy = 'bps' | 'bcs';

export interface ScreenerLeg {
  expirationDate: string;
  optionType: 'P' | 'C';
  strikePrice: number;
  delta: number;
  bid: number;
  ask: number;
  mid: number;
  openInterest: number;
  iv: number | null;
  occSymbol: string;
  fetchedAt: number;
}

const rightOf = (s: OptimizeStrategy): 'P' | 'C' => (s === 'bps' ? 'P' : 'C');
const screenerName = (s: OptimizeStrategy): 'BPS' | 'BCS' => (s === 'bps' ? 'BPS' : 'BCS');

/** The expiration's strikes on one side as the screener's leg objects; strikes without a complete quote are left out. */
export function toScreenerLegs(exp: ChainExpiration, quotes: Record<string, OptionQuote>, strategy: OptimizeStrategy): ScreenerLeg[] {
  const right = rightOf(strategy);
  const out: ScreenerLeg[] = [];
  for (const row of exp.strikes) {
    const sym = right === 'P' ? row.put : row.call;
    if (!sym) continue;
    const q = quotes[symbolKey(sym)];
    if (!q || q.bid == null || q.ask == null || q.mid == null || q.delta == null || q.openInterest == null) continue;
    if (q.bid < 0 || q.ask < q.bid) continue;
    out.push({
      expirationDate: exp.date, optionType: right, strikePrice: row.strike, delta: q.delta, bid: q.bid, ask: q.ask, mid: q.mid,
      openInterest: q.openInterest, iv: q.iv, occSymbol: sym, fetchedAt: q.updatedAtMs ?? 0,
    });
  }
  return out;
}

export interface OptimizeInput {
  strategy: OptimizeStrategy;
  exp: ChainExpiration;
  quotes: Record<string, OptionQuote>;
  price: number;
  /** Expiration IV as a fraction (1.84 = 184%), as the screener passes it to its POP model. */
  expirationIv: number | null;
  rules: RulesType;
  /** The trader's width in dollars; null searches every width the screener searches. */
  widthDollars: number | null;
}

export interface OptimizeResult {
  /** The screener's pick at the trader's width (or at any width when none was set); null when nothing qualifies. */
  pick: SpreadCandidate | null;
  /** The screener's best at each width it searches, best first (the screener's own order). */
  atEachWidth: SpreadCandidate[];
  /** True when the strikes have no usable quotes at all. */
  noQuotes: boolean;
}

export function runOptimize(i: OptimizeInput): OptimizeResult {
  const legs = toScreenerLegs(i.exp, i.quotes, i.strategy);
  if (legs.length === 0) return { pick: null, atEachWidth: [], noQuotes: true };
  const name = screenerName(i.strategy);
  const ivPct = normalizeIv(i.expirationIv);
  const atEachWidth: SpreadCandidate[] = [];
  for (const width of getWidthSteps(i.rules.MAX_SPREAD_WIDTH, i.price)) {
    const c = trySpreadAtWidth(legs, name, i.exp.date, width, i.price, i.rules, ivPct);
    if (c) atEachWidth.push(c);
  }
  // The screener's own ordering: best POP, ROC as the tiebreaker within 5 points of POP.
  atEachWidth.sort((a, b) => {
    const popDiff = (b.pop ?? 0) - (a.pop ?? 0);
    return Math.abs(popDiff) >= 5 ? popDiff : b.roc - a.roc;
  });
  const pick = i.widthDollars != null
    ? trySpreadAtWidth(legs, name, i.exp.date, i.widthDollars, i.price, i.rules, ivPct)
    : findBestSpread(legs, name, i.exp.date, i.price, i.rules, ivPct);
  return { pick, atEachWidth, noQuotes: false };
}

/** The anchor strike and width in listed strikes that load a candidate into the map; null when a strike is not listed. */
export function candidateToMap(c: SpreadCandidate, exp: ChainExpiration): { anchor: number; widthSteps: number } | null {
  const strikes = exp.strikes.map(s => s.strike);
  const a = strikes.indexOf(c.shortStrike);
  const l = strikes.indexOf(c.longStrike);
  if (a < 0 || l < 0 || a === l) return null;
  return { anchor: c.shortStrike, widthSteps: Math.abs(a - l) };
}
