import { captureConfirmedCreditSpreadEntry } from './capture';
import type { PendingCreditSpreadEntry } from './pending';
import { confirmedOpeningTransactionIds, confirmedOpeningTransactionIdsForOrderIds, type BrokerTransactionIdentity } from './reconcile';
import type { CreditSpreadEntrySnapshot } from './types';
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
