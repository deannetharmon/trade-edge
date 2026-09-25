// lib/entry-context/entryNote.ts
//
// QUAL-STATES-0001 phase 3: the same "what the screener said at order time, and did the trader
// override it" record as the spread entry snapshots carry, for strategies that have no entry snapshot
// (cash-secured puts). Saved when the order is submitted, promoted when the broker confirms the fill,
// and matched to a Trade Log trade by exact broker transaction ids, exactly like an entry snapshot.
// Deliberately separate from the evidence snapshots so their score and plan fields, and the rollups
// built on them, are untouched.

import { sanitizeEntryQualification, type EntryQualificationRecord } from './entryQualification';
import { confirmedOpeningTransactionIdsForOrderIds, type BrokerTransactionIdentity } from './reconcile';
import type { ClosedTrade } from '@/lib/tradeLog/types';

export const ENTRY_NOTE_SCHEMA_VERSION = '1' as const;

export interface PendingEntryNote {
  accountId: string;
  brokerOrderId: string;
  openingOrderIds: string[];
  submittedAt: string;
  strategy: 'CSP';
  symbol: string;
  expiration: string;
  strike: number;
  quantity: number;
  entryQualification: EntryQualificationRecord;
}

export interface EntryNote {
  schemaVersion: typeof ENTRY_NOTE_SCHEMA_VERSION;
  entryNoteId: string;
  accountId: string;
  executionId: string;
  sourceTransactionIds: string[];
  capturedAt: string;
  strategy: 'CSP';
  symbol: string;
  expiration: string;
  strike: number;
  quantity: number;
  entryQualification: EntryQualificationRecord;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value: unknown, max = 80): string | null => typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;

/** Validates a pending note from the order window. Throws on a malformed structure; the record itself must be well formed. */
export function createPendingEntryNote(input: unknown): PendingEntryNote {
  if (input == null || typeof input !== 'object') throw new Error('Entry note is required');
  const r = input as Record<string, unknown>;
  const accountId = text(r.accountId);
  const brokerOrderId = text(r.brokerOrderId);
  const submittedAt = text(r.submittedAt);
  const symbol = text(r.symbol, 20);
  const expiration = typeof r.expiration === 'string' && ISO_DATE.test(r.expiration) ? r.expiration : null;
  const openingOrderIds = Array.isArray(r.openingOrderIds) && r.openingOrderIds.length > 0 && r.openingOrderIds.length <= 10
    ? r.openingOrderIds.map(id => text(String(id))).filter((id): id is string => id != null)
    : [];
  if (!accountId || !brokerOrderId || !submittedAt || openingOrderIds.length === 0) {
    throw new Error('accountId, brokerOrderId, opening order ids, and submittedAt are required for an entry note');
  }
  if (r.strategy !== 'CSP' || !symbol || !expiration || !Number.isFinite(r.strike) || !Number.isFinite(r.quantity) || (r.quantity as number) <= 0) {
    throw new Error('A valid cash-secured put structure is required for an entry note');
  }
  const entryQualification = sanitizeEntryQualification(r.entryQualification);
  if (!entryQualification) throw new Error('A valid entryQualification record is required for an entry note');
  return Object.freeze({
    accountId, brokerOrderId, openingOrderIds, submittedAt, strategy: 'CSP' as const, symbol, expiration,
    strike: r.strike as number, quantity: r.quantity as number, entryQualification,
  });
}

/** Returns null until every expected broker opening fill is confirmed. An order id alone is never fill evidence. */
export function promotePendingEntryNote(pending: PendingEntryNote, transactions: BrokerTransactionIdentity[]): EntryNote | null {
  const confirmed = confirmedOpeningTransactionIdsForOrderIds(pending.openingOrderIds, transactions);
  if (!confirmed) return null;
  const primary = transactions.find(tx => String(tx.id) === confirmed[0]);
  const executedAt = primary?.['executed-at'];
  if (!executedAt) return null;
  return {
    schemaVersion: ENTRY_NOTE_SCHEMA_VERSION,
    entryNoteId: `entry-note-v1:${encodeURIComponent(pending.accountId)}:${encodeURIComponent(confirmed[0])}`,
    accountId: pending.accountId,
    executionId: confirmed[0],
    sourceTransactionIds: Array.from(new Set(confirmed)).sort(),
    capturedAt: executedAt,
    strategy: pending.strategy,
    symbol: pending.symbol,
    expiration: pending.expiration,
    strike: pending.strike,
    quantity: pending.quantity,
    entryQualification: pending.entryQualification,
  };
}

export function buildEntryNoteIndex(notes: readonly EntryNote[]): Map<string, EntryNote> {
  const index = new Map<string, EntryNote>();
  for (const note of notes) for (const id of note.sourceTransactionIds) index.set(id, note);
  return index;
}

/** Same exact-match rule as a snapshot: every opening transaction the note preserves must belong to this closed trade. */
export function findEntryNoteForTrade(trade: ClosedTrade, byTransaction: Map<string, EntryNote>): EntryNote | null {
  const candidates = new Map<string, EntryNote>();
  for (const id of trade.sourceTransactionIds) {
    const note = byTransaction.get(id);
    if (note) candidates.set(note.entryNoteId, note);
  }
  return Array.from(candidates.values()).find(note => note.sourceTransactionIds.every(id => trade.sourceTransactionIds.includes(id))) ?? null;
}
