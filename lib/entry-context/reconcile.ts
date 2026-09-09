/** Exact broker transaction linkage only. Symbol/time proximity is never enough. */
export interface PendingCreditSpreadEntry {
  accountId: string;
  openingTransactionIds: string[];
}

export interface BrokerTransactionIdentity {
  id: string | number | null | undefined;
  ['order-id']?: string | number | null;
  ['transaction-type']?: string;
  ['executed-at']?: string;
}

/**
 * Tastytrade transaction `order-id` is the durable bridge to a component
 * order returned by a complex-order acknowledgement.  Deliberately do not
 * fall back to symbol, strike, date, or price proximity.
 */
export function confirmedOpeningTransactionIdsForOrderIds(
  openingOrderIds: string[],
  transactions: BrokerTransactionIdentity[],
): string[] | null {
  const expected = Array.from(new Set(openingOrderIds.map(String).filter(Boolean)));
  if (expected.length === 0) return null;
  const byOrderId = new Map<string, string[]>();
  for (const tx of transactions) {
    if (tx['transaction-type'] !== 'Trade' || tx.id == null || !tx['executed-at'] || tx['order-id'] == null) continue;
    const key = String(tx['order-id']);
    byOrderId.set(key, [...(byOrderId.get(key) ?? []), String(tx.id)]);
  }
  if (!expected.every(orderId => (byOrderId.get(orderId)?.length ?? 0) > 0)) return null;
  return expected.flatMap(orderId => byOrderId.get(orderId) ?? []);
}

export function confirmedOpeningTransactionIds(
  pending: PendingCreditSpreadEntry,
  transactions: BrokerTransactionIdentity[],
): string[] | null {
  if (pending.openingTransactionIds.length === 0) return null;
  const confirmed = new Set(
    transactions
      .filter(tx => tx['transaction-type'] === 'Trade' && typeof tx.id !== 'undefined' && tx.id !== null && Boolean(tx['executed-at']))
      .map(tx => String(tx.id)),
  );
  const expected = Array.from(new Set(pending.openingTransactionIds));
  return expected.every(id => confirmed.has(id)) ? expected : null;
}
