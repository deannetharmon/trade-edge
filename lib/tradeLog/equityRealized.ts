// lib/tradeLog/equityRealized.ts
//
// PNL-CAL-0002: realized profit and loss on SHARES (stocks and ETFs), rebuilt from the same broker transactions the Trade Log reads.
// The Trade Log reconstructs option trades only, so a share sale never reached the P/L Calendar. This module closes that gap.
//
// Method (Alan): first-in, first-out lots per symbol, in time order. A buy adds a long lot; a sell closes the oldest long lots first and
// realizes (sale price - lot price) x shares. Short stock works the same way in reverse (a sell opens a short lot, a buy closes it).
// Fees (commission, clearing, regulatory) are allocated per share to the lots they touch and subtracted, exactly as the option side does.
// Shares received or delivered through an option assignment or exercise are ordinary buy/sell transactions at the strike, so the option's
// own P/L (premium kept) and the share P/L (sale price less strike) add up to the full result with nothing counted twice.
//
// Never fabricated: a closing transaction with no matching opening lot in the loaded window (the shares were bought before the window
// starts) is reported as unmatched and adds nothing to any total.

import type { UnmatchedClosure } from './types';

export interface EquityRealizedLot {
  id: string;
  symbol: string;
  openDate: string;  // YYYY-MM-DD of the lot's opening transaction
  closeDate: string; // YYYY-MM-DD of the closing transaction
  shares: number;
  side: 'LONG' | 'SHORT';
  openPrice: number;
  closePrice: number;
  fees: number;
  pnl: number;       // net of fees
}

export interface EquityRealizedResult {
  lots: EquityRealizedLot[];
  unmatched: UnmatchedClosure[];
}

type Tx = { [key: string]: any };

interface Lot {
  txId: string;
  date: string;
  price: number;
  remaining: number;
  feePerShare: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function timestamp(tx: Tx): string {
  return String(tx['executed-at'] ?? tx['transaction-date'] ?? tx['settled-at'] ?? '');
}

/** The transaction's calendar day in New York, the same day the broker app shows. Falls back to the date part when no time is present. */
function dayOf(tx: Tx): string {
  const raw = timestamp(tx);
  const d = new Date(raw);
  if (raw.length > 10 && !Number.isNaN(d.getTime())) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts;
  }
  return raw.slice(0, 10);
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : NaN;
}

function fees(tx: Tx): number {
  return ['regulatory-fees', 'clearing-fees', 'commission', 'proprietary-index-option-fees']
    .reduce((s, k) => s + (Number.isFinite(num(tx[k])) ? Math.abs(num(tx[k])) : 0), 0);
}

