import type { ConfirmedOpeningExecution, ConfirmedOpeningIronCondorExecution } from './capture';

/** Entry evidence captured at submission, deliberately not yet a trade snapshot. */
export interface PendingCreditSpreadEntry extends Omit<ConfirmedOpeningExecution, 'transactionId' | 'executedAt'> {
  brokerOrderId: string;
  /** Component order ids returned by the broker's complex-order acknowledgement. */
  openingOrderIds: string[];
  submittedAt: string;
}

export function createPendingCreditSpreadEntry(input: PendingCreditSpreadEntry): PendingCreditSpreadEntry {
  if (!input.accountId || !input.brokerOrderId || !input.submittedAt || input.openingOrderIds.length === 0) {
    throw new Error('accountId, brokerOrderId, component order ids, and submittedAt are required for pending entry evidence');
  }
  if ((input.strategy !== 'BPS' && input.strategy !== 'BCS') || !input.symbol || !input.expiration
    || !Number.isFinite(input.shortStrike) || !Number.isFinite(input.longStrike)
    || !Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('Valid credit-spread structure is required for pending entry evidence');
  }
  return Object.freeze({ ...input });
}

// TRADE-ENTRY-SNAPSHOT-0001 -- Iron Condor's own pending-entry type,
// parallel to PendingCreditSpreadEntry.
export interface PendingIronCondorEntry extends Omit<ConfirmedOpeningIronCondorExecution, 'transactionId' | 'executedAt'> {
  brokerOrderId: string;
  openingOrderIds: string[];
  submittedAt: string;
}

export function createPendingIronCondorEntry(input: PendingIronCondorEntry): PendingIronCondorEntry {
  if (!input.accountId || !input.brokerOrderId || !input.submittedAt || input.openingOrderIds.length === 0) {
    throw new Error('accountId, brokerOrderId, component order ids, and submittedAt are required for pending entry evidence');
  }
  if (input.strategy !== 'IC' || !input.symbol || !input.expiration
    || !Number.isFinite(input.putShortStrike) || !Number.isFinite(input.putLongStrike)
    || !Number.isFinite(input.callShortStrike) || !Number.isFinite(input.callLongStrike)
    || !Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('Valid iron-condor structure is required for pending entry evidence');
  }
  return Object.freeze({ ...input });
}
