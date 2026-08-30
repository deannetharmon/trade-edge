import { describe, expect, it, vi } from 'vitest';
import type { PmccCampaign } from '../pmccCampaign';
import { evaluatePmccCoverageAfterLongChange } from '../pmccCampaign';
import { submitPmccLongCloseIfSafe } from '../pmccLongCloseSubmission';

function campaign(): PmccCampaign {
  return {
    id: 'campaign-1', accountNumber: 'acct-1', underlying: 'NVDA',
    anchorLongOccSymbol: 'NVDA  280121C00120000', anchorLongPositionKey: 'long-1',
    anchorLongQuantity: 3, inceptionDate: '2026-08-30', status: 'ACTIVE_PMCC',
    allocations: [{
      id: 'alloc-1', campaignId: 'campaign-1', accountNumber: 'acct-1',
      longOccSymbol: 'NVDA  280121C00120000', shortOccSymbol: 'NVDA  261016C00200000',
      allocatedLongQuantity: 2, allocatedShortQuantity: 2, status: 'ACTIVE', createdAt: '2026-08-30T12:00:00Z',
    }],
    shortCallCycles: [], historicalAttributionComplete: true, updatedAt: '2026-08-30T12:00:00Z',
  };
}

describe('PMCC long-close broker boundary', () => {
  it('permits submission when refreshed authoritative coverage remains safe', async () => {
    const submit = vi.fn(async () => ({ orderId: 'order-1' }));
    const result = await submitPmccLongCloseIfSafe({
      campaign: campaign(),
      longOccSymbol: 'NVDA  280121C00120000',
      currentLongQuantity: 3,
      proposedLongQuantityAfterAction: 2,
      activeShortQuantities: { 'NVDA  261016C00200000': 2 },
      submit,
    });
    expect(result.submitted).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('blocks the mandatory UI-pass/state-change/submission-fail race without transmitting', async () => {
    const uiEvaluation = evaluatePmccCoverageAfterLongChange({
      campaign: campaign(),
      longOccSymbol: 'NVDA  280121C00120000',
      currentLongQuantity: 3,
      proposedLongQuantityAfterAction: 2,
      activeShortQuantities: { 'NVDA  261016C00200000': 2 },
    });
    expect(uiEvaluation.safe).toBe(true);

    const submit = vi.fn(async () => ({ orderId: 'must-not-exist' }));
    const result = await submitPmccLongCloseIfSafe({
      campaign: campaign(),
      longOccSymbol: 'NVDA  280121C00120000',
      currentLongQuantity: 3,
      proposedLongQuantityAfterAction: 2,
      activeShortQuantities: { 'NVDA  261016C00200000': 3 },
      submit,
    });

    expect(result.submitted).toBe(false);
    expect(result.coverage.safe).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it('fails closed for unresolved campaign relationships', async () => {
    const submit = vi.fn(async () => ({ orderId: 'must-not-exist' }));
    const unresolved = { ...campaign(), status: 'RELATIONSHIP_UNRESOLVED' as const };
    const result = await submitPmccLongCloseIfSafe({
      campaign: unresolved,
      longOccSymbol: unresolved.anchorLongOccSymbol,
      currentLongQuantity: 3,
      proposedLongQuantityAfterAction: 3,
      activeShortQuantities: {},
      submit,
    });
    expect(result.submitted).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });
});
