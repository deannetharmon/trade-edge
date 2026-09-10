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

export type PendingEntryExecutionDecision =
  | 'RESOLVE_BROKER_STATUS'
  | 'NO_PRICE_CHANGE_NEEDED'
  | 'REPRICE_AVAILABLE'
  | 'REVIEW_PARTIAL_EXECUTION'
  | 'QUOTE_UNAVAILABLE'
  | 'REVIEW_MANUALLY';

export interface PendingEntryAssessment {
  state: PendingEntryState;
  recommendation: PendingEntryRecommendation;
  stateLabel: string;
  recommendationLabel: string;
  executionDecision: PendingEntryExecutionDecision;
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
      executionDecision: 'REVIEW_PARTIAL_EXECUTION',
      explanation: 'Some contracts filled. Confirm the broker order detail before changing or cancelling the remainder.',
    };
  }
  if (['working', 'live', 'routed'].includes(status)) {
    const hasQuote = order.quoteQuality === 'RELIABLE' && order.currentExecutablePrice != null;
    const priceEffect = order.priceEffect;
    const requestedIsOutsideMarket = hasQuote && order.limitPrice != null && (
      priceEffect === 'Credit'
        ? order.limitPrice > order.currentExecutablePrice!
        : priceEffect === 'Debit'
          ? order.limitPrice < order.currentExecutablePrice!
          : false
    );
    if (!hasQuote || order.limitPrice == null || !['Credit', 'Debit'].includes(priceEffect ?? '')) {
      return {
        state: 'LIVE_AT_EXCHANGE', recommendation: 'REVIEW_MANUALLY',
        stateLabel: 'Live at Exchange', recommendationLabel: 'Quote Unavailable',
        executionDecision: 'QUOTE_UNAVAILABLE',
        explanation: 'A fresh two-sided quote and a valid price effect are required before evaluating a price change.',
      };
    }
    return {
      state: 'LIVE_AT_EXCHANGE', recommendation: requestedIsOutsideMarket ? 'REVIEW_PRICE' : 'KEEP_WORKING',
      stateLabel: 'Live at Exchange', recommendationLabel: requestedIsOutsideMarket ? 'Reprice Available' : 'No Price Change Needed',
      executionDecision: requestedIsOutsideMarket ? 'REPRICE_AVAILABLE' : 'NO_PRICE_CHANGE_NEEDED',
      explanation: requestedIsOutsideMarket
        ? `The best immediately executable ${priceEffect!.toLowerCase()} is $${order.currentExecutablePrice!.toFixed(2)}. Your $${order.limitPrice.toFixed(2)} limit may continue working instead of filling.`
        : `Your $${order.limitPrice.toFixed(2)} ${priceEffect!.toLowerCase()} limit is already immediately executable against the current natural-side reference of $${order.currentExecutablePrice!.toFixed(2)}.`,
    };
  }
  if (['contingent', 'pending'].includes(status)) {
    return {
      state: 'CONTINGENT', recommendation: 'KEEP_WORKING',
      stateLabel: 'Contingent', recommendationLabel: 'Keep Working',
      executionDecision: 'RESOLVE_BROKER_STATUS',
      explanation: 'This order is waiting on its related broker order; it is not a filled position.',
    };
  }
  if (['received', 'queued', 'new'].includes(status)) {
    return {
      state: 'SUBMISSION_IN_PROGRESS', recommendation: 'KEEP_WORKING',
      stateLabel: 'Submission in Progress', recommendationLabel: 'Resolve Broker Status',
      executionDecision: 'RESOLVE_BROKER_STATUS',
      explanation: 'The broker has received the order but has not yet reported it live at the exchange.',
    };
  }
  return {
    state: 'SUBMISSION_UNKNOWN', recommendation: 'REVIEW_MANUALLY',
    stateLabel: 'Submission Unknown', recommendationLabel: 'Review Manually',
    executionDecision: 'REVIEW_MANUALLY',
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
