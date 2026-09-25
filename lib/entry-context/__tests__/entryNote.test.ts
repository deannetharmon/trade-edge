// lib/entry-context/__tests__/entryNote.test.ts

// QUAL-STATES-0001 phase 3: entry notes carry the override record for cash-secured puts, which have no
// entry snapshot. Same rules: validated on the way in, promoted only on confirmed broker fills.

import { describe, expect, it } from 'vitest';
import { buildEntryNoteIndex, createPendingEntryNote, findEntryNoteForTrade, promotePendingEntryNote } from '../entryNote';
import { buildEntryQualification } from '../entryQualification';
import type { ClosedTrade } from '@/lib/tradeLog/types';

const at = '2026-09-25T15:00:00.000Z';
const record = buildEntryQualification({
  state: 'disqualified', failing: ['csp-market'], warning: [], reasonFor: () => 'earnings on or within 10 days after expiry',
  acknowledged: true, at, scanMode: null,
});
const input = (extra: Record<string, unknown> = {}) => ({
  accountId: 'acct', brokerOrderId: 'complex-1', openingOrderIds: ['open-1'], submittedAt: at,
  strategy: 'CSP', symbol: 'AMD', expiration: '2026-11-20', strike: 570, quantity: 1, entryQualification: record, ...extra,
});
const fill = (id: string, orderId: string) => ({ id, 'order-id': orderId, 'transaction-type': 'Trade', 'executed-at': at });

describe('createPendingEntryNote', () => {
  it('accepts a well-formed cash-secured put note', () => {
    const n = createPendingEntryNote(input());
    expect(n).toMatchObject({ strategy: 'CSP', symbol: 'AMD', strike: 570, quantity: 1 });
    expect(n.entryQualification).toEqual(record);
  });
  it('rejects a missing broker identity, a non-CSP structure, bad numbers, and a malformed record', () => {
    expect(() => createPendingEntryNote(null)).toThrow();
    expect(() => createPendingEntryNote(input({ brokerOrderId: '' }))).toThrow(/required/);
    expect(() => createPendingEntryNote(input({ openingOrderIds: [] }))).toThrow(/required/);
    expect(() => createPendingEntryNote(input({ strategy: 'BPS' }))).toThrow(/cash-secured put/);
    expect(() => createPendingEntryNote(input({ expiration: 'next friday' }))).toThrow(/cash-secured put/);
    expect(() => createPendingEntryNote(input({ strike: NaN }))).toThrow(/cash-secured put/);
    expect(() => createPendingEntryNote(input({ quantity: 0 }))).toThrow(/cash-secured put/);
    expect(() => createPendingEntryNote(input({ entryQualification: { state: 'bogus' } }))).toThrow(/entryQualification/);
  });
});

describe('promotePendingEntryNote', () => {
  const pending = createPendingEntryNote(input());
  it('stays pending until the opening order has a confirmed fill; an order id alone is not evidence', () => {
    expect(promotePendingEntryNote(pending, [])).toBeNull();
    expect(promotePendingEntryNote(pending, [fill('tx-9', 'some-other-order')])).toBeNull();
  });
  it('promotes on a confirmed fill, carrying the record and the exact transaction ids', () => {
    const note = promotePendingEntryNote(pending, [fill('tx-1', 'open-1'), fill('tx-2', 'open-1')])!;
    expect(note.sourceTransactionIds).toEqual(['tx-1', 'tx-2']);
    expect(note.executionId).toBe('tx-1');
    expect(note.capturedAt).toBe(at);
    expect(note.entryQualification).toEqual(record);
    expect(note.entryNoteId).toBe('entry-note-v1:acct:tx-1');
  });
});

describe('matching a note to a closed trade', () => {
  const pending = createPendingEntryNote(input());
  const note = promotePendingEntryNote(pending, [fill('tx-1', 'open-1')])!;
  const trade = (ids: string[]) => ({ sourceTransactionIds: ids }) as unknown as ClosedTrade;
  it('matches when every transaction the note preserves belongs to the trade', () => {
    expect(findEntryNoteForTrade(trade(['tx-1', 'tx-close']), buildEntryNoteIndex([note]))?.entryNoteId).toBe(note.entryNoteId);
  });
  it('does not match a trade that only overlaps by symbol or time', () => {
    expect(findEntryNoteForTrade(trade(['tx-other']), buildEntryNoteIndex([note]))).toBeNull();
  });
});
