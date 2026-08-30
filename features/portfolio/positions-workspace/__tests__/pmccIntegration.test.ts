import { describe, expect, it } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';
import type { PmccCampaign } from '@/lib/portfolio/pmccCampaign';
import { buildPmccCampaignViewModels } from '../model/pmccIntegration';

function position(input: {
  key: string;
  occ: string;
  direction: 'Long' | 'Short';
  quantity: number;
  dte: number;
  closeNowPnl: number;
}): Position {
  return {
    key: input.key,
    symbol: 'NVDA',
    strategy: input.direction === 'Long' ? 'Long Call' : 'Short Call',
    accountNumber: 'acct-1',
    structureAmbiguous: false,
    dte: input.dte,
    entryPriceEffect: input.direction === 'Long' ? 'Debit' : 'Credit',
    entryEconomicsComplete: true,
    closeNowPnl: input.closeNowPnl,
    legs: [{
      symbol: input.occ,
      direction: input.direction,
      optionType: 'C',
      strikePrice: input.direction === 'Long' ? 120 : 200,
      quantity: input.quantity,
    }],
  } as Position;
}

function campaign(overrides: Partial<PmccCampaign> = {}): PmccCampaign {
  return {
    id: 'campaign-1',
    accountNumber: 'acct-1',
    underlying: 'NVDA',
    anchorLongOccSymbol: 'NVDA  280121C00120000',
    anchorLongPositionKey: 'long-1',
    anchorLongQuantity: 3,
    inceptionDate: '2026-08-30',
    status: 'ACTIVE_PMCC',
    allocations: [{
      id: 'alloc-1', campaignId: 'campaign-1', accountNumber: 'acct-1',
      longOccSymbol: 'NVDA  280121C00120000', shortOccSymbol: 'NVDA  261016C00200000',
      allocatedLongQuantity: 2, allocatedShortQuantity: 2, status: 'ACTIVE', createdAt: '2026-08-30T12:00:00Z',
    }],
    shortCallCycles: [
      { id: 'cycle-old', campaignId: 'campaign-1', shortOccSymbol: 'NVDA  260918C00195000', quantity: 2, openedAt: '2026-07-01', closedAt: '2026-08-01', realizedPnl: 1800, closureMechanism: 'CLOSED' },
    ],
    historicalAttributionComplete: true,
    updatedAt: '2026-08-30T12:00:00Z',
    ...overrides,
  };
}

describe('PMCC Positions integration', () => {
  it('associates exact account/OCC identities and preserves current vs lifetime economics', () => {
    const result = buildPmccCampaignViewModels([
      position({ key: 'long-1', occ: 'NVDA  280121C00120000', direction: 'Long', quantity: 3, dte: 500, closeNowPnl: 2400 }),
      position({ key: 'short-1', occ: 'NVDA  261016C00200000', direction: 'Short', quantity: 2, dte: 47, closeNowPnl: -350 }),
    ], [campaign()]);

    expect(result).toHaveLength(1);
    expect(result[0].relationshipVerified).toBe(true);
    expect(result[0].allocatedShortQuantity).toBe(2);
    expect(result[0].unencumberedLongQuantity).toBe(1);
    expect(result[0].realizedPmccIncome).toBe(1800);
    expect(result[0].currentPmccExposurePnl).toBe(-350);
    expect(result[0].netProfitIfFullyExitedNow).toBe(2050);
    expect(result[0].lifetimeStrategyPnl).toBe(3850);
  });

  it('does not associate a same-ticker short call with a different OCC identity', () => {
    const result = buildPmccCampaignViewModels([
      position({ key: 'long-1', occ: 'NVDA  280121C00120000', direction: 'Long', quantity: 3, dte: 500, closeNowPnl: 2400 }),
      position({ key: 'short-other', occ: 'NVDA  261016C00210000', direction: 'Short', quantity: 2, dte: 47, closeNowPnl: 100 }),
    ], [campaign()]);

    expect(result[0].relationshipVerified).toBe(false);
    expect(result[0].activeShortCalls[0].positionKey).toBeNull();
    expect(result[0].netProfitIfFullyExitedNow).toBeNull();
  });

  it('fails closed when campaign status requires reconciliation', () => {
    const result = buildPmccCampaignViewModels([
      position({ key: 'long-1', occ: 'NVDA  280121C00120000', direction: 'Long', quantity: 3, dte: 500, closeNowPnl: 2400 }),
      position({ key: 'short-1', occ: 'NVDA  261016C00200000', direction: 'Short', quantity: 2, dte: 47, closeNowPnl: -350 }),
    ], [campaign({ status: 'RECONCILIATION_REQUIRED' })]);

    expect(result[0].relationshipVerified).toBe(false);
    expect(result[0].blockingReason).toContain('reconciliation');
    expect(result[0].netProfitIfFullyExitedNow).toBeNull();
  });

  it('withholds lifetime P&L when historical attribution is incomplete', () => {
    const result = buildPmccCampaignViewModels([
      position({ key: 'long-1', occ: 'NVDA  280121C00120000', direction: 'Long', quantity: 3, dte: 500, closeNowPnl: 2400 }),
      position({ key: 'short-1', occ: 'NVDA  261016C00200000', direction: 'Short', quantity: 2, dte: 47, closeNowPnl: -350 }),
    ], [campaign({ historicalAttributionComplete: false })]);

    expect(result[0].netProfitIfFullyExitedNow).toBe(2050);
    expect(result[0].realizedPmccIncome).toBeNull();
    expect(result[0].lifetimeStrategyPnl).toBeNull();
  });
});
