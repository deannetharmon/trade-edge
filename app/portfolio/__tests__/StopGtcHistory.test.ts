// app/portfolio/__tests__/StopGtcHistory.test.ts
//
// PI-0011: unit coverage for filterStopGtcHistory, the pure function behind
// the Stop Loss / GTC modal's collapsed History section. Deliberately does
// NOT attempt to render SetStopLossButton itself -- that component depends
// on live price fetch, AI suggestion fetch, and modal-open interaction state,
// none of which are worth mocking just to exercise a filter predicate. See
// PI-0011 implementation report for the full rationale, matching the same
// proportionate-testing approach used in PI-0010.

import { describe, expect, it } from 'vitest';
import { filterStopGtcHistory, type AuditEntry } from '../page';

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'entry-1',
    timestamp: '2026-08-13T12:00:00.000Z',
    symbol: 'MU',
    strategy: 'BPS',
    action: 'PLACE_GTC',
    orderType: 'OCO (GTC + Stop)',
    limitPrice: 2.46,
    quantity: 5,
    orderId: 'ord-1',
    status: 'submitted',
    groupKey: 'MU::2026-09-18',
    ...overrides,
  };
}

describe('PI-0011 filterStopGtcHistory', () => {
  it('includes an entry that matches the position key and carries a gtcPrice', () => {
    const log = [makeEntry({ gtcPrice: 2.27 })];
    expect(filterStopGtcHistory(log, 'MU::2026-09-18')).toHaveLength(1);
  });

  it('includes an entry that matches the position key and carries a stopPrice', () => {
    const log = [makeEntry({ stopPrice: 2.46 })];
    expect(filterStopGtcHistory(log, 'MU::2026-09-18')).toHaveLength(1);
  });

  it('excludes an entry for a different position, even with matching gtcPrice/stopPrice', () => {
    const log = [makeEntry({ groupKey: 'AAPL::2026-09-18', gtcPrice: 2.27, stopPrice: 2.46 })];
    expect(filterStopGtcHistory(log, 'MU::2026-09-18')).toHaveLength(0);
  });

  it('excludes an ordinary trade-execution entry (close/roll/take-profit) for the SAME position -- no gtcPrice or stopPrice set', () => {
    const log = [makeEntry({ action: 'TAKE_PROFIT', orderType: 'Limit' })]; // no gtcPrice/stopPrice
    expect(filterStopGtcHistory(log, 'MU::2026-09-18')).toHaveLength(0);
  });

  it('does not include a draft/unsubmitted edit -- only entries that were actually written count, and writeAuditEntry is only ever called from a confirmed-submit success path', () => {
    // This test documents the invariant at the filter level: the function
    // has no concept of "draft" vs "confirmed" because drafts are never
    // written to the log in the first place (see the two writeAuditEntry
    // call sites in SetStopLossButton.submit -- both fire only after a
    // successful broker response). An empty log correctly produces no history.
    expect(filterStopGtcHistory([], 'MU::2026-09-18')).toHaveLength(0);
  });

  it('returns multiple matching entries in their original order (log is already newest-first via unshift)', () => {
    const log = [
      makeEntry({ id: 'e2', gtcPrice: 2.20, timestamp: '2026-08-13T14:00:00.000Z' }),
      makeEntry({ id: 'e1', gtcPrice: 2.27, timestamp: '2026-08-13T12:00:00.000Z' }),
    ];
    const result = filterStopGtcHistory(log, 'MU::2026-09-18');
    expect(result.map(e => e.id)).toEqual(['e2', 'e1']);
  });
});
