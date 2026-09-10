import { describe, expect, it } from 'vitest';
import { isPmccReviewHandoff } from '../pmccReviewHandoff';

describe('PMCC held-LEAPS review handoff', () => {
  it('requires exact broker position identity rather than accepting a ticker alone', () => {
    expect(isPmccReviewHandoff({ accountNumber: '5WT123', positionKey: 'pos-1', underlyingSymbol: 'UBER', occSymbol: 'UBER  270917C00075000' })).toBe(true);
    expect(isPmccReviewHandoff({ underlyingSymbol: 'UBER' })).toBe(false);
    expect(isPmccReviewHandoff({ accountNumber: '5WT123', positionKey: 'pos-1', underlyingSymbol: 'UBER', occSymbol: '' })).toBe(false);
  });
});
