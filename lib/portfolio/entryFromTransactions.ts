// lib/portfolio/entryFromTransactions.ts
//
// STOCK-ENTRY-0001 -- the entry date and price of the shares still held, read from the broker's own transactions.
// Shares from a put assignment enter at the strike on the assignment day; shares bought outright enter at the fill price
// on the trade day. Lots are first in first out, so what remains open is exactly the shares you still hold. Pure.
//
// It never guesses: if the open lots do not add up to the shares held now (the buy is older than the loaded history, a
// transfer, a split), it returns null and the card shows nothing rather than a wrong date. A date the user typed always
// wins over this one; the caller applies that rule.

export interface EntryLot {
  shares: number;
  price: number;
  /** New York calendar day, YYYY-MM-DD. */
  day: string;
  source: 'assignment' | 'buy';
  /** For an assignment, the put's strike (same as price). */
  strike?: number;
}

export interface StockEntry {
  lots: EntryLot[];
  /** The most recent open lot: the date RSI-at-entry is measured from. */
  latest: EntryLot;
  /** Share-weighted average entry price across the open lots. */
  averagePrice: number;
}

const num = (v: unknown): number => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : NaN; };
const stamp = (tx: Record<string, any>): string => String(tx['executed-at'] ?? tx['transaction-date'] ?? tx['settled-at'] ?? '');
const sub = (tx: Record<string, any>) => String(tx['transaction-sub-type'] ?? tx.action ?? '').toLowerCase();

function dayOf(tx: Record<string, any>): string {
  const raw = stamp(tx);
  const d = new Date(raw);
  if (raw.length > 10 && !Number.isNaN(d.getTime())) {
    const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return raw.slice(0, 10);
}

function occ(symbol: unknown): { underlying: string; type: 'P' | 'C'; strike: number } | null {
  const m = /^(.{1,6}?)\s*(\d{6})([CP])(\d{8})$/.exec(String(symbol ?? ''));
  return m ? { underlying: m[1].trim(), type: m[3] as 'P' | 'C', strike: Number(m[4]) / 1000 } : null;
}

export function deriveStockEntry(input: { transactions: ReadonlyArray<Record<string, any>>; symbol: string; sharesOwned: number }): StockEntry | null {
  const { transactions, symbol, sharesOwned } = input;
  if (!(sharesOwned > 0)) return null;

  const shareTxs = transactions
    .filter(t => String(t['instrument-type'] ?? '') === 'Equity' && String(t.symbol ?? '').trim() === symbol
      && (t['transaction-type'] === 'Trade' || t['transaction-type'] === 'Receive Deliver'))
    .slice().sort((a, b) => stamp(a).localeCompare(stamp(b)));

  const putAssignments = transactions
    .filter(t => t['transaction-type'] === 'Receive Deliver' && sub(t) === 'assignment')
    .map(t => ({ o: occ(t.symbol), day: dayOf(t), qty: Math.abs(num(t.quantity)) }))
    .filter(a => a.o && a.o.type === 'P' && a.o.underlying === symbol) as Array<{ o: { strike: number }; day: string; qty: number }>;

  const lots: Array<EntryLot & { remaining: number; fromShareTx: boolean }> = [];
  for (const t of shareTxs) {
    const qty = Math.abs(num(t.quantity));
    const text = sub(t);
    const buy = /\bbuy\b/.test(text) ? true : /\bsell\b/.test(text) ? false : String(t['net-value-effect'] ?? t['value-effect'] ?? '').toLowerCase() === 'debit';
    const px = num(t.price);
    if (!(qty > 0) || !Number.isFinite(px)) return null;
    if (buy) {
      const day = dayOf(t);
      const assigned = putAssignments.some(a => a.day === day && a.qty * 100 === qty && Math.abs(a.o.strike - px) < 0.005)
        || String(t.description ?? '').toLowerCase().includes('assign');
      lots.push({ shares: qty, remaining: qty, price: px, day, source: assigned ? 'assignment' : 'buy', strike: assigned ? px : undefined, fromShareTx: true });
      continue;
    }
    let left = qty;
    while (left > 0 && lots.length > 0) {
      const take = Math.min(left, lots[0].remaining);
      lots[0].remaining -= take; left -= take;
      if (lots[0].remaining <= 0) lots.shift();
    }
    if (left > 0) return null; // sold shares bought before the loaded history
  }

  const open = lots.filter(l => l.remaining > 0);
  if (open.length === 0 || open.reduce((s, l) => s + l.remaining, 0) !== sharesOwned) return null;
  const out: EntryLot[] = open.map(l => ({ shares: l.remaining, price: l.price, day: l.day, source: l.source, ...(l.strike !== undefined ? { strike: l.strike } : {}) }));
  const latest = out.reduce((a, b) => (b.day >= a.day ? b : a));
  const averagePrice = Math.round((out.reduce((s, l) => s + l.shares * l.price, 0) / sharesOwned) * 10000) / 10000;
  return { lots: out, latest, averagePrice };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money = (n: number) => `$${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2)}`;

/** Short card text, e.g. "Assigned Nov 14 @ $27" or "Bought Aug 3 @ $28.50"; several lots: "latest of 2 lots, Assigned Nov 14 @ $27". */
export function describeStockEntry(e: StockEntry, today: string = new Date().toISOString().slice(0, 10)): string {
  const [y, m, d] = e.latest.day.split('-').map(Number);
  const when = `${MONTHS[m - 1]} ${d}${String(y) !== today.slice(0, 4) ? `, ${y}` : ''}`;
  const what = `${e.latest.source === 'assignment' ? 'Assigned' : 'Bought'} ${when} @ ${money(e.latest.price)}`;
  return e.lots.length > 1 ? `${what} (latest of ${e.lots.length} lots)` : what;
}
