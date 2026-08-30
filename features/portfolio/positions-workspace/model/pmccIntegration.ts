import type { Position } from '@/lib/portfolio-data/types';
import type { PmccCampaign } from '@/lib/portfolio/pmccCampaign';
import { computePmccCampaignEconomics } from '@/lib/portfolio/pmccCampaign';
import { isStandaloneLeapsPosition } from '@/lib/portfolio/leapsPositionIntelligence';

export interface PmccShortCallViewModel {
  allocationId: string;
  shortOccSymbol: string;
  allocatedQuantity: number;
  liveQuantity: number | null;
  positionKey: string | null;
  closeNowPnl: number | null;
  relationshipVerified: boolean;
}

export interface PmccCampaignViewModel {
  campaignId: string;
  status: PmccCampaign['status'];
  accountNumber: string;
  underlying: string;
  longOccSymbol: string;
  longPositionKey: string | null;
  longQuantity: number | null;
  allocatedShortQuantity: number;
  unencumberedLongQuantity: number | null;
  activeShortCalls: PmccShortCallViewModel[];
  realizedPmccIncome: number | null;
  currentPmccExposurePnl: number | null;
  netProfitIfFullyExitedNow: number | null;
  lifetimeStrategyPnl: number | null;
  relationshipVerified: boolean;
  blockingReason: string | null;
}

function normalizeOcc(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

function exactSingleLegOcc(position: Position): string | null {
  if (position.structureAmbiguous || position.legs.length !== 1) return null;
  const symbol = position.legs[0]?.symbol;
  return symbol?.trim() ? normalizeOcc(symbol) : null;
}

function liveShortQuantity(position: Position): number | null {
  if (position.structureAmbiguous || position.legs.length !== 1) return null;
  const leg = position.legs[0];
  if (leg.direction !== 'Short' || leg.optionType !== 'C') return null;
  return Number.isFinite(leg.quantity) && leg.quantity >= 0 ? leg.quantity : null;
}

function activeCycleRealizedPnl(campaign: PmccCampaign): Array<number | null | undefined> {
  return campaign.shortCallCycles
    .filter(cycle => cycle.closedAt != null || cycle.closureMechanism != null)
    .map(cycle => cycle.realizedPnl);
}

export function buildPmccCampaignViewModels(
  positions: readonly Position[],
  campaigns: readonly PmccCampaign[],
): PmccCampaignViewModel[] {
  return campaigns.map(campaign => {
    const longOcc = normalizeOcc(campaign.anchorLongOccSymbol);
    const accountPositions = positions.filter(position => position.accountNumber === campaign.accountNumber);
    const longCandidates = accountPositions.filter(position =>
      isStandaloneLeapsPosition(position) && exactSingleLegOcc(position) === longOcc
    );
    const longPosition = longCandidates.length === 1 ? longCandidates[0] : null;
    const activeAllocations = campaign.allocations.filter(allocation => allocation.status === 'ACTIVE');
    const activeShortCalls: PmccShortCallViewModel[] = activeAllocations.map(allocation => {
      const shortOcc = normalizeOcc(allocation.shortOccSymbol);
      const matches = accountPositions.filter(position => exactSingleLegOcc(position) === shortOcc);
      const shortPosition = matches.length === 1 ? matches[0] : null;
      const quantity = shortPosition ? liveShortQuantity(shortPosition) : null;
      const relationshipVerified = Boolean(
        shortPosition
        && quantity != null
        && normalizeOcc(allocation.longOccSymbol) === longOcc
        && allocation.accountNumber === campaign.accountNumber
      );
      return {
        allocationId: allocation.id,
        shortOccSymbol: allocation.shortOccSymbol,
        allocatedQuantity: allocation.allocatedShortQuantity,
        liveQuantity: quantity,
        positionKey: shortPosition?.key ?? null,
        closeNowPnl: relationshipVerified && typeof shortPosition?.closeNowPnl === 'number' && Number.isFinite(shortPosition.closeNowPnl)
          ? shortPosition.closeNowPnl
          : null,
        relationshipVerified,
      };
    });

    const allocatedShortQuantity = activeAllocations.reduce((sum, allocation) =>
      Number.isFinite(allocation.allocatedShortQuantity) && allocation.allocatedShortQuantity > 0
        ? sum + allocation.allocatedShortQuantity
        : sum,
    0);
    const longQuantity = longPosition && Number.isFinite(longPosition.legs[0]?.quantity)
      ? longPosition.legs[0].quantity
      : null;
    const unencumberedLongQuantity = longQuantity == null ? null : Math.max(0, longQuantity - allocatedShortQuantity);

    const unresolvedByStatus = campaign.status === 'RELATIONSHIP_UNRESOLVED' || campaign.status === 'RECONCILIATION_REQUIRED';
    const longIdentityVerified = longCandidates.length === 1;
    const shortsVerified = activeShortCalls.every(short => short.relationshipVerified);
    const relationshipVerified = !unresolvedByStatus && longIdentityVerified && shortsVerified;

    let blockingReason: string | null = null;
    if (campaign.status === 'RECONCILIATION_REQUIRED') blockingReason = 'PMCC relationship requires broker reconciliation.';
    else if (campaign.status === 'RELATIONSHIP_UNRESOLVED') blockingReason = 'PMCC relationship is unresolved.';
    else if (longCandidates.length === 0) blockingReason = 'Allocated LEAPS contract is not present in the current brokerage positions.';
    else if (longCandidates.length > 1) blockingReason = 'Allocated LEAPS identity is not unique in the current brokerage positions.';
    else if (!shortsVerified) blockingReason = 'One or more allocated PMCC short calls cannot be verified against current brokerage positions.';

    const economics = computePmccCampaignEconomics({
      leapsCloseNowPnl: relationshipVerified ? longPosition?.closeNowPnl : null,
      realizedShortCallPnl: campaign.historicalAttributionComplete ? activeCycleRealizedPnl(campaign) : [null],
      currentShortCallCloseNowPnl: relationshipVerified ? activeShortCalls.map(short => short.closeNowPnl) : [null],
    });

    return {
      campaignId: campaign.id,
      status: campaign.status,
      accountNumber: campaign.accountNumber,
      underlying: campaign.underlying,
      longOccSymbol: campaign.anchorLongOccSymbol,
      longPositionKey: longPosition?.key ?? null,
      longQuantity,
      allocatedShortQuantity,
      unencumberedLongQuantity,
      activeShortCalls,
      realizedPmccIncome: economics.realizedPmccIncome,
      currentPmccExposurePnl: economics.currentPmccExposurePnl,
      netProfitIfFullyExitedNow: economics.netProfitIfFullyExitedNow,
      lifetimeStrategyPnl: economics.lifetimeStrategyPnl,
      relationshipVerified,
      blockingReason,
    };
  });
}

export function pmccCampaignForLongPosition(
  position: Position,
  campaignViews: readonly PmccCampaignViewModel[],
): PmccCampaignViewModel | null {
  const matches = campaignViews.filter(campaign => campaign.longPositionKey === position.key);
  return matches.length === 1 ? matches[0] : null;
}
