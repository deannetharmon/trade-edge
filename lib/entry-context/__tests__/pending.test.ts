import { describe, expect, it } from 'vitest';
import { createPendingCreditSpreadEntry } from '../pending';
import { availableEvidence, unavailableEvidence } from '../types';
import { promotePendingEntryOnConfirmedFills } from '../promote';

describe('pending entry evidence', () => {
  it('requires an actual broker order identity but does not call it a fill', () => {
    expect(() => createPendingCreditSpreadEntry({ accountId: 'acct', brokerOrderId: '', openingOrderIds: [], submittedAt: '', strategy: 'BPS', symbol: 'SPY', expiration: '2026-10-16', shortStrike: 600, longStrike: 595, quantity: 1 } as never)).toThrow('accountId, brokerOrderId, component order ids, and submittedAt');
  });
  it('promotes only after every opening fill is confirmed', () => {
    const at = '2026-09-08T14:00:00.000Z';
    const pending = createPendingCreditSpreadEntry({ accountId: 'acct', brokerOrderId: 'complex-order', openingOrderIds: ['open-order'], submittedAt: at, strategy: 'BPS', symbol: 'SPY', expiration: '2026-10-16', shortStrike: 600, longStrike: 595, quantity: 1, fillPrice: availableEvidence(1, 'fill', at), underlyingPrice: availableEvidence(610, 'quote', at), shortDelta: unavailableEvidence('n/a'), shortLegIv: unavailableEvidence('n/a'), ivr: unavailableEvidence('n/a'), underlyingIv: unavailableEvidence('n/a'), expectedMove: unavailableEvidence('n/a'), earningsDate: unavailableEvidence('n/a'), quoteBid: unavailableEvidence('n/a'), quoteAsk: unavailableEvidence('n/a'), quoteMid: unavailableEvidence('n/a') });
    expect(promotePendingEntryOnConfirmedFills(pending, [], [{ id: 'a', 'order-id': 'other', 'transaction-type': 'Trade', 'executed-at': at }])).toBeNull();
    expect(promotePendingEntryOnConfirmedFills(pending, [], [{ id: 'a', 'order-id': 'open-order', 'transaction-type': 'Trade', 'executed-at': at }])?.executionId).toBe('a');
  });
  it('preserves every confirmed opening transaction for later Trade Log linkage', () => {
    const at = '2026-09-08T14:00:00.000Z';
    const pending = createPendingCreditSpreadEntry({ accountId: 'acct', brokerOrderId: 'complex-order', openingOrderIds: ['open-order'], submittedAt: at, strategy: 'BPS', symbol: 'SPY', expiration: '2026-10-16', shortStrike: 600, longStrike: 595, quantity: 1, fillPrice: unavailableEvidence('aggregate fill pending'), underlyingPrice: availableEvidence(610, 'quote', at), shortDelta: unavailableEvidence('n/a'), shortLegIv: unavailableEvidence('n/a'), ivr: unavailableEvidence('n/a'), underlyingIv: unavailableEvidence('n/a'), expectedMove: unavailableEvidence('n/a'), earningsDate: unavailableEvidence('n/a'), quoteBid: unavailableEvidence('n/a'), quoteAsk: unavailableEvidence('n/a'), quoteMid: unavailableEvidence('n/a') });
    const snapshot = promotePendingEntryOnConfirmedFills(pending, [], [
      { id: 'short-leg', 'order-id': 'open-order', 'transaction-type': 'Trade', 'executed-at': at },
      { id: 'long-leg', 'order-id': 'open-order', 'transaction-type': 'Trade', 'executed-at': at },
    ]);
    expect(snapshot?.sourceTransactionIds).toEqual(['long-leg', 'short-leg']);
  });
  it('does not relabel a submitted limit as an actual broker fill', () => {
    const at = '2026-09-08T14:00:00.000Z';
    const pending = createPendingCreditSpreadEntry({ accountId: 'acct', brokerOrderId: 'complex-order', openingOrderIds: ['open-order'], submittedAt: at, strategy: 'BCS', symbol: 'SPY', expiration: '2026-10-16', shortStrike: 600, longStrike: 605, quantity: 1, fillPrice: unavailableEvidence('Aggregate spread fill is unavailable until broker execution evidence is captured'), underlyingPrice: availableEvidence(590, 'quote', at), shortDelta: unavailableEvidence('n/a'), shortLegIv: unavailableEvidence('n/a'), ivr: unavailableEvidence('n/a'), underlyingIv: unavailableEvidence('n/a'), expectedMove: unavailableEvidence('n/a'), earningsDate: unavailableEvidence('n/a'), quoteBid: unavailableEvidence('n/a'), quoteAsk: unavailableEvidence('n/a'), quoteMid: unavailableEvidence('n/a') });
    const snapshot = promotePendingEntryOnConfirmedFills(pending, [], [{ id: 'a', 'order-id': 'open-order', 'transaction-type': 'Trade', 'executed-at': at }]);
    expect(snapshot?.fillPrice).toMatchObject({ state: 'UNAVAILABLE' });
  });
});
