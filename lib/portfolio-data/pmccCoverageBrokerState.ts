import { getAccessToken, ttFetch } from '@/lib/tastytrade/client';
import type { PmccCampaign } from '@/lib/portfolio/pmccCampaign';

export type PmccBrokerCoverageState =
  | {
      status: 'ok';
      currentLongQuantity: number;
      activeShortQuantities: Record<string, number>;
      reason: null;
    }
  | {
      status: 'unavailable';
      currentLongQuantity: null;
      activeShortQuantities: Record<string, number>;
      reason: string;
    };

function normalizeOcc(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Re-reads broker positions for the campaign's exact brokerage account and
 * extracts only the explicitly allocated OCC identities. No same-symbol,
 * strike-adjacent, share, or substitute-long inference is permitted here.
 */
export async function fetchPmccBrokerCoverageState(campaign: PmccCampaign): Promise<PmccBrokerCoverageState> {
  try {
    if (!campaign.accountNumber || !campaign.anchorLongOccSymbol) {
      return { status: 'unavailable', currentLongQuantity: null, activeShortQuantities: {}, reason: 'PMCC campaign account or LEAPS identity is missing.' };
    }

    const token = await getAccessToken();
    const response = await ttFetch(`/accounts/${campaign.accountNumber}/positions?include-marks=true`, token);
    const items = response?.data?.items;
    if (!Array.isArray(items)) {
      return { status: 'unavailable', currentLongQuantity: null, activeShortQuantities: {}, reason: 'Current brokerage positions are unavailable.' };
    }

    const longOcc = normalizeOcc(campaign.anchorLongOccSymbol);
    const activeAllocations = campaign.allocations.filter(allocation => allocation.status === 'ACTIVE');
    const shortOccs = new Set(activeAllocations.map(allocation => normalizeOcc(allocation.shortOccSymbol)).filter(Boolean));

    let currentLongQuantity = 0;
    const activeShortQuantities: Record<string, number> = {};
    for (const allocation of activeAllocations) activeShortQuantities[allocation.shortOccSymbol] = 0;

    for (const item of items) {
      const occ = normalizeOcc(item?.symbol);
      if (!occ) continue;
      const quantity = finiteNonNegative(item?.quantity);
      if (quantity == null) {
        if (occ === longOcc || shortOccs.has(occ)) {
          return { status: 'unavailable', currentLongQuantity: null, activeShortQuantities: {}, reason: `Broker quantity is invalid for allocated contract ${item?.symbol ?? occ}.` };
        }
        continue;
      }
      const direction = String(item?.['quantity-direction'] ?? '').toLowerCase();

      if (occ === longOcc) {
        if (direction !== 'long') {
          return { status: 'unavailable', currentLongQuantity: null, activeShortQuantities: {}, reason: 'Allocated LEAPS contract is no longer a long brokerage position.' };
        }
        currentLongQuantity += quantity;
      }

      if (shortOccs.has(occ)) {
        if (direction !== 'short') {
          return { status: 'unavailable', currentLongQuantity: null, activeShortQuantities: {}, reason: `Allocated PMCC short contract ${item?.symbol ?? occ} no longer has a short brokerage direction.` };
        }
        const allocation = activeAllocations.find(candidate => normalizeOcc(candidate.shortOccSymbol) === occ);
        if (allocation) activeShortQuantities[allocation.shortOccSymbol] = (activeShortQuantities[allocation.shortOccSymbol] ?? 0) + quantity;
      }
    }

    return { status: 'ok', currentLongQuantity, activeShortQuantities, reason: null };
  } catch (error) {
    return {
      status: 'unavailable',
      currentLongQuantity: null,
      activeShortQuantities: {},
      reason: error instanceof Error ? error.message : 'Unable to refresh PMCC brokerage coverage state.',
    };
  }
}
