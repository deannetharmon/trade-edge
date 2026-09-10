import { assessPendingEntry, groupPendingEntries } from '../pendingEntryIntelligence';
import type { PendingOrder } from '@/lib/portfolio-data/types';
import { describe, expect, it } from 'vitest';

const order = (status: string, extra: Partial<PendingOrder> = {}): PendingOrder => ({
  id: 'entry-1', accountNumber: 'A1', symbol: 'MRVL', strategy: 'BCS', legs: [],
  expDate: '2026-10-16', limitPrice: 1.25, priceEffect: 'Credit', status,
  createdAt: null, orderType: 'Limit', timeInForce: 'GTC', ...extra,
});

describe('pending entry intelligence', () => {
  it('does not equate a working broker order with a fill', () => {
    expect(assessPendingEntry(order('Working', { quoteQuality: 'RELIABLE', currentExecutablePrice: 1.1 }))).toMatchObject({
      state: 'LIVE_AT_EXCHANGE', recommendation: 'REVIEW_PRICE',
    });
  });

  it('keeps a live credit order working when its requested credit is executable', () => {
    expect(assessPendingEntry(order('Live', { quoteQuality: 'RELIABLE', currentExecutablePrice: 1.3 }))).toMatchObject({
      recommendation: 'KEEP_WORKING', executionDecision: 'NO_PRICE_CHANGE_NEEDED',
    });
  });

  it('offers a reprice only when a live credit limit exceeds the natural-side reference', () => {
    expect(assessPendingEntry(order('Working', { quoteQuality: 'RELIABLE', currentExecutablePrice: 1.1 }))).toMatchObject({
      executionDecision: 'REPRICE_AVAILABLE', recommendationLabel: 'Reprice Available',
    });
  });

  it('requires broker-status resolution before evaluating a received order price', () => {
    expect(assessPendingEntry(order('Received', { quoteQuality: 'RELIABLE', currentExecutablePrice: 0.5 }))).toMatchObject({
      executionDecision: 'RESOLVE_BROKER_STATUS', recommendationLabel: 'Resolve Broker Status',
    });
  });

  it('fails closed to quote unavailable for a live order without fresh two-sided evidence', () => {
    expect(assessPendingEntry(order('Working'))).toMatchObject({ executionDecision: 'QUOTE_UNAVAILABLE' });
  });

  it('mirrors price direction for debit orders', () => {
    expect(assessPendingEntry(order('Working', { priceEffect: 'Debit', limitPrice: 1.25, quoteQuality: 'RELIABLE', currentExecutablePrice: 1.1 }))).toMatchObject({
      executionDecision: 'NO_PRICE_CHANGE_NEEDED',
    });
    expect(assessPendingEntry(order('Working', { priceEffect: 'Debit', limitPrice: 0.9, quoteQuality: 'RELIABLE', currentExecutablePrice: 1.1 }))).toMatchObject({
      executionDecision: 'REPRICE_AVAILABLE',
    });
  });

  it('fails closed when status is unfamiliar', () => {
    expect(assessPendingEntry(order('mystery'))).toMatchObject({
      state: 'SUBMISSION_UNKNOWN', recommendation: 'REVIEW_MANUALLY',
    });
  });

  it('groups order records by their broker parent identity', () => {
    const groups = groupPendingEntries([
      order('Working', { id: 'child-a', parentOrderId: 'parent-1' }),
      order('Contingent', { id: 'child-b', parentOrderId: 'parent-1' }),
      order('Working', { id: 'entry-2' }),
    ]);
    expect(groups.map(group => group.map(item => item.id))).toEqual([['child-a', 'child-b'], ['entry-2']]);
  });
});
