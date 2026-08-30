import { describe, expect, it, vi } from 'vitest';
import { analyzePositionStructure, buildCanonicalCloseIdentity, type RawEconomicLeg } from '../closeOrderSafety';
import { revalidatePersistedPmccLongClose } from '../pmccLongCloseSubmission';
import type { PmccCampaign } from '../pmccCampaign';

function identity() {
  const leg: RawEconomicLeg = {
    symbol: 'NVDA  280121C00120000', optionType: 'C', strikePrice: 120,
    direction: 'Long', quantity: 3, avgOpenPrice: 75,
  };
  const analysis = analyzePositionStructure([leg]);
  if (analysis.status !== 'RESOLVED') throw new Error('fixture did not resolve');
  const result = buildCanonicalCloseIdentity(analysis.structures[0], 'long-1', 'NVDA', '2028-01-21');
  if (!result.ok) throw new Error(result.message);
  return result.identity;
}

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

const campaignLoader = async () => ({ status: 'ok' as const, campaigns: { 'campaign-1': campaign() }, reason: null });

describe('persisted PMCC long-close submission revalidation', () => {
  it('uses freshly refreshed broker short quantity and blocks a race that persisted allocation alone would miss', async () => {
    const loadBrokerCoverage = vi.fn(async () => ({
      status: 'ok' as const,
      currentLongQuantity: 3,
      activeShortQuantities: { 'NVDA  261016C00200000': 3 },
      reason: null,
    }));

    const result = await revalidatePersistedPmccLongClose({
      identity: identity(), currentLongQuantity: 3, proposedLongQuantityAfterAction: 2,
      loadCampaigns: campaignLoader,
      loadBrokerCoverage,
    });

    expect(result.required).toBe(true);
    expect(result.safe).toBe(false);
    expect(result.coverage?.requiredAllocatedLongQuantity).toBe(3);
    expect(loadBrokerCoverage).toHaveBeenCalledOnce();
  });

  it('allows only the unencumbered LEAPS quantity when fresh broker state agrees with two active shorts', async () => {
    const result = await revalidatePersistedPmccLongClose({
      identity: identity(), currentLongQuantity: 3, proposedLongQuantityAfterAction: 2,
      loadCampaigns: campaignLoader,
      loadBrokerCoverage: async () => ({
        status: 'ok', currentLongQuantity: 3,
        activeShortQuantities: { 'NVDA  261016C00200000': 2 }, reason: null,
      }),
    });
    expect(result.safe).toBe(true);
    expect(result.coverage?.remainingLongQuantity).toBe(2);
  });

  it('fails closed when current brokerage coverage cannot be refreshed', async () => {
    const result = await revalidatePersistedPmccLongClose({
      identity: identity(), currentLongQuantity: 3, proposedLongQuantityAfterAction: 2,
      loadCampaigns: campaignLoader,
      loadBrokerCoverage: async () => ({
        status: 'unavailable', currentLongQuantity: null, activeShortQuantities: {}, reason: 'broker unavailable',
      }),
    });
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('broker unavailable');
  });

  it('does not require PMCC coverage gating when no live campaign claims the exact OCC identity', async () => {
    const loadBrokerCoverage = vi.fn();
    const result = await revalidatePersistedPmccLongClose({
      identity: identity(), currentLongQuantity: 3, proposedLongQuantityAfterAction: 2,
      loadCampaigns: async () => ({ status: 'ok', campaigns: {}, reason: null }),
      loadBrokerCoverage,
    });
    expect(result.required).toBe(false);
    expect(result.safe).toBe(true);
    expect(loadBrokerCoverage).not.toHaveBeenCalled();
  });
});
