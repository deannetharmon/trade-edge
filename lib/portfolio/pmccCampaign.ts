export type PmccCampaignStatus =
  | 'LEAPS_ONLY_PMCC_AVAILABLE'
  | 'ACTIVE_PMCC'
  | 'PMCC_ROLL_IN_PROGRESS'
  | 'RELATIONSHIP_UNRESOLVED'
  | 'RECONCILIATION_REQUIRED'
  | 'CAMPAIGN_CLOSED';

export type PmccAllocationStatus = 'ACTIVE' | 'RELEASED' | 'UNRESOLVED';

export interface PmccAllocation {
  id: string;
  campaignId: string;
  accountNumber: string;
  longOccSymbol: string;
  shortOccSymbol: string;
  allocatedLongQuantity: number;
  allocatedShortQuantity: number;
  status: PmccAllocationStatus;
  createdAt: string;
  releasedAt?: string | null;
}

export interface PmccShortCallCycle {
  id: string;
  campaignId: string;
  shortOccSymbol: string;
  quantity: number;
  openedAt: string;
  closedAt?: string | null;
  realizedPnl?: number | null;
  currentCloseNowPnl?: number | null;
  predecessorCycleId?: string | null;
  successorCycleId?: string | null;
  closureMechanism?: 'CLOSED' | 'PARTIAL_CLOSE' | 'ASSIGNED' | 'EXPIRED' | 'EXERCISED' | null;
}

export interface PmccCampaign {
  id: string;
  accountNumber: string;
  underlying: string;
  anchorLongOccSymbol: string;
  anchorLongPositionKey?: string | null;
  anchorLongQuantity: number;
  inceptionDate: string;
  status: PmccCampaignStatus;
  allocations: PmccAllocation[];
  shortCallCycles: PmccShortCallCycle[];
  historicalAttributionComplete: boolean;
  updatedAt: string;
}

export interface PmccCoverageEvaluationInput {
  campaign: PmccCampaign;
  longOccSymbol: string;
  currentLongQuantity: number;
  proposedLongQuantityAfterAction: number;
  activeShortQuantities?: Readonly<Record<string, number>>;
}

export interface PmccCoverageEvaluation {
  safe: boolean;
  blockingReason: string | null;
  requiredAllocatedLongQuantity: number;
  remainingLongQuantity: number;
  unresolved: boolean;
}

function activeAllocations(campaign: PmccCampaign, longOccSymbol: string): PmccAllocation[] {
  return campaign.allocations.filter(allocation =>
    allocation.status === 'ACTIVE'
    && allocation.longOccSymbol.replace(/\s+/g, '') === longOccSymbol.replace(/\s+/g, '')
  );
}

/**
 * PMCC coverage is strategy allocation, not broker buying-power inference.
 * This function deliberately ignores unrelated long calls and stock shares.
 */
