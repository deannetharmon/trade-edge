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

export interface ScenarioColumn {
  price: number;
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

const PUT_FACTORS = [1, 0.9, 0.75, 0.65, 0.55, 0.4];
const CALL_FACTORS = [1, 1.1, 1.25, 1.35, 1.45, 1.6];

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

  const factors = e.right === 'P' ? PUT_FACTORS : CALL_FACTORS;
  const scenarios: ScenarioColumn[] = factors.map((f, idx) => {
    const price = Math.round(underlying * f * 100) / 100;
    const wing = selected ? wingTotalFromToday(long, { strike: selected.strike, bid: selected.bid }, wingQuantity, price) : null;
    return {
      price,
      label: idx === 0 ? 'now' : `${f > 1 ? '+' : '−'}${Math.round(Math.abs(f - 1) * 100)}%`,
      hold: holdAtExpiry(long, price),
      wing,
      wingVsPaid: wing == null ? null : pnlFromEntry(long, wing),
    };
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
