// lib/scans/__tests__/pmccReviewHandoff.test.ts

import { describe, expect, it, vi } from 'vitest';
import { isPmccReviewHandoff, launchPmccShortCallReview, PMCC_REVIEW_HANDOFF_STORAGE_KEY } from '../pmccReviewHandoff';

describe('PMCC held-LEAPS review handoff', () => {
  it('requires exact broker position identity rather than accepting a ticker alone', () => {
    expect(isPmccReviewHandoff({ accountNumber: '5WT123', positionKey: 'pos-1', underlyingSymbol: 'UBER', occSymbol: 'UBER  270917C00075000' })).toBe(true);
    expect(isPmccReviewHandoff({ underlyingSymbol: 'UBER' })).toBe(false);
    expect(isPmccReviewHandoff({ accountNumber: '5WT123', positionKey: 'pos-1', underlyingSymbol: 'UBER', occSymbol: '' })).toBe(false);
  });
});

describe('launchPmccShortCallReview (SUGGESTED-ACTIONS-0001)', () => {
  const target = { accountNumber: '5WT123', positionKey: 'pos-1', symbol: 'UBER', exactContract: 'UBER  270917C00075000' };

  it('stores the exact hand-off payload and opens the held-LEAPS review', () => {
    const setItem = vi.fn();
    const navigate = vi.fn();
    expect(launchPmccShortCallReview(target, { setItem, navigate })).toBe(true);
    expect(setItem).toHaveBeenCalledWith(PMCC_REVIEW_HANDOFF_STORAGE_KEY, JSON.stringify({
      accountNumber: '5WT123', positionKey: 'pos-1', underlyingSymbol: 'UBER', occSymbol: 'UBER  270917C00075000',
    }));
    expect(navigate).toHaveBeenCalledWith('/screener?launch=pmcc-held');
    expect(isPmccReviewHandoff(JSON.parse(setItem.mock.calls[0][1]))).toBe(true);
  });

  it('does nothing unless account, position and contract are all known', () => {
    for (const missing of ['accountNumber', 'positionKey', 'exactContract'] as const) {
      const setItem = vi.fn();
      const navigate = vi.fn();
      expect(launchPmccShortCallReview({ ...target, [missing]: null }, { setItem, navigate })).toBe(false);
      expect(setItem).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    }
  });
});
