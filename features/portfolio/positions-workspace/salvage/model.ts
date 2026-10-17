// features/portfolio/positions-workspace/salvage/model.ts
//
// SALVAGE-0001 slice C -- view model for the Salvage panel. Pure.

import type { Position } from '@/lib/portfolio-data/types';
import {
  buildWingRows,
  earningsBeforeExpiry,
  isStaleQuote,
  isWideMarket,
  type ChainQuote,
  type WingRow,
} from '@/lib/salvage/salvageCandidates';
import type { EligibleSalvage } from '@/lib/salvage/salvageEligibility';
import {
  closeNowCash,
  holdAtExpiry,
  pnlFromEntry,
  wingTotalFromToday,
  type LongLeg,
} from '@/lib/salvage/salvageMath';

export type ObjectiveKind = 'most' | 'amount' | 'debit';
export type RankBy = 'most' | 'credit' | 'easiest';

export type ScenarioKind = 'now' | 'strike' | 'target' | 'wing' | 'deep';

export interface ScenarioColumn {
  price: number;
  kind: ScenarioKind;
  label: string;
  hold: number;
  wing: number | null;
  wingVsPaid: number | null;
}

export interface SalvageViewModel {
  unavailable: string | null;
  long: LongLeg | null;
  closeNow: number | null;
  rows: WingRow[];
  selected: WingRow | null;
  scenarios: ScenarioColumn[];
  earnings: { before: boolean; daysAway: number | null; date: string | null };
  longQuoteStale: boolean;
  longWide: boolean;
  /** Dollar target the verdict column is measured against. */
  target: number;
}

export interface SalvageInputs {
  eligible: EligibleSalvage;
  position: Position;
  quotes: ChainQuote[] | null;
  nowMs: number;
  todayYmd: string;
  objective: ObjectiveKind;
  amount: number | null;
  rankBy: RankBy;
  wingQuantity: number;
  selectedStrike: number | null;
}

/** Far-past-the-wing price: 60% away from today (down for puts, up for calls). */
const DEEP_FACTOR = { P: 0.4, C: 1.6 } as const;

function rank(rows: WingRow[], by: RankBy, right: 'P' | 'C'): WingRow[] {
  const copy = [...rows];
  const needed = (r: WingRow) => {
    const req = r.objective?.required;
    return req && 'price' in req ? req.price : null;
  };
  if (by === 'credit') copy.sort((a, b) => b.creditNet - a.creditNet);
  else if (by === 'most') copy.sort((a, b) => b.maxFromToday - a.maxFromToday);
  else {
    // Easiest to reach: the price needed is closest to where the stock is now
    // (puts: highest price; calls: lowest). Rows that cannot meet the target go last.
    copy.sort((a, b) => {
      const pa = needed(a), pb = needed(b);
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return right === 'P' ? pb - pa : pa - pb;
    });
  }
  return copy;
}

export function buildSalvageViewModel(i: SalvageInputs): SalvageViewModel {
  const e = i.eligible;
  const empty = (unavailable: string): SalvageViewModel => ({
    unavailable, long: null, closeNow: null, rows: [], selected: null, scenarios: [],
    earnings: { before: false, daysAway: null, date: null }, longQuoteStale: false, longWide: false, target: e.entryDebit,
  });
  if (!i.quotes || i.quotes.length === 0) return empty('The option chain did not load.');
  const own = i.quotes.find((q) => q.right === e.right && q.strike === e.strike);
  if (!own || own.bid == null) return empty('No live bid for your option.');
  const underlying = i.position.stockPrice;
  if (underlying == null || !(underlying > 0)) return empty('No current price for the underlying.');

  const long: LongLeg = { right: e.right, strike: e.strike, quantity: e.quantity, bid: own.bid, entryDebit: e.entryDebit };
  const target = i.objective === 'amount' && i.amount != null && i.amount > 0 ? i.amount : e.entryDebit;
  const wingQuantity = Math.max(1, Math.min(e.quantity, Math.floor(i.wingQuantity) || 1));
  const rows = rank(
    buildWingRows(i.quotes, { long, wingQuantity, nowMs: i.nowMs, targetDollars: target }),
    i.rankBy,
    e.right,
  );
  const selected = rows.find((r) => r.strike === i.selectedStrike) ?? rows[0] ?? null;

  // Anchors that mean something for THIS position (Ian, 2026-10-16), not round percentages.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const req = selected?.objective?.required;
  const anchors: Array<{ price: number; kind: ScenarioKind; label: string }> = [
    { price: r2(underlying), kind: 'now', label: 'now' },
    { price: e.strike, kind: 'strike', label: 'your strike' },
  ];
  if (req && 'price' in req) anchors.push({ price: req.price, kind: 'target', label: 'reaches your target' });
  if (selected) anchors.push({ price: selected.strike, kind: 'wing', label: 'wing strike' });
  anchors.push({ price: r2(underlying * DEEP_FACTOR[e.right]), kind: 'deep', label: e.right === 'P' ? '−60%' : '+60%' });
  // Nearest-to-today first; drop an anchor that lands on the same price as one already kept.
  anchors.sort((a, b) => (e.right === 'P' ? b.price - a.price : a.price - b.price));
  const scenarios: ScenarioColumn[] = anchors
    .filter((a, k, arr) => arr.findIndex((o) => Math.abs(o.price - a.price) < 0.005) === k)
    .map((a) => {
      const wing = selected ? wingTotalFromToday(long, { strike: selected.strike, bid: selected.bid }, wingQuantity, a.price) : null;
      return { price: a.price, kind: a.kind, label: a.label, hold: holdAtExpiry(long, a.price), wing, wingVsPaid: wing == null ? null : pnlFromEntry(long, wing) };
    });
  return {
    unavailable: null,
    long,
    closeNow: closeNowCash(long),
    rows,
    selected,
    scenarios,
    earnings: { ...earningsBeforeExpiry(i.position.nextEarningsDate ?? null, e.expDate, i.todayYmd), date: i.position.nextEarningsDate ?? null },
    longQuoteStale: isStaleQuote(own.asOfMs, i.nowMs),
    longWide: isWideMarket(own.bid, own.ask),
    target,
  };
}
