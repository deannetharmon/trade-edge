export const PMCC_REVIEW_HANDOFF_STORAGE_KEY = 'trade-edge:pmcc-review-handoff:v1';

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
