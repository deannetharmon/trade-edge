// lib/scans/pmccReviewHandoff.ts

export const PMCC_REVIEW_HANDOFF_STORAGE_KEY = 'trade-edge:pmcc-review-handoff:v1';
export const PMCC_REVIEW_LAUNCH_URL = '/screener?launch=pmcc-held';

/** Exact broker position identity carried from Portfolio to the existing
 * Screener PMCC flow.  A ticker alone is never enough: a trader can hold
 * several LEAPS contracts for one symbol. */
export interface PmccReviewHandoff {
  accountNumber: string;
  positionKey: string;
  underlyingSymbol: string;
  occSymbol: string;
}

export function isPmccReviewHandoff(value: unknown): value is PmccReviewHandoff {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return ['accountNumber', 'positionKey', 'underlyingSymbol', 'occSymbol']
    .every(key => {
      const field = candidate[key];
      return typeof field === 'string' && field.trim().length > 0;
    });
}

export interface PmccReviewLaunchTarget {
  accountNumber: string | null;
  positionKey: string | null;
  symbol: string;
  exactContract: string | null;
}

export interface PmccReviewLaunchDeps {
  setItem: (key: string, value: string) => void;
  navigate: (url: string) => void;
}

/**
 * SUGGESTED-ACTIONS-0001 slice 5: the one place that opens the existing Screener PMCC short-call
 * review for an exact held LEAPS. Portfolio and the dashboard card both call it. Returns false (and
 * does nothing) unless the exact account, position and contract are all known.
 */
export function launchPmccShortCallReview(
  target: PmccReviewLaunchTarget,
  deps: PmccReviewLaunchDeps = {
    setItem: (key, value) => sessionStorage.setItem(key, value),
    navigate: url => window.location.assign(url),
  },
): boolean {
  if (!target.accountNumber || !target.positionKey || !target.exactContract) return false;
  const handoff: PmccReviewHandoff = {
    accountNumber: target.accountNumber,
    positionKey: target.positionKey,
    underlyingSymbol: target.symbol,
    occSymbol: target.exactContract,
  };
  deps.setItem(PMCC_REVIEW_HANDOFF_STORAGE_KEY, JSON.stringify(handoff));
  deps.navigate(PMCC_REVIEW_LAUNCH_URL);
  return true;
}
