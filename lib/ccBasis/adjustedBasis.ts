// lib/ccBasis/adjustedBasis.ts
//
// CC-WHEEL-0001 S5 -- cost basis after put premium, proven from the broker's own transaction history. Pure.
//
// Shares that came from put assignments cost the strike, but the trader also kept the premium from selling the put (and
// any rolls of it). This module proves, lot by lot, which assignment created each share and adds up that put's premium.
// It never guesses: if ANY lot cannot be proven, it returns a reason and the caller keeps the typed or broker basis.
//
// Proof rules (Alan): the shares still held must be exactly explained by open lots (FIFO); every open lot must come from
// ONE put assignment on the same New York day, shares = contracts x 100, priced at the strike, one-to-one; the put's chain
// (opening sale, and any roll proven by sharing one order id) must be fully inside the loaded history; the broker's own
// basis must equal the strike average (otherwise the broker has adjusted it, e.g. a wash sale, and subtracting premium
// again would count it twice).

export interface AdjustedBasisLot {
  shares: number;
  strike: number;
  /** Net premium kept per share across the put and any rolls, after fees. */
  premiumPerShare: number;
  assignedOn: string;
  putSymbol: string;
}

export type AdjustedBasisFailure =
  | 'NO_SHARES'
  | 'SHARES_NOT_EXPLAINED'
  | 'LOT_NOT_FROM_ASSIGNMENT'
  | 'ASSIGNMENT_AMBIGUOUS'
  | 'PUT_HISTORY_INCOMPLETE'
  | 'ROLL_UNPROVABLE'
  | 'BROKER_BASIS_DIFFERS'
  | 'LONG_CALL_ON_SAME_STOCK'
  | 'MULTIPLE_ACCOUNTS';

export type AdjustedBasisResult =
  | { ok: true; basis: number; strikeAverage: number; shares: number; lots: AdjustedBasisLot[] }
  | { ok: false; reason: AdjustedBasisFailure };

export interface AdjustedBasisInput {
  transactions: ReadonlyArray<Record<string, any>>;
  symbol: string;
  /** Shares the broker says are held now (one account). */
  sharesOwned: number;
  /** The broker's per-share basis; used only to detect a broker-side adjustment. */
  brokerBasis: number | null;
  /** True when a long call on the same stock is open (PMCC): the lots may not be what they seem. */
  hasLongCallOnSymbol?: boolean;
  /** True when the same symbol is held in more than one account. */
  heldInMultipleAccounts?: boolean;
}

