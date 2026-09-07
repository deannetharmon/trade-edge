import { describe, expect, it } from 'vitest';
import { leapsReviewTradeDisabledReason } from '../tradeQualification';

const base = { extrinsicPctOfCost: 10, spreadPct: 1, policyVersion: 'leaps-entry-v1' };
describe('LEAPS Review-trade disabled reason', () => {
  it('uses the exact discovery-mode instruction', () => {
    expect(leapsReviewTradeDisabledReason({ ...base, status: 'REVIEW_REQUIRED', gates: [{ id: 'extrinsicPct', status: 'not_applied', message: 'Extrinsic ceiling is in discovery mode' }] } as any)).toBe('Select an Extrinsic ceiling to complete contract qualification.');
  });
  it('never permits a nonqualified deterministic status', () => {
    expect(leapsReviewTradeDisabledReason({ ...base, status: 'NOT_QUALIFIED', gates: [{ id: 'delta', status: 'fail', message: 'Delta must be 0.70–0.85' }] } as any)).toBe('Delta must be 0.70–0.85');
    expect(leapsReviewTradeDisabledReason({ ...base, status: 'CONTRACT_QUALIFIED', gates: [] } as any)).toBeNull();
  });
});