export function evaluatePmccCoverageAfterLongChange(input: PmccCoverageEvaluationInput): PmccCoverageEvaluation {
  if (!Number.isFinite(input.currentLongQuantity) || input.currentLongQuantity < 0
      || !Number.isFinite(input.proposedLongQuantityAfterAction) || input.proposedLongQuantityAfterAction < 0) {
    return {
      safe: false,
      blockingReason: 'Unable to verify remaining LEAPS quantity.',
      requiredAllocatedLongQuantity: 0,
      remainingLongQuantity: Math.max(0, Number(input.proposedLongQuantityAfterAction) || 0),
      unresolved: true,
    };
  }

  if (input.campaign.status === 'RELATIONSHIP_UNRESOLVED' || input.campaign.status === 'RECONCILIATION_REQUIRED') {
    return {
      safe: false,
      blockingReason: 'PMCC relationship requires reconciliation before LEAPS coverage can be changed.',
      requiredAllocatedLongQuantity: 0,
      remainingLongQuantity: input.proposedLongQuantityAfterAction,
      unresolved: true,
    };
  }

  const allocations = activeAllocations(input.campaign, input.longOccSymbol);
  let requiredAllocatedLongQuantity = 0;
  for (const allocation of allocations) {
    if (!Number.isFinite(allocation.allocatedLongQuantity) || allocation.allocatedLongQuantity < 0
        || !Number.isFinite(allocation.allocatedShortQuantity) || allocation.allocatedShortQuantity < 0) {
      return {
        safe: false,
        blockingReason: 'PMCC allocation quantity is invalid or unresolved.',
        requiredAllocatedLongQuantity,
        remainingLongQuantity: input.proposedLongQuantityAfterAction,
        unresolved: true,
      };
    }
    const liveShortQty = input.activeShortQuantities?.[allocation.shortOccSymbol];
    const shortQty = liveShortQty == null ? allocation.allocatedShortQuantity : liveShortQty;
    if (!Number.isFinite(shortQty) || shortQty < 0) {
      return {
        safe: false,
        blockingReason: 'Current PMCC short-call quantity cannot be verified.',
        requiredAllocatedLongQuantity,
        remainingLongQuantity: input.proposedLongQuantityAfterAction,
        unresolved: true,
      };
    }
    requiredAllocatedLongQuantity += shortQty;
  }

  if (input.proposedLongQuantityAfterAction < requiredAllocatedLongQuantity) {
    return {
      safe: false,
      blockingReason: `This action would leave ${requiredAllocatedLongQuantity} active PMCC short-call contract${requiredAllocatedLongQuantity === 1 ? '' : 's'} with only ${input.proposedLongQuantityAfterAction} allocated LEAPS contract${input.proposedLongQuantityAfterAction === 1 ? '' : 's'} remaining.`,
      requiredAllocatedLongQuantity,
      remainingLongQuantity: input.proposedLongQuantityAfterAction,
      unresolved: false,
    };
  }

  return {
    safe: true,
    blockingReason: null,
    requiredAllocatedLongQuantity,
    remainingLongQuantity: input.proposedLongQuantityAfterAction,
    unresolved: false,
  };
}

export interface PmccCampaignEconomicsInput {
  leapsCloseNowPnl: number | null | undefined;
  realizedShortCallPnl: Array<number | null | undefined>;
  currentShortCallCloseNowPnl: Array<number | null | undefined>;
}

export interface PmccCampaignEconomics {
  realizedPmccIncome: number | null;
  currentPmccExposurePnl: number | null;
  netProfitIfFullyExitedNow: number | null;
  lifetimeStrategyPnl: number | null;
}

function sumComplete(values: Array<number | null | undefined>): number | null {
  let total = 0;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

export function computePmccCampaignEconomics(input: PmccCampaignEconomicsInput): PmccCampaignEconomics {
  const realizedPmccIncome = sumComplete(input.realizedShortCallPnl);
  const currentPmccExposurePnl = sumComplete(input.currentShortCallCloseNowPnl);
  const leaps = typeof input.leapsCloseNowPnl === 'number' && Number.isFinite(input.leapsCloseNowPnl)
    ? input.leapsCloseNowPnl
    : null;
  const netProfitIfFullyExitedNow = leaps != null && currentPmccExposurePnl != null
    ? leaps + currentPmccExposurePnl
    : null;
  const lifetimeStrategyPnl = leaps != null && realizedPmccIncome != null && currentPmccExposurePnl != null
    ? leaps + realizedPmccIncome + currentPmccExposurePnl
    : null;
  return { realizedPmccIncome, currentPmccExposurePnl, netProfitIfFullyExitedNow, lifetimeStrategyPnl };
}

export function nextPmccStatusAfterShortCycle(input: {
  currentStatus: PmccCampaignStatus;
  closureMechanism: PmccShortCallCycle['closureMechanism'];
  remainingActiveShortQuantity: number;
}): PmccCampaignStatus {
  if (input.closureMechanism === 'ASSIGNED' || input.closureMechanism === 'EXERCISED') return 'RECONCILIATION_REQUIRED';
  if (!Number.isFinite(input.remainingActiveShortQuantity) || input.remainingActiveShortQuantity < 0) return 'RELATIONSHIP_UNRESOLVED';
  if (input.remainingActiveShortQuantity > 0) return 'ACTIVE_PMCC';
  if (input.currentStatus === 'CAMPAIGN_CLOSED') return 'CAMPAIGN_CLOSED';
  return 'LEAPS_ONLY_PMCC_AVAILABLE';
}
