// lib/tradeLog/reconstructTrades.ts
//
// PI-0008E: Closed Trade Integrity.
//
// Single shared implementation of Trade Log's closed-position reconstruction.
// Previously app/trade-log/page.tsx and app/performance/page.tsx each held
// their own independent copy of this logic, and had already drifted (see
// PI-0008D's audit): performance/page.tsx matched on a `tx.action` field that
// TastyTrade's transactions endpoint does not return (so its own
// reconstruction silently matched nothing), it computed dteAtClose without
// the UTC-noon offset trade-log used (a timezone off-by-one-day risk), and
// its cache had no version field at all so a schema change could never
// invalidate stale entries. This module fixes all three by construction
// (there is now exactly one implementation), which is the "unless an
// existing bug is corrected" case called out in the PI-0008E ticket.
//
import { refreshBrowserAccessToken } from '@/lib/tastytrade/browser-token';
import { requireActiveBrokerAccount } from '@/lib/tastytrade/accountSelection';
// PI-0008E also closes two silent-data-loss gaps identified in PI-0008D:
//   - Partial closes: the old code required exact quantity equality between
//     an opening and closing transaction, so a partial close (different
//     contract count) never matched anything and the whole lot vanished from
//     Trade Log. This module does FIFO lot matching so any number of
//     closing transactions against a single open lot are supported, with
//     credit/debit and fees allocated proportionally per contract.
//   - Assignment / exercise: the old code only recognized Buy/Sell to Close
//     transactions, so an assigned or exercised leg had no matching "close"
//     and was silently dropped. This module recognizes TastyTrade's
//     `Receive Deliver` transaction type (sub-types Assignment / Exercise /
//     Expiration) as closure events.
//
// Scope boundary (do not extend without a new ticket): this module
// reconstructs the OPTION LEG's own realized economics only. An assignment
// or exercise transfers the position into a stock position (or removes
// shares); this module does not track that stock position's subsequent cost
// basis or eventual sale P&L. That is a distinct, prospective gap --
// PI-0008D section 3 calls it out as "assignment lifecycle linkage."
//
// Both app/trade-log/page.tsx and app/performance/page.tsx import from this
// file rather than defining their own copies.

import { ExitType, classifyExit } from '@/lib/classifyExit';
import type {
  TimeRange,
  Outcome,
  ClosedTrade,
  CacheEntry,
  ClosureMechanism,
  ReconstructionStatus,
  UnmatchedClosure,
  ReconstructionResult,
} from './types';

export type {
  TimeRange,
  Outcome,
  ClosedTrade,
  CacheEntry,
  ClosureMechanism,
  ReconstructionStatus,
  UnmatchedClosure,
  ReconstructionResult,
} from './types';

// ── Constants ────────────────────────────────────────────────────────────
export const BASE      = 'https://api.tastytrade.com';
export const CLIENT_ID = '4d4c851b-bdaf-4ac9-b39b-811e604739f2';
export const LS_DEVICE = 'hunter-device-id';
export const LS_TL_1W  = 'hunter-tradelog-1w';
export const LS_TL_2W  = 'hunter-tradelog-2w';
export const LS_TL_1M  = 'hunter-tradelog-1m';
export const LS_TL_3M  = 'hunter-tradelog-3m';
export const LS_TL_6M  = 'hunter-tradelog-6m';
export const LS_TL_12M = 'hunter-tradelog-12m';

// PI-0008E: bumped from trade-log's previous 'v3'. ClosedTrade gained new
// required fields (reconstructionStatus, closureMechanism, openedQuantity,
// closedQuantity, remainingQuantity, sourceTransactionIds) and the `id`
// format gained a closeDate suffix (needed so multiple partial-close
// tranches of the same spread get distinct ids -- see note in
// buildClosedTradeId below). Stale caches from before this sprint must not
// be read back as if they matched the new shape.
export const CACHE_VERSION = 'v4';

export const LS_KEY: Record<TimeRange, string> = {
  '1w': LS_TL_1W, '2w': LS_TL_2W, '1m': LS_TL_1M, '3m': LS_TL_3M, '6m': LS_TL_6M, '12m': LS_TL_12M,
};

