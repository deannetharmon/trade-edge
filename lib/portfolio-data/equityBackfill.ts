// lib/portfolio-data/equityBackfill.ts

// SPARKLINES-0001D (Dean, 2026-11-26): the Equity and Total tile lines had only the days since stock records began (11-24).
// This rebuilds each held stock's past daily P/L from facts that exist: the broker's stock fills (dates, shares, prices) and
// daily closes. Pure helpers, no I/O. Nothing is guessed:
//  * a stock bought inside the window is replayed from its fills (average cost); if the replay does not end at the shares held
//    now (a lot from before the window, a transfer), that stock is skipped rather than drawn wrong;
//  * a stock with no fills in the window was held throughout (e.g. SNDK): shares stay at today's count and the cost is
//    anchored to today's own P/L, so the line ends where the tile's number is;
//  * splits are not trades (closes are split-adjusted), weekends and days with no close are dropped, today is never written
//    (the live number is drawn instead).

import { isWeekend } from './nlvSparkline';

export interface BrokerTx {
  'instrument-type'?: string;
  symbol?: string;
  'transaction-sub-type'?: string;
  action?: string;
  quantity?: string | number;
  price?: string | number | null;
  'executed-at'?: string;
}

export interface StockFill { date: string; qty: number; price: number }
export interface PnlDay { date: string; pnl: number }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Signed fills (buy +, sell -) for one stock from the broker's transactions. Splits and anything without a price are left out. */
export function stockFills(transactions: readonly BrokerTx[], symbol: string): StockFill[] {
  const out: StockFill[] = [];
  for (const t of transactions) {
    if (t['instrument-type'] !== 'Equity' || t.symbol !== symbol) continue;
    if (/split/i.test(t['transaction-sub-type'] ?? '')) continue;
    const action = t.action ?? '';
    const sign = /^buy/i.test(action) ? 1 : /^sell/i.test(action) ? -1 : 0;
    const q = num(t.quantity);
    const price = num(t.price);
    const date = (t['executed-at'] ?? '').slice(0, 10);
    if (sign === 0 || q == null || q <= 0 || price == null || price <= 0 || !DATE.test(date)) continue;
    out.push({ date, qty: sign * q, price });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** closes: date -> daily close (split-adjusted). from/todayNy bound the days returned; todayNy itself is excluded. */
export function backfillStockPnl(args: {
  fills: readonly StockFill[];
  closes: ReadonlyMap<string, number>;
  sharesNow: number;
  pnlNow: number;
  from: string;
  todayNy: string;
}): PnlDay[] {
  const { fills, closes, sharesNow, pnlNow, from, todayNy } = args;
  if (!(sharesNow > 0) || !Number.isFinite(pnlNow) || closes.size === 0) return [];
  const days = Array.from(closes.keys()).filter(d => d >= from && d < todayNy && !isWeekend(d)).sort();
  const inWindow = fills.filter(f => f.date >= from);

  if (inWindow.length === 0) {
    // Held the whole window. Anchor the cost to today's P/L using the latest close on file.
    const lastClose = closes.get(Array.from(closes.keys()).sort().pop() as string);
    if (lastClose == null) return [];
    const cost = sharesNow * lastClose - pnlNow;
    return days.map(date => ({ date, pnl: sharesNow * (closes.get(date) as number) - cost }));
  }

  // Replay from the fills. A holding that existed before the first fill has an unknown starting lot: do not draw it.
  const replayedNow = inWindow.reduce((s, f) => s + f.qty, 0);
  if (Math.abs(replayedNow - sharesNow) > 1e-6) return [];
  const out: PnlDay[] = [];
  let shares = 0;
  let cost = 0;
  let i = 0;
  for (const date of days) {
    while (i < inWindow.length && inWindow[i].date <= date) {
      const f = inWindow[i++];
      if (f.qty > 0) { shares += f.qty; cost += f.qty * f.price; }
      else if (shares > 0) { const sold = Math.min(-f.qty, shares); cost -= cost * (sold / shares); shares -= sold; }
    }
    if (shares > 0) out.push({ date, pnl: shares * (closes.get(date) as number) - cost });
  }
  return out;
}
