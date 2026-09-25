// lib/entry-context/brokerTransactions.ts
//
// Shared by the promote routes: read every broker transaction since a date, following pagination.

import { serverBrokerFetch } from '@/lib/tastytrade/server-token';

export async function readBrokerTransactionsSince(accountId: string, startDate: string, token: string): Promise<any[]> {
  const transactions: any[] = [];
  let pageOffset = 0;
  while (true) {
    const page = await serverBrokerFetch(`/accounts/${encodeURIComponent(accountId)}/transactions?start-date=${encodeURIComponent(startDate)}&per-page=250&page-offset=${pageOffset}`, token);
    const items = page?.data?.items ?? [];
    transactions.push(...items);
    const total = Number(page?.pagination?.['total-items']);
    if (items.length < 250 || !Number.isFinite(total) || transactions.length >= total) return transactions;
    pageOffset++;
  }
}
