import type { PendingOrder } from '@/lib/portfolio-data/types';

export type PendingEntryState =
  | 'LIVE_AT_EXCHANGE'
  | 'SUBMISSION_IN_PROGRESS'
  | 'CONTINGENT'
  | 'PARTIALLY_FILLED'
  | 'SUBMISSION_UNKNOWN';

export type PendingEntryRecommendation =
  | 'KEEP_WORKING'
  | 'REVIEW_PRICE'
  | 'REVIEW_MANUALLY';

export interface PendingEntryAssessment {
  state: PendingEntryState;
  recommendation: PendingEntryRecommendation;
  stateLabel: string;
  recommendationLabel: string;
  explanation: string;
}

/**
 * Maps the broker's raw lifecycle terminology to trader-facing state without
 * equating an exchange-live order with a fill.  Price advice deliberately
 * fails closed: PendingOrder has no executable quote evidence, so the app
 * asks for review rather than manufacturing a replacement price.
 */
export function assessPendingEntry(order: PendingOrder): PendingEntryAssessment {
  const status = order.status.trim().toLowerCase();
  if (order.filledQuantity != null && order.filledQuantity > 0) {
    return {
      state: 'PARTIALLY_FILLED', recommendation: 'REVIEW_MANUALLY',
      stateLabel: 'Partially Filled', recommendationLabel: 'Review Manually',
      explanation: 'Some contracts filled. Confirm the broker order detail before changing or cancelling the remainder.',
    };
  }
  if (['working', 'live', 'routed'].includes(status)) {
    return {
      state: 'LIVE_AT_EXCHANGE', recommendation: 'REVIEW_PRICE',
      stateLabel: 'Live at Exchange', recommendationLabel: 'Review Price',
      explanation: 'The broker reports this entry as live. A fresh executable quote is required before deciding whether to reprice it.',
    };
  }
  if (['contingent', 'pending'].includes(status)) {
    return {
      state: 'CONTINGENT', recommendation: 'KEEP_WORKING',
      stateLabel: 'Contingent', recommendationLabel: 'Keep Working',
      explanation: 'This order is waiting on its related broker order; it is not a filled position.',
    };
  }
  if (['received', 'queued', 'new'].includes(status)) {
    return {
      state: 'SUBMISSION_IN_PROGRESS', recommendation: 'KEEP_WORKING',
      stateLabel: 'Submission in Progress', recommendationLabel: 'Keep Working',
      explanation: 'The broker has received the order but has not yet reported it live at the exchange.',
    };
  }
  return {
    state: 'SUBMISSION_UNKNOWN', recommendation: 'REVIEW_MANUALLY',
    stateLabel: 'Submission Unknown', recommendationLabel: 'Review Manually',
    explanation: 'Refresh broker evidence before retrying, replacing, or cancelling this order.',
  };
}

export function groupPendingEntries(orders: PendingOrder[]): PendingOrder[][] {
  const groups = new Map<string, PendingOrder[]>();
  for (const order of orders) {
    const key = order.parentOrderId || order.id;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  }
  return Array.from(groups.values());
}