// ── Auth / network (browser-only; byte-identical to the pre-PI-0008E copies
//    other than living in one place now) ──────────────────────────────────
export async function getAccessToken(): Promise<string> {
  const cached = sessionStorage.getItem('tt_access_token');
  if (cached) return cached;
  let token: string;
  try { token = await refreshBrowserAccessToken(); }
  catch { sessionStorage.removeItem('tt_access_token'); window.location.href = '/login'; throw new Error('Session expired'); }
  sessionStorage.setItem('tt_access_token', token);
  return token;
}

export async function ttFetch(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
  if (res.status === 401) { sessionStorage.removeItem('tt_access_token'); window.location.href = '/login'; throw new Error('Session expired'); }
  if (!res.ok) { const text = await res.text(); throw new Error(`${path} failed (${res.status}): ${text.slice(0, 120)}`); }
  return res.json();
}

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(LS_DEVICE);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(LS_DEVICE, id); }
    return id;
  } catch { return 'unknown'; }
}

export function readCache(range: TimeRange): CacheEntry | null {
  try {
    const raw = localStorage.getItem(LS_KEY[range]);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry & { version?: string };
    if (parsed.version !== CACHE_VERSION) return null; // stale schema
    return parsed;
  } catch { return null; }
}

export function writeCache(range: TimeRange, trades: ClosedTrade[]) {
  try {
    const entry: CacheEntry = { trades, fetchedAt: Date.now(), deviceId: getDeviceId(), range, version: CACHE_VERSION };
    localStorage.setItem(LS_KEY[range], JSON.stringify(entry));
  } catch {}
}

export function rangeStartDate(range: TimeRange): string {
  const d = new Date();
  if      (range === '1w')  d.setDate(d.getDate() - 7);
  else if (range === '2w')  d.setDate(d.getDate() - 14);
  else if (range === '1m')  d.setMonth(d.getMonth() - 1);
  else if (range === '3m')  d.setMonth(d.getMonth() - 3);
  else if (range === '6m')  d.setMonth(d.getMonth() - 6);
  else                      d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().split('T')[0];
}

// ── Symbol parsing ─────────────────────────────────────────────────────────
export function parseOccSymbol(occ: string): { symbol: string; expiry: string; optionType: 'P' | 'C' | null; strike: number } {
  const cleaned = occ.replace(/\s+/g, '');
  const m = cleaned.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!m) return { symbol: occ, expiry: '', optionType: null, strike: 0 };
  const y = '20' + m[2].slice(0, 2), mo = m[2].slice(2, 4), d = m[2].slice(4, 6);
  return { symbol: m[1], expiry: `${y}-${mo}-${d}`, optionType: m[3] as 'P' | 'C', strike: parseInt(m[4], 10) / 1000 };
}

// ── Raw transaction shape ──────────────────────────────────────────────────
// TastyTrade's transaction fields are hyphenated (not valid TS identifiers),
// and the exact set of fields present varies by transaction-type, so this is
// deliberately loose rather than a fully-typed interface.
export interface RawTransaction {
  [key: string]: any;
}

