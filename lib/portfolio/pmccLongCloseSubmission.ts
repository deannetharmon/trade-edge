import type { PmccCampaign, PmccCoverageEvaluation } from './pmccCampaign';
import { evaluatePmccCoverageAfterLongChange } from './pmccCampaign';

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
