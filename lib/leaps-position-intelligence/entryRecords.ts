// lib/leaps-position-intelligence/entryRecords.ts
//
// LEAPS-ENTRY-0001 -- a true entry record for LEAPS and PMCC orders: the market facts the SERVER resolved from the broker at the moment
// an order was accepted (stock price, the contract's bid / ask / mid, delta, IV, extrinsic, DTE, quantity and limit price). Unlike the
// first-seen baseline this is the state at order time, and it is the only record that can ever exist for that moment.
//
// Pure builders and selectors (safe to import from client code; the Redis helpers are in entryRecordsStore.ts). Records are append-only, per user + broker account + LEAPS contract, and hold no
// tokens or account numbers (the account is only part of the hashed key). Nothing here touches an order: capture is done by
// entryCapture.ts, best-effort, after the broker has already accepted the order.

export const ENTRY_RECORD_SCHEMA_VERSION = 1;
export const ENTRY_RECORD_TTL_SECONDS = 5 * 365 * 24 * 60 * 60; // 5 years: longer than any LEAPS plus its cycles
export const ENTRY_RECORD_MAX_PER_CONTRACT = 200;

export type EntryRecordKind = 'leaps-entry' | 'pmcc-entry' | 'short-call-sold';

/** The parts of a server-resolved contract review that the record keeps (a structural subset of ServerLeapsReview). */
export interface EntryLegSource {
  occSymbol: string; strike: number; expiration: string; dte: number;
  bid: number | null; ask: number | null; delta: number | null; impliedVolatility: number | null; openInterest: number | null;
  optionQuoteTimestamp: string | null;
  spot: number | null; underlyingQuoteTimestamp: string | null;
}

export interface EntryLeg {
  occSymbol: string; strike: number; expiration: string; dte: number;
  bid: number | null; ask: number | null; mid: number | null;
  delta: number | null; impliedVolatility: number | null; openInterest: number | null; quoteAt: string | null;
}

export interface LeapsEntryRecord {
  schemaVersion: typeof ENTRY_RECORD_SCHEMA_VERSION;
  id: string;
  kind: EntryRecordKind;
  /** When the broker accepted the order (ISO). */
  recordedAt: string;
  brokerOrderId: string | null;
  underlyingSymbol: string;
  longOccSymbol: string;
  shortOccSymbol: string | null;
  quantity: number;
  /** Limit price per share as submitted (a debit for entries, a credit for a short call sold). */
  limitPrice: number;
  priceEffect: 'Debit' | 'Credit';
  underlying: { price: number | null; quoteAt: string | null };
  long: EntryLeg | null;
  short: EntryLeg | null;
  /** The long LEAPS's extrinsic value when the order was placed. */
  extrinsic: { perShare: number | null; pctOfMid: number | null };
}

export interface BuildEntryRecordInput {
  id: string;
  kind: EntryRecordKind;
  recordedAt: string;
  underlyingSymbol: string;
  longOccSymbol: string;
  shortOccSymbol: string | null;
  quantity: number;
  limitPrice: number;
  priceEffect: 'Debit' | 'Credit';
  long: EntryLegSource | null;
  short: EntryLegSource | null;
  /** The broker's order response (the `data` object). */
  order: unknown;
}

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

function leg(source: EntryLegSource | null): EntryLeg | null {
  if (!source) return null;
  const bid = finite(source.bid); const ask = finite(source.ask);
  return {
    occSymbol: source.occSymbol, strike: source.strike, expiration: source.expiration, dte: source.dte,
    bid, ask, mid: bid != null && ask != null ? round((bid + ask) / 2, 4) : null,
    delta: finite(source.delta) != null ? round(source.delta as number, 4) : null,
    impliedVolatility: finite(source.impliedVolatility), openInterest: finite(source.openInterest), quoteAt: source.optionQuoteTimestamp ?? null,
  };
}

/** The broker's order id from an order response, or null when it cannot be read. */
export function brokerOrderIdOf(order: unknown): string | null {
  const o = order as { order?: { id?: unknown }; id?: unknown } | null | undefined;
  const id = o?.order?.id ?? o?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : typeof id === 'number' && Number.isFinite(id) ? String(id) : null;
}

export function buildEntryRecord(input: BuildEntryRecordInput): LeapsEntryRecord {
  const longLeg = leg(input.long);
  const shortLeg = leg(input.short);
  const spotSource = input.long ?? input.short;
  const spot = finite(spotSource?.spot);
  // Extrinsic of the long call at order time: mid less intrinsic. Unknown if the quote or the stock price is missing.
  let extrinsic: LeapsEntryRecord['extrinsic'] = { perShare: null, pctOfMid: null };
  if (longLeg && longLeg.mid != null && longLeg.mid > 0 && spot != null && spot > 0) {
    const perShare = longLeg.mid - Math.max(spot - longLeg.strike, 0);
    // `+ 0` turns a rounded negative zero into 0.
    extrinsic = { perShare: round(perShare, 4) + 0, pctOfMid: round((perShare / longLeg.mid) * 100, 2) + 0 };
  }
  return {
    schemaVersion: ENTRY_RECORD_SCHEMA_VERSION, id: input.id, kind: input.kind, recordedAt: input.recordedAt,
    brokerOrderId: brokerOrderIdOf(input.order),
    underlyingSymbol: input.underlyingSymbol, longOccSymbol: input.longOccSymbol, shortOccSymbol: input.shortOccSymbol,
    quantity: input.quantity, limitPrice: input.limitPrice, priceEffect: input.priceEffect,
    underlying: { price: spot, quoteAt: spotSource?.underlyingQuoteTimestamp ?? null },
    long: longLeg, short: shortLeg, extrinsic,
  };
}

/**
 * The entry record for the order that opened a position: among 'leaps-entry' / 'pmcc-entry' records, the latest one placed on or before
 * the position's open date (plus one day of tolerance for time zones). A good-till-cancelled order can fill days after it was placed, so
 * the gap is returned for the caller to label honestly.
 */
export function selectEntryRecord(records: LeapsEntryRecord[], entryDate: string | null): { record: LeapsEntryRecord; daysBeforeFill: number } | null {
  if (!entryDate || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return null;
  const fill = Date.parse(entryDate);
  if (!Number.isFinite(fill)) return null;
  const dayMs = 86_400_000;
  let best: { record: LeapsEntryRecord; placed: number } | null = null;
  for (const record of records) {
    if (record.kind !== 'leaps-entry' && record.kind !== 'pmcc-entry') continue;
    const placed = Date.parse(record.recordedAt.slice(0, 10));
    if (!Number.isFinite(placed) || placed > fill + dayMs) continue;
    if (!best || Date.parse(record.recordedAt) > Date.parse(best.record.recordedAt)) best = { record, placed };
  }
  return best ? { record: best.record, daysBeforeFill: Math.max(0, Math.round((fill - best.placed) / dayMs)) } : null;
}
