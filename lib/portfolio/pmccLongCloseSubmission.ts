import type { CanonicalCloseIdentity } from './closeOrderSafety';
import type { PmccCampaign, PmccCoverageEvaluation } from './pmccCampaign';
import { evaluatePmccCoverageAfterLongChange } from './pmccCampaign';
import { fetchPmccCampaignLoadResult, type PmccCampaignLoadResult } from '@/lib/portfolio-data/pmccCampaignStore';
import { fetchPmccBrokerCoverageState, type PmccBrokerCoverageState } from '@/lib/portfolio-data/pmccCoverageBrokerState';

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
 * Submission-time campaign + broker revalidation for a canonical single long
 * call. The durable campaign store is re-read first to resolve exact strategy
 * intent. If an active campaign exists, the campaign's brokerage account is
 * then re-read for the exact allocated long and short OCC quantities.
 *
 * This is intentionally two-source safety: campaign allocation defines which
 * contracts belong to the PMCC; current broker positions define the quantities
 * that actually exist at transmission time. No same-ticker substitute coverage
 * is inferred. Any unavailable or ambiguous evidence fails closed.
 */
export async function revalidatePersistedPmccLongClose(input: {
  identity: CanonicalCloseIdentity;
  currentLongQuantity: number;
  proposedLongQuantityAfterAction: number;
  loadCampaigns?: () => Promise<PmccCampaignLoadResult>;
  loadBrokerCoverage?: (campaign: PmccCampaign) => Promise<PmccBrokerCoverageState>;
}): Promise<PersistedPmccLongCloseGuardResult> {
  const longOccSymbol = singleLongCallOcc(input.identity);
  if (!longOccSymbol) return { required: false, safe: true, reason: null, coverage: null, campaignId: null };

  const requestedQuantity = input.currentLongQuantity - input.proposedLongQuantityAfterAction;
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    return { required: true, safe: false, reason: 'Requested LEAPS close quantity is invalid for PMCC revalidation.', coverage: null, campaignId: null };
  }

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
  const loadBrokerCoverage = input.loadBrokerCoverage ?? fetchPmccBrokerCoverageState;
  const broker = await loadBrokerCoverage(campaign);
  if (broker.status !== 'ok') {
    return {
      required: true,
      safe: false,
      reason: `Current PMCC brokerage coverage is unavailable — ${broker.reason}`,
      coverage: null,
      campaignId: campaign.id,
    };
  }

  const proposedLongQuantityAfterAction = broker.currentLongQuantity - requestedQuantity;
  const coverage = evaluatePmccCoverageAfterLongChange({
    campaign,
    longOccSymbol: campaign.anchorLongOccSymbol,
    currentLongQuantity: broker.currentLongQuantity,
    proposedLongQuantityAfterAction,
    activeShortQuantities: broker.activeShortQuantities,
  });
  return {
    required: true,
    safe: coverage.safe,
    reason: coverage.safe ? null : coverage.blockingReason ?? 'PMCC coverage would be unsafe after this LEAPS close.',
    coverage,
    campaignId: campaign.id,
  };
}
