import { describe, expect, it } from 'vitest';
import {
  computePmccCampaignEconomics,
  evaluatePmccCoverageAfterLongChange,
  nextPmccStatusAfterShortCycle,
  type PmccCampaign,
} from '../pmccCampaign';

function campaign(overrides: Partial<PmccCampaign> = {}): PmccCampaign {
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
    ...overrides,
  };
}

describe('PMCC campaign coverage', () => {
  it('allows selling only unencumbered LEAPS quantity', () => {
    const result = evaluatePmccCoverageAfterLongChange({
      campaign: campaign(), longOccSymbol: 'NVDA  280121C00120000', currentLongQuantity: 3, proposedLongQuantityAfterAction: 2,
      activeShortQuantities: { 'NVDA  261016C00200000': 2 },
    });
    expect(result.safe).toBe(true);
    expect(result.requiredAllocatedLongQuantity).toBe(2);
  });

  it('blocks a reduction that would leave an authoritative short obligation unsupported', () => {
    const result = evaluatePmccCoverageAfterLongChange({
      campaign: campaign(), longOccSymbol: 'NVDA  280121C00120000', currentLongQuantity: 3, proposedLongQuantityAfterAction: 1,
      activeShortQuantities: { 'NVDA  261016C00200000': 2 },
    });
    expect(result.safe).toBe(false);
    expect(result.unresolved).toBe(false);
  });

  it('does not silently reassign coverage to an unrelated long contract', () => {
    const result = evaluatePmccCoverageAfterLongChange({
      campaign: campaign(), longOccSymbol: 'NVDA  280121C00120000', currentLongQuantity: 3, proposedLongQuantityAfterAction: 0,
      activeShortQuantities: { 'NVDA  261016C00200000': 2 },
    });
    expect(result.safe).toBe(false);
  });

  it('fails closed while relationship or broker state requires reconciliation', () => {
    expect(evaluatePmccCoverageAfterLongChange({
      campaign: campaign({ status: 'RELATIONSHIP_UNRESOLVED' }), longOccSymbol: 'NVDA  280121C00120000', currentLongQuantity: 3, proposedLongQuantityAfterAction: 3,
    }).safe).toBe(false);
    expect(evaluatePmccCoverageAfterLongChange({
      campaign: campaign({ status: 'RECONCILIATION_REQUIRED' }), longOccSymbol: 'NVDA  280121C00120000', currentLongQuantity: 3, proposedLongQuantityAfterAction: 3,
    }).safe).toBe(false);
  });

  it('uses refreshed short quantity as authoritative at submission time', () => {
    const uiPass = evaluatePmccCoverageAfterLongChange({
      campaign: campaign(), longOccSymbol: 'NVDA  280121C00120000', currentLongQuantity: 3, proposedLongQuantityAfterAction: 2,
      activeShortQuantities: { 'NVDA  261016C00200000': 2 },
    });
    expect(uiPass.safe).toBe(true);

    const submissionRevalidation = evaluatePmccCoverageAfterLongChange({
      campaign: campaign(), longOccSymbol: 'NVDA  280121C00120000', currentLongQuantity: 3, proposedLongQuantityAfterAction: 2,
      activeShortQuantities: { 'NVDA  261016C00200000': 3 },
    });
    expect(submissionRevalidation.safe).toBe(false);
  });
});

describe('PMCC campaign accounting', () => {
  it('keeps current full-exit P&L separate from historical realized income', () => {
    const result = computePmccCampaignEconomics({
      leapsCloseNowPnl: 2400,
      realizedShortCallPnl: [900, 900],
      currentShortCallCloseNowPnl: [-350],
    });
    expect(result.realizedPmccIncome).toBe(1800);
    expect(result.currentPmccExposurePnl).toBe(-350);
    expect(result.netProfitIfFullyExitedNow).toBe(2050);
    expect(result.lifetimeStrategyPnl).toBe(3850);
  });

  it('does not fabricate incomplete campaign economics', () => {
    const result = computePmccCampaignEconomics({
      leapsCloseNowPnl: 2400,
      realizedShortCallPnl: [900, null],
      currentShortCallCloseNowPnl: [-350],
    });
    expect(result.realizedPmccIncome).toBeNull();
    expect(result.lifetimeStrategyPnl).toBeNull();
    expect(result.netProfitIfFullyExitedNow).toBe(2050);
  });
});

describe('PMCC lifecycle', () => {
  it('returns surviving LEAPS to available after an ordinary short close or expiration', () => {
    expect(nextPmccStatusAfterShortCycle({ currentStatus: 'ACTIVE_PMCC', closureMechanism: 'CLOSED', remainingActiveShortQuantity: 0 }))
      .toBe('LEAPS_ONLY_PMCC_AVAILABLE');
    expect(nextPmccStatusAfterShortCycle({ currentStatus: 'ACTIVE_PMCC', closureMechanism: 'EXPIRED', remainingActiveShortQuantity: 0 }))
      .toBe('LEAPS_ONLY_PMCC_AVAILABLE');
  });

  it('requires reconciliation after assignment or exercise', () => {
    expect(nextPmccStatusAfterShortCycle({ currentStatus: 'ACTIVE_PMCC', closureMechanism: 'ASSIGNED', remainingActiveShortQuantity: 0 }))
      .toBe('RECONCILIATION_REQUIRED');
    expect(nextPmccStatusAfterShortCycle({ currentStatus: 'ACTIVE_PMCC', closureMechanism: 'EXERCISED', remainingActiveShortQuantity: 0 }))
      .toBe('RECONCILIATION_REQUIRED');
  });
});
