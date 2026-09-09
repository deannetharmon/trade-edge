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
    expect(assessPendingEntry(order('Working'))).toMatchObject({
      state: 'LIVE_AT_EXCHANGE', recommendation: 'REVIEW_PRICE',
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
