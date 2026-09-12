import { captureConfirmedCreditSpreadEntry, captureConfirmedIronCondorEntry } from './capture';
import type { PendingCreditSpreadEntry, PendingIronCondorEntry } from './pending';
import { confirmedOpeningTransactionIds, confirmedOpeningTransactionIdsForOrderIds, type BrokerTransactionIdentity } from './reconcile';
import type { CreditSpreadEntrySnapshot, IronCondorEntrySnapshot } from './types';
import { saveImmutableEntrySnapshot } from './store';

/** Returns null until all expected broker opening fills are confirmed. */
export function promotePendingEntryOnConfirmedFills(
  pending: PendingCreditSpreadEntry,
  openingTransactionIds: string[],
  transactions: BrokerTransactionIdentity[],
): CreditSpreadEntrySnapshot | null {
  const confirmed = pending.openingOrderIds.length > 0
    ? confirmedOpeningTransactionIdsForOrderIds(pending.openingOrderIds, transactions)
    : confirmedOpeningTransactionIds({ accountId: pending.accountId, openingTransactionIds }, transactions);
  if (!confirmed) return null;
  const primary = transactions.find(tx => String(tx.id) === confirmed[0]);
  const executedAt = primary?.['executed-at'];
  if (!executedAt) return null;
  return captureConfirmedCreditSpreadEntry({
    ...pending,
    transactionId: confirmed[0],
    sourceTransactionIds: confirmed,
    executedAt,
    tradeGroupId: pending.brokerOrderId,
  });
}

export async function persistPromotedPendingEntry(
  pending: PendingCreditSpreadEntry,
  openingTransactionIds: string[],
  transactions: BrokerTransactionIdentity[],
  storageAccountId?: string,
): Promise<{ snapshot: CreditSpreadEntrySnapshot; created: boolean } | null> {
  const snapshot = promotePendingEntryOnConfirmedFills(pending, openingTransactionIds, transactions);
  return snapshot ? saveImmutableEntrySnapshot(snapshot, undefined, storageAccountId) : null;
}

// TRADE-ENTRY-SNAPSHOT-0001 -- Iron Condor's own promote functions,
// parallel to the BPS/BCS ones above. reconcile.ts's transaction-matching
// functions are strategy-agnostic (pure transaction/order-id logic), so
// they're reused directly -- no IC-specific reconciliation needed.
export function promotePendingIronCondorEntryOnConfirmedFills(
  pending: PendingIronCondorEntry,
  openingTransactionIds: string[],
  transactions: BrokerTransactionIdentity[],
): IronCondorEntrySnapshot | null {
  const confirmed = pending.openingOrderIds.length > 0
    ? confirmedOpeningTransactionIdsForOrderIds(pending.openingOrderIds, transactions)
    : confirmedOpeningTransactionIds({ accountId: pending.accountId, openingTransactionIds }, transactions);
  if (!confirmed) return null;
  const primary = transactions.find(tx => String(tx.id) === confirmed[0]);
  const executedAt = primary?.['executed-at'];
  if (!executedAt) return null;
  return captureConfirmedIronCondorEntry({
    ...pending,
    transactionId: confirmed[0],
    sourceTransactionIds: confirmed,
    executedAt,
    tradeGroupId: pending.brokerOrderId,
  });
}

export async function persistPromotedPendingIronCondorEntry(
  pending: PendingIronCondorEntry,
  openingTransactionIds: string[],
  transactions: BrokerTransactionIdentity[],
  storageAccountId?: string,
): Promise<{ snapshot: IronCondorEntrySnapshot; created: boolean } | null> {
  const snapshot = promotePendingIronCondorEntryOnConfirmedFills(pending, openingTransactionIds, transactions);
  return snapshot ? saveImmutableEntrySnapshot(snapshot, undefined, storageAccountId) : null;
}