const fail = (reason: AdjustedBasisFailure): AdjustedBasisResult => ({ ok: false, reason });
const num = (v: unknown): number => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : NaN; };
const stamp = (tx: Record<string, any>): string => String(tx['executed-at'] ?? tx['transaction-date'] ?? tx['settled-at'] ?? '');
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function dayOf(tx: Record<string, any>): string {
  const raw = stamp(tx);
  const d = new Date(raw);
  if (raw.length > 10 && !Number.isNaN(d.getTime())) {
    const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return raw.slice(0, 10);
}

function fees(tx: Record<string, any>): number {
  return ['regulatory-fees', 'clearing-fees', 'commission', 'proprietary-index-option-fees']
    .reduce((s, k) => s + (Number.isFinite(num(tx[k])) ? Math.abs(num(tx[k])) : 0), 0);
}

const sub = (tx: Record<string, any>) => String(tx['transaction-sub-type'] ?? tx.action ?? '').toLowerCase();

/** OCC symbol -> strike and option letter. Tolerates the space padding the broker uses. */
function occ(symbol: unknown): { underlying: string; type: 'P' | 'C'; strike: number } | null {
  const m = /^(.{1,6}?)\s*(\d{6})([CP])(\d{8})$/.exec(String(symbol ?? ''));
  return m ? { underlying: m[1].trim(), type: m[3] as 'P' | 'C', strike: Number(m[4]) / 1000 } : null;
}

interface OptionTx { tx: Record<string, any>; symbol: string; qty: number; cash: number; orderId: string | null }

/** Cash from selling is positive, from buying negative, net of fees. Premium only, per transaction. */
function optionCash(tx: Record<string, any>, kind: 'sell' | 'buy'): number {
  const value = Math.abs(num(tx.value));
  const base = Number.isFinite(value) ? value : Math.abs(num(tx.price)) * Math.abs(num(tx.quantity)) * 100;
  return (kind === 'sell' ? base : -base) - fees(tx);
}

export function computeAdjustedBasis(input: AdjustedBasisInput): AdjustedBasisResult {
  const { transactions, symbol, sharesOwned, brokerBasis } = input;
  if (input.hasLongCallOnSymbol) return fail('LONG_CALL_ON_SAME_STOCK');
  if (input.heldInMultipleAccounts) return fail('MULTIPLE_ACCOUNTS');
  if (!(sharesOwned > 0)) return fail('NO_SHARES');

  // 1. Open share lots, first in first out.
  const shareTxs = transactions
    .filter(t => String(t['instrument-type'] ?? '') === 'Equity' && String(t.symbol ?? '').trim() === symbol
      && (t['transaction-type'] === 'Trade' || t['transaction-type'] === 'Receive Deliver'))
    .slice().sort((a, b) => stamp(a).localeCompare(stamp(b)));
  const lots: Array<{ remaining: number; price: number; day: string }> = [];
  for (const t of shareTxs) {
    const qty = Math.abs(num(t.quantity));
    const text = sub(t);
    const buy = /\bbuy\b/.test(text) ? true : /\bsell\b/.test(text) ? false : String(t['net-value-effect'] ?? t['value-effect'] ?? '').toLowerCase() === 'debit';
    const px = num(t.price);
    if (!(qty > 0) || !Number.isFinite(px)) return fail('SHARES_NOT_EXPLAINED');
    if (buy) { lots.push({ remaining: qty, price: px, day: dayOf(t) }); continue; }
    let left = qty;
    while (left > 0 && lots.length > 0) {
      const take = Math.min(left, lots[0].remaining);
      lots[0].remaining -= take; left -= take;
      if (lots[0].remaining <= 0) lots.shift();
    }
    if (left > 0) return fail('SHARES_NOT_EXPLAINED'); // sold shares bought before the loaded history
  }
  const open = lots.filter(l => l.remaining > 0);
  if (open.reduce((s, l) => s + l.remaining, 0) !== sharesOwned) return fail('SHARES_NOT_EXPLAINED');

  // 2. Put assignments on this stock.
  const assignments = transactions
    .filter(t => t['transaction-type'] === 'Receive Deliver' && sub(t) === 'assignment')
    .map(t => ({ tx: t, o: occ(t.symbol), day: dayOf(t), qty: Math.abs(num(t.quantity)) }))
    .filter(a => a.o && a.o.type === 'P' && a.o.underlying === symbol) as Array<{ tx: Record<string, any>; o: NonNullable<ReturnType<typeof occ>>; day: string; qty: number }>;

  // 3. Option sales and buybacks of this stock's puts, for premium and roll proof.
  const puts = (kind: 'sell' | 'buy'): OptionTx[] => transactions
    .filter(t => String(t['instrument-type'] ?? '').includes('Option') && t['transaction-type'] === 'Trade'
      && (kind === 'sell' ? sub(t) === 'sell to open' : sub(t) === 'buy to close'))
    .map(t => ({ tx: t, o: occ(t.symbol) }))
    .filter(x => x.o && x.o.type === 'P' && x.o.underlying === symbol)
    .map(x => ({ tx: x.tx, symbol: String(x.tx.symbol), qty: Math.abs(num(x.tx.quantity)), cash: optionCash(x.tx, kind), orderId: x.tx['order-id'] != null ? String(x.tx['order-id']) : null }));
  const sells = puts('sell');
  const buys = puts('buy');

  const used = new Set<number>();
  const result: AdjustedBasisLot[] = [];
  for (const lot of open) {
    const matches = assignments.filter((a, i) => !used.has(i) && a.day === lot.day && a.qty * 100 === lot.remaining && Math.abs(a.o.strike - lot.price) < 0.005);
    if (matches.length === 0) return fail('LOT_NOT_FROM_ASSIGNMENT');
    if (matches.length > 1) return fail('ASSIGNMENT_AMBIGUOUS');
    const a = matches[0];
    used.add(assignments.indexOf(a));
    // Two lots for one assignment, or one lot for two, are caught by the one-to-one share count above; lots of equal size
    // on the same day and strike are ambiguous only if there are more lots than assignments, which `used` rejects.

    // Chain: the assigned put, plus any put proven to have been rolled into it (same order id, one buy, one sell).
    const chain: string[] = [String(a.tx.symbol)];
    let cash = 0;
    for (let i = 0; i < chain.length; i++) {
      const sym = chain[i];
      const mySells = sells.filter(s => s.symbol === sym);
      const myBuys = buys.filter(s => s.symbol === sym);
      if (mySells.length === 0) return fail('PUT_HISTORY_INCOMPLETE');
      if (mySells.some(s => s.qty !== a.qty) || myBuys.some(b => b.qty !== a.qty)) return fail('PUT_HISTORY_INCOMPLETE');
      for (const s of mySells) cash += s.cash;
      for (const b of myBuys) cash += b.cash;
      // A put that was rolled INTO this one shares an order id with a buyback of its predecessor.
      for (const s of mySells) {
        if (!s.orderId) continue;
        const sameOrderBuys = buys.filter(b => b.orderId === s.orderId && b.symbol !== sym);
        if (sameOrderBuys.length === 0) continue;
        const sameOrderSells = sells.filter(x => x.orderId === s.orderId);
        if (sameOrderBuys.length > 1 || sameOrderSells.length > 1) return fail('ROLL_UNPROVABLE');
        const predecessor = sameOrderBuys[0].symbol;
        if (chain.includes(predecessor)) return fail('ROLL_UNPROVABLE');
        chain.push(predecessor);
      }
    }
    // Each predecessor's buyback is counted once above, in its own chain entry; the successor's sale is counted in its own.
    cash += -fees(a.tx);
    result.push({ shares: lot.remaining, strike: a.o.strike, premiumPerShare: round4(cash / lot.remaining), assignedOn: a.day, putSymbol: String(a.tx.symbol) });
  }

  const shares = result.reduce((s, l) => s + l.shares, 0);
  const strikeAverage = round4(result.reduce((s, l) => s + l.shares * l.strike, 0) / shares);
  if (brokerBasis === null || !(brokerBasis > 0) || Math.abs(brokerBasis - strikeAverage) > 0.01) return fail('BROKER_BASIS_DIFFERS');
  const basis = round4(result.reduce((s, l) => s + l.shares * (l.strike - l.premiumPerShare), 0) / shares);
  return { ok: true, basis, strikeAverage, shares, lots: result };
}

/** One plain sentence for the card, e.g. "after put premium from your 2 assignments". */
export function describeAdjustedBasis(r: Extract<AdjustedBasisResult, { ok: true }>): string {
  return `after put premium from your ${r.lots.length} assignment${r.lots.length === 1 ? '' : 's'}`;
}

/**
 * True when the history shows a call on this stock that was bought to open and has not been closed, expired or exercised
 * (a PMCC long call). Over-flags rather than under-flags: the adjusted basis then steps aside.
 */
export function hasOpenLongCall(transactions: ReadonlyArray<Record<string, any>>, symbol: string): boolean {
  const net = new Map<string, number>();
  for (const t of transactions) {
    const o = occ(t.symbol);
    if (!o || o.type !== 'C' || o.underlying !== symbol) continue;
    const q = Math.abs(num(t.quantity)) || 0;
    const text = sub(t);
    const key = String(t.symbol);
    if (text === 'buy to open') net.set(key, (net.get(key) ?? 0) + q);
    else if (text === 'sell to close' || (t['transaction-type'] === 'Receive Deliver' && (text === 'expiration' || text === 'exercise'))) net.set(key, (net.get(key) ?? 0) - q);
  }
  return Array.from(net.values()).some(n => n > 0);
}