function quantity(tx: Tx): number {
  const n = Math.abs(num(tx.quantity));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Per-share price: the stated price, else the traded value divided by shares. NaN when neither is usable. */
function price(tx: Tx, qty: number): number {
  const p = num(tx.price);
  if (Number.isFinite(p) && p > 0) return p;
  const v = Math.abs(num(tx.value));
  return Number.isFinite(v) && v > 0 && qty > 0 ? v / qty : NaN;
}

/** BUY or SELL, from the action text first, then the credit/debit effect of the cash. null when the transaction does not say. */
function direction(tx: Tx): 'BUY' | 'SELL' | null {
  const text = `${tx.action ?? ''} ${tx['transaction-sub-type'] ?? ''}`.toLowerCase();
  if (/\bbuy\b/.test(text)) return 'BUY';
  if (/\bsell\b/.test(text)) return 'SELL';
  const effect = String(tx['net-value-effect'] ?? tx['value-effect'] ?? '').toLowerCase();
  if (effect === 'debit') return 'BUY';
  if (effect === 'credit') return 'SELL';
  return null;
}

/** 'OPEN' / 'CLOSE' when the action says so; null otherwise (then the position itself decides). */
function intent(tx: Tx): 'OPEN' | 'CLOSE' | null {
  const text = `${tx.action ?? ''} ${tx['transaction-sub-type'] ?? ''}`.toLowerCase();
  if (/to open/.test(text)) return 'OPEN';
  if (/to close/.test(text)) return 'CLOSE';
  return null;
}

function isShareTransaction(tx: Tx): boolean {
  return String(tx['instrument-type'] ?? '') === 'Equity'
    && (tx['transaction-type'] === 'Trade' || tx['transaction-type'] === 'Receive Deliver')
    && typeof tx.symbol === 'string' && tx.symbol.trim().length > 0;
}

export function reconstructEquityRealized(transactions: readonly Tx[]): EquityRealizedResult {
  const bySymbol = new Map<string, Tx[]>();
  for (const tx of transactions) {
    if (!isShareTransaction(tx)) continue;
    const sym = String(tx.symbol).trim();
    const list = bySymbol.get(sym) ?? [];
    list.push(tx);
    bySymbol.set(sym, list);
  }

  const lots: EquityRealizedLot[] = [];
  const unmatched: UnmatchedClosure[] = [];

  bySymbol.forEach((txs, symbol) => {
    const ordered = txs.slice().sort((a, b) => timestamp(a).localeCompare(timestamp(b)));
    const longLots: Lot[] = [];
    const shortLots: Lot[] = [];

    ordered.forEach((tx, index) => {
      const dir = direction(tx);
      const qty = quantity(tx);
      const px = price(tx, qty);
      const id = String(tx.id ?? `${symbol}-${timestamp(tx)}-${index}`);
      if (!dir || qty === 0 || !Number.isFinite(px)) {
        unmatched.push({ symbol, underlying: String(tx['underlying-symbol'] ?? symbol), executedAt: timestamp(tx), quantity: qty, transactionId: id,
          reason: 'A share transaction had no readable direction, quantity or price, so it is not in the totals.' });
        return;
      }
      const feePerShare = fees(tx) / qty;
      const wants = intent(tx);
      // A BUY closes short lots; a SELL closes long lots. The opposite book is the one this transaction can close.
      const closing = dir === 'SELL' ? longLots : shortLots;
      const opening = dir === 'SELL' ? shortLots : longLots;
      let left = qty;

      while (left > 0 && closing.length > 0) {
        const lot = closing[0];
        const take = Math.min(left, lot.remaining);
        const side: 'LONG' | 'SHORT' = dir === 'SELL' ? 'LONG' : 'SHORT';
        const gross = (side === 'LONG' ? px - lot.price : lot.price - px) * take;
        const feeTotal = (lot.feePerShare + feePerShare) * take;
        lots.push({ id: `${lot.txId}>${id}`, symbol, openDate: lot.date, closeDate: dayOf(tx), shares: take, side, openPrice: lot.price, closePrice: px,
          fees: round2(feeTotal), pnl: round2(gross - feeTotal) });
        lot.remaining -= take;
        left -= take;
        if (lot.remaining <= 0) closing.shift();
      }

      if (left > 0) {
        if (wants === 'CLOSE') {
          // The broker says this closes a position, but no opening lot is in the loaded window: never guess a cost basis.
          unmatched.push({ symbol, underlying: String(tx['underlying-symbol'] ?? symbol), executedAt: timestamp(tx), quantity: left, transactionId: id,
            reason: `${left} share${left === 1 ? '' : 's'} closed with no opening purchase in the loaded history, so the cost basis is unknown.` });
        } else if (dir === 'SELL' && wants == null) {
          // An unlabeled sale with no lots could be closing shares bought before the window or opening a short: do not guess.
          unmatched.push({ symbol, underlying: String(tx['underlying-symbol'] ?? symbol), executedAt: timestamp(tx), quantity: left, transactionId: id,
            reason: `${left} share${left === 1 ? '' : 's'} sold with no opening purchase in the loaded history, so the cost basis is unknown.` });
        } else {
          opening.push({ txId: id, date: dayOf(tx), price: px, remaining: left, feePerShare });
        }
      }
    });
  });

  lots.sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.symbol.localeCompare(b.symbol));
  return { lots, unmatched };
}