function txTimestamp(tx: RawTransaction): string {
  return tx['executed-at'] ?? tx['transaction-date'] ?? tx['settled-at'] ?? '';
}
function txFees(tx: RawTransaction): number {
  return ['regulatory-fees', 'clearing-fees', 'commission'].reduce(
    (s, k) => s + Math.abs(parseFloat(tx[k] ?? '0') || 0), 0,
  );
}
function txQuantity(tx: RawTransaction): number {
  const n = Math.abs(parseFloat(tx.quantity ?? '1'));
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function txPrice(tx: RawTransaction): number {
  const n = parseFloat(tx.price ?? '0');
  return Number.isFinite(n) ? Math.abs(n) : 0;
}
function txIsPriceMalformed(tx: RawTransaction): boolean {
  if (tx.price == null) return false; // absent price (e.g. assignment) is expected, not malformed
  return Number.isNaN(parseFloat(tx.price));
}
function txId(tx: RawTransaction): string {
  return String(tx.id ?? `${tx.symbol ?? ''}-${txTimestamp(tx)}-${tx.quantity ?? ''}-${tx['transaction-sub-type'] ?? ''}`);
}

// ── Step 1: FIFO lot matching per option OCC symbol ───────────────────────
// A "fill" is the portion of one open transaction closed by one closure
// event (close / assignment / exercise / expiration). Allowing multiple
// fills per open transaction -- and multiple closure events consuming a
// single open lot in sequence -- is what makes partial closes work; the
// pre-PI-0008E code required whole-quantity equality between exactly one
// open and one close transaction and dropped everything else.

interface OpenLot {
  tx: RawTransaction;
  remaining: number;
  original: number;
}

interface Fill {
  underlying: string;
  expiry: string;
  optionType: 'P' | 'C';
  strike: number;
  openDay: string;        // YYYY-MM-DD of the open transaction
  openExecutedAt: string; // full timestamp of the open transaction
  closeDate: string;      // YYYY-MM-DD of the closure event
  qty: number;            // contracts allocated to this fill
  isShort: boolean;
  openPricePerContract: number;
  closePricePerContract: number; // 0 for ASSIGNED / EXERCISED / EXPIRED
  openFeeAllocated: number;
  closeFeeAllocated: number;
  closureMechanism: ClosureMechanism;
  openedQuantity: number;         // original quantity of the open lot this fill came from
  remainingOnLotAfter: number;    // contracts still open on that lot after this fill
  sourceTransactionIds: string[]; // [openTxId, closeTxId]
  malformed: boolean;             // true if price data could not be parsed as a number
}

function buildFills(transactions: RawTransaction[]): { fills: Fill[]; unmatched: UnmatchedClosure[] } {
  const optionTx = transactions.filter(
    tx => (tx['transaction-type'] === 'Trade' || tx['transaction-type'] === 'Receive Deliver')
      && tx.symbol && parseOccSymbol(tx.symbol).optionType !== null,
  );

  const bySymbol: Record<string, RawTransaction[]> = {};
  for (const tx of optionTx) {
    const sym = tx.symbol.replace(/\s+/g, '');
    (bySymbol[sym] ??= []).push(tx);
  }

  const fills: Fill[] = [];
  const unmatched: UnmatchedClosure[] = [];

  for (const [sym, txList] of Object.entries(bySymbol)) {
    const parsed = parseOccSymbol(sym);
    if (!parsed.optionType) continue;

    const opens: OpenLot[] = txList
      .filter(tx => tx['transaction-sub-type'] === 'Sell to Open' || tx['transaction-sub-type'] === 'Buy to Open')
      .sort((a, b) => txTimestamp(a).localeCompare(txTimestamp(b)))
      .map(tx => ({ tx, remaining: txQuantity(tx), original: txQuantity(tx) }));

    type ClosureEvent = { tx: RawTransaction; qty: number; kind: ClosureMechanism };
    const closureEvents: ClosureEvent[] = [
      ...txList
        .filter(tx => tx['transaction-sub-type'] === 'Buy to Close' || tx['transaction-sub-type'] === 'Sell to Close')
        .map(tx => ({ tx, qty: txQuantity(tx), kind: 'CLOSED' as ClosureMechanism })),
      ...txList
        .filter(tx => tx['transaction-type'] === 'Receive Deliver' && tx['transaction-sub-type'] === 'Assignment')
        .map(tx => ({ tx, qty: txQuantity(tx), kind: 'ASSIGNED' as ClosureMechanism })),
      ...txList
        .filter(tx => tx['transaction-type'] === 'Receive Deliver' && tx['transaction-sub-type'] === 'Exercise')
        .map(tx => ({ tx, qty: txQuantity(tx), kind: 'EXERCISED' as ClosureMechanism })),
      ...txList
        .filter(tx => tx['transaction-type'] === 'Receive Deliver' && tx['transaction-sub-type'] === 'Expiration')
        .map(tx => ({ tx, qty: txQuantity(tx), kind: 'EXPIRED' as ClosureMechanism })),
    ].sort((a, b) => txTimestamp(a.tx).localeCompare(txTimestamp(b.tx)));

    for (const event of closureEvents) {
      let remainingToAllocate = event.qty;
      const eventIsCloseTrade = event.kind === 'CLOSED';
      // Assignment / exercise / expiration settle the option at no cash
      // price -- the option's value passed through via the resulting stock
      // position (assignment/exercise) or simply expired (expiration).
      // This is the correct economic model, not a placeholder.
      const closePricePerContract = eventIsCloseTrade ? txPrice(event.tx) : 0;
      const eventTotalFees = txFees(event.tx);
      const eventQtyForFeeAlloc = event.qty || 1;
      const eventPriceMalformed = eventIsCloseTrade && txIsPriceMalformed(event.tx);

      while (remainingToAllocate > 0) {
        const lot = opens.find(o => o.remaining > 0 && txTimestamp(o.tx) < txTimestamp(event.tx));
        if (!lot) {
          unmatched.push({
            symbol: sym,
            underlying: event.tx['underlying-symbol'] ?? parsed.symbol,
            executedAt: txTimestamp(event.tx),
            quantity: remainingToAllocate,
            transactionId: txId(event.tx),
            reason: 'No open lot available within the fetched window (the position likely opened before the lookback start date).',
          });
          remainingToAllocate = 0;
          break;
        }

        const fillQty = Math.min(lot.remaining, remainingToAllocate);
        lot.remaining -= fillQty;
        remainingToAllocate -= fillQty;

        const openPrice = txPrice(lot.tx);
        const openFees = txFees(lot.tx);
        const isShort = lot.tx['transaction-sub-type'] === 'Sell to Open';
        const openPriceMalformed = txIsPriceMalformed(lot.tx);

        fills.push({
          underlying: lot.tx['underlying-symbol'] ?? parsed.symbol,
          expiry: parsed.expiry,
          optionType: parsed.optionType,
          strike: parsed.strike,
          openDay: txTimestamp(lot.tx).slice(0, 10),
          openExecutedAt: txTimestamp(lot.tx),
          closeDate: txTimestamp(event.tx).slice(0, 10),
          qty: fillQty,
          isShort,
          openPricePerContract: openPrice,
          closePricePerContract,
          openFeeAllocated: openFees * (fillQty / lot.original),
          closeFeeAllocated: eventTotalFees * (fillQty / eventQtyForFeeAlloc),
          closureMechanism: event.kind,
          openedQuantity: lot.original,
          remainingOnLotAfter: lot.remaining,
          sourceTransactionIds: [txId(lot.tx), txId(event.tx)],
          malformed: openPriceMalformed || eventPriceMalformed,
        });
      }
    }
  }

  return { fills, unmatched };
}

// ── Step 2: group fills into ClosedTrade rows ─────────────────────────────
// Fills are grouped by underlying + expiry + open day + close date -- the
// same underlying/expiry/open-day grouping the old code used to assemble a
// multi-leg spread, plus close date so that separate partial-close tranches
// of the same spread (closed on different days) become separate rows rather
// than being merged or silently overwriting each other.

function buildClosedTradeId(underlying: string, openDay: string, expiry: string, closeDate: string): string {
  // PI-0008E: closeDate is appended so multiple tranches of the same spread
  // get distinct ids. Known consequence: this changes the id format from
  // the pre-PI-0008E `${underlying}-${openDay}-${expiry}`, so any
  // previously-persisted per-trade "excluded" toggle (keyed by id in
  // app/trade-log/page.tsx's localStorage set) will not match after this
  // change and will reset to included. This is a one-time UI preference
  // reset, not a data-loss issue, and is called out in the ticket's final
  // report.
  return `${underlying}-${openDay}-${expiry}-${closeDate}`;
}

function computeEntryTime(earliestOpenExecutedAt: string): { openTime: string; openDow: number } {
  if (!earliestOpenExecutedAt) return { openTime: '', openDow: -1 };
  try {
    const etStr = new Date(earliestOpenExecutedAt).toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDt = new Date(etStr);
    return {
      openTime: `${String(etDt.getHours()).padStart(2, '0')}:${String(etDt.getMinutes()).padStart(2, '0')}`,
      openDow: etDt.getDay(),
    };
  } catch {
    const fb = new Date(earliestOpenExecutedAt);
    return {
      openTime: `${String(fb.getHours()).padStart(2, '0')}:${String(fb.getMinutes()).padStart(2, '0')}`,
      openDow: fb.getDay(),
    };
  }
}

function groupFillsIntoTrades(fills: Fill[]): ClosedTrade[] {
  const groups: Record<string, Fill[]> = {};
  for (const f of fills) {
    const key = `${f.underlying}::${f.expiry}::${f.openDay}::${f.closeDate}`;
    (groups[key] ??= []).push(f);
  }

  const trades: ClosedTrade[] = [];

  for (const [key, groupFills] of Object.entries(groups)) {
    const [underlying, expiry, openDay, closeDate] = key.split('::');

    const legKey = (f: Fill) => `${f.strike}${f.optionType}`;
    const putFills  = groupFills.filter(f => f.optionType === 'P');
    const callFills = groupFills.filter(f => f.optionType === 'C');
    const putLegCount  = new Set(putFills.map(legKey)).size;
    const callLegCount = new Set(callFills.map(legKey)).size;

    let strategy: ClosedTrade['strategy'] = 'SPREAD';
    if (putLegCount >= 2 && callLegCount === 0) strategy = 'BPS';
    else if (callLegCount >= 2 && putLegCount === 0) strategy = 'BCS';
    else if (putLegCount >= 2 && callLegCount >= 2) strategy = 'IC';
    else if (groupFills.length > 0) strategy = 'OTHER';

    const sortedPuts  = Array.from(new Set(putFills.map(f => f.strike))).sort((a, b) => b - a);
    const sortedCalls = Array.from(new Set(callFills.map(f => f.strike))).sort((a, b) => a - b);
    let strikes = '';
    if (strategy === 'BPS' && sortedPuts.length >= 2) strikes = `${sortedPuts[0]}P/${sortedPuts[1]}P`;
    else if (strategy === 'BCS' && sortedCalls.length >= 2) strikes = `${sortedCalls[0]}C/${sortedCalls[1]}C`;
    else if (strategy === 'IC' && sortedPuts.length >= 2 && sortedCalls.length >= 2) strikes = `${sortedPuts[0]}P/${sortedPuts[1]}P · ${sortedCalls[0]}C/${sortedCalls[1]}C`;
    else strikes = Array.from(new Set(groupFills.map(legKey))).join('/');

    let totalOpenValue = 0, totalCloseValue = 0, totalFees = 0;
    const sourceIds = new Set<string>();
    let anyMalformed = false;
    for (const f of groupFills) {
      totalOpenValue  += f.openPricePerContract  * f.qty * 100 * (f.isShort ?  1 : -1);
      totalCloseValue += f.closePricePerContract * f.qty * 100 * (f.isShort ? -1 :  1);
      totalFees += f.openFeeAllocated + f.closeFeeAllocated;
      f.sourceTransactionIds.forEach(id => sourceIds.add(id));
      if (f.malformed) anyMalformed = true;
    }

    const creditReceived = totalOpenValue;
    const closePrice     = -totalCloseValue;
    const pnl    = creditReceived + totalCloseValue - totalFees;
    const pnlPct = creditReceived !== 0 ? (pnl / Math.abs(creditReceived)) * 100 : 0;

    const holdDays = Math.round((new Date(closeDate).getTime() - new Date(openDay).getTime()) / 86400000);
    // Add T12:00:00Z to force UTC noon -- prevents timezone day-shift on
    // date-only strings (this is the fix for performance/page.tsx's old
    // dteAtClose, which computed this without the offset).
    const dteAtClose = Math.max(0, Math.round((new Date(expiry + 'T12:00:00Z').getTime() - new Date(closeDate + 'T12:00:00Z').getTime()) / 86400000));
    const dteAtEntry = holdDays + dteAtClose;
    const exitType: ExitType = classifyExit(pnl, creditReceived, holdDays, dteAtClose, dteAtEntry);
    const outcome: Outcome = pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'SCRATCH';

    const earliestOpenExecutedAt = groupFills.map(f => f.openExecutedAt).sort()[0] ?? '';
    const { openTime, openDow } = computeEntryTime(earliestOpenExecutedAt);

    // Quantity metadata -- MIN across legs for opened/closed is the
    // conservative "complete spread units" count (a multi-leg spread is
    // only as closed as its most-restrictive leg); MAX for remaining is
    // conservative in the other direction (if any leg still has contracts
    // open, the spread as a whole isn't fully closed).
    const openedQuantity   = Math.min(...groupFills.map(f => f.openedQuantity));
    const closedQuantity   = Math.min(...groupFills.map(f => f.qty));
    const remainingQuantity = Math.max(...groupFills.map(f => f.remainingOnLotAfter));

    const mechanisms = new Set(groupFills.map(f => f.closureMechanism));
    const qtysAgree = groupFills.every(f => f.qty === groupFills[0].qty);
    const isPartial = closedQuantity < openedQuantity || remainingQuantity > 0;
    let closureMechanism: ClosureMechanism = mechanisms.size === 1 ? Array.from(mechanisms)[0] : 'PARTIAL_CLOSE';
    if (closureMechanism === 'CLOSED' && isPartial) closureMechanism = 'PARTIAL_CLOSE';

    // INCOMPLETE flags a best-effort approximation: legs of this nominal
    // spread disagreed on how many contracts closed in this tranche, or a
    // source transaction had unparseable price data. It does NOT mean pnl
    // is null/fabricated -- every number here is computed from whatever
    // real data was available; this just tells a future consumer not to
    // treat it as a clean 1:1 reconstruction.
    const reconstructionStatus: ReconstructionStatus = (qtysAgree && !anyMalformed) ? 'COMPLETE' : 'INCOMPLETE';

    trades.push({
      id: buildClosedTradeId(underlying, openDay, expiry, closeDate),
      symbol: underlying,
      strategy,
      openDate: openDay,
      closeDate,
      openTime,
      openDow,
      expiry,
      holdDays,
      dteAtClose,
      dteAtEntry,
      exitType,
      strikes,
      creditReceived,
      closePrice,
      pnl,
      pnlPct,
      outcome,
      quantity: strategy === 'IC' ? Math.min(putLegCount, callLegCount) : Math.max(putLegCount, callLegCount, 1),
      fees: totalFees,
      reconstructionStatus,
      closureMechanism,
      openedQuantity,
      closedQuantity,
      remainingQuantity,
      sourceTransactionIds: Array.from(sourceIds),
    });
  }

  trades.sort((a, b) => b.closeDate.localeCompare(a.closeDate));
  return trades;
}

// ── Public: pure reconstruction (no network) ──────────────────────────────
// Exported separately from fetchAndReconstructTrades so it can be
// unit-tested with fixture transaction arrays rather than a live TastyTrade
// session.
export function reconstructTrades(transactions: RawTransaction[]): ReconstructionResult {
  const { fills, unmatched } = buildFills(transactions);
  const trades = groupFillsIntoTrades(fills);
  return { trades, unmatchedClosures: unmatched };
}

// ── Public: network fetch + reconstruction ────────────────────────────────
export async function fetchAndReconstructTrades(range: TimeRange): Promise<ReconstructionResult> {
  const token = await getAccessToken();
  const accountNumber = await requireActiveBrokerAccount(token, ttFetch);
  const startDate = rangeStartDate(range);
  let allTx: RawTransaction[] = [];
  let page = 1;
  while (true) {
    const data = await ttFetch(`/accounts/${accountNumber}/transactions?start-date=${startDate}&per-page=250&page-offset=${(page - 1) * 250}`, token);
    const items: RawTransaction[] = data?.data?.items ?? [];
    allTx = [...allTx, ...items];
    if (!data?.pagination || items.length < 250 || allTx.length >= data.pagination['total-items']) break;
    page++;
  }
  return reconstructTrades(allTx);
}
