import type { CanonicalCloseIdentity } from './closeOrderSafety';
import type { PmccCampaign, PmccCoverageEvaluation } from './pmccCampaign';
import { evaluatePmccCoverageAfterLongChange } from './pmccCampaign';
import { fetchPmccCampaignLoadResult, type PmccCampaignLoadResult } from '@/lib/portfolio-data/pmccCampaignStore';

export interface PmccLongCloseSubmissionInput<T> {
  campaign: PmccCampaign;
  longOccSymbol: string;
  currentLongQuantity: number;
  proposedLongQuantityAfterAction: number;
  activeShortQuantities: Readonly<Record<string, number>>;
  submit: () => Promise<T>;
}

export type PmccLongCloseSubmissionResult<T> =
  | { submitted: true; value: T; coverage: PmccCoverageEvaluation }
  | { submitted: false; value: null; coverage: PmccCoverageEvaluation };

/**
 * Final PMCC coverage invariant at the broker boundary.
 *
 * The caller must supply freshly observed long/short quantities immediately
 * before invoking this function. The broker submission callback is reachable
 * only when the authoritative campaign allocation remains safe after the
 * proposed long-call reduction. This intentionally does not infer substitute
 * coverage from shares or another same-ticker long call.
 */
export async function submitPmccLongCloseIfSafe<T>(
  input: PmccLongCloseSubmissionInput<T>,
): Promise<PmccLongCloseSubmissionResult<T>> {
  const coverage = evaluatePmccCoverageAfterLongChange({
    campaign: input.campaign,
    longOccSymbol: input.longOccSymbol,
    currentLongQuantity: input.currentLongQuantity,
    proposedLongQuantityAfterAction: input.proposedLongQuantityAfterAction,
    activeShortQuantities: input.activeShortQuantities,
  });

  if (!coverage.safe) return { submitted: false, value: null, coverage };
  const value = await input.submit();
  return { submitted: true, value, coverage };
}

export interface PersistedPmccLongCloseGuardResult {
  required: boolean;
  safe: boolean;
  reason: string | null;
  coverage: PmccCoverageEvaluation | null;
  campaignId: string | null;
}

function normalizeOcc(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

function singleLongCallOcc(identity: CanonicalCloseIdentity): string | null {
  if (identity.legs.length !== 1) return null;
  const leg = identity.legs[0];
  if (leg.direction !== 'Long' || leg.optionType !== 'C') return null;
  return leg.symbol?.trim() ? normalizeOcc(leg.symbol) : null;
}

/**
 * Submission-time campaign revalidation for a canonical single long call.
 * The campaign store is re-read immediately before broker transmission so a
 * relationship/allocation change after UI review cannot be bypassed.
 *
 * Exact account identity is not carried by CanonicalCloseIdentity. Therefore
 * duplicate campaign matches for the same OCC contract fail closed rather
 * than guessing which account relationship applies. The authoritative
 * campaign allocation quantity is enforced here; live broker quantity
 * reconciliation remains a caller responsibility when available.
 */
export async function revalidatePersistedPmccLongClose(input: {
  identity: CanonicalCloseIdentity;
  currentLongQuantity: number;
  proposedLongQuantityAfterAction: number;
  loadCampaigns?: () => Promise<PmccCampaignLoadResult>;
}): Promise<PersistedPmccLongCloseGuardResult> {
  const longOccSymbol = singleLongCallOcc(input.identity);
  if (!longOccSymbol) return { required: false, safe: true, reason: null, coverage: null, campaignId: null };

  const loadCampaigns = input.loadCampaigns ?? fetchPmccCampaignLoadResult;
  const loaded = await loadCampaigns();
  if (loaded.status !== 'ok') {
    return {
      required: true,
      safe: false,
      reason: `PMCC campaign state unavailable — ${loaded.reason}`,
      coverage: null,
      campaignId: null,
    };
  }

  const matching = Object.values(loaded.campaigns).filter(campaign =>
    normalizeOcc(campaign.anchorLongOccSymbol) === longOccSymbol
    && campaign.status !== 'CAMPAIGN_CLOSED'
  );
  if (matching.length === 0) return { required: false, safe: true, reason: null, coverage: null, campaignId: null };
  if (matching.length !== 1) {
    return {
      required: true,
      safe: false,
      reason: 'PMCC campaign identity is ambiguous across accounts; reconcile the relationship before closing this LEAPS.',
      coverage: null,
      campaignId: null,
    };
  }

  const campaign = matching[0];
  const coverage = evaluatePmccCoverageAfterLongChange({
    campaign,
    longOccSymbol: campaign.anchorLongOccSymbol,
    currentLongQuantity: input.currentLongQuantity,
    proposedLongQuantityAfterAction: input.proposedLongQuantityAfterAction,
  });
  return {
    required: true,
    safe: coverage.safe,
    reason: coverage.safe ? null : coverage.blockingReason ?? 'PMCC coverage would be unsafe after this LEAPS close.',
    coverage,
    campaignId: campaign.id,
  };
}
