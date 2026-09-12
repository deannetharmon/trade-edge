import { withAutopilotRedis } from '@/lib/autopilot/persistence/redis';
import type { PendingCreditSpreadEntry, PendingIronCondorEntry } from './pending';

/** Pending evidence is owner-scoped for the same reason immutable snapshots are. */
export const pendingEntryKey = (ownerScope: string, brokerOrderId: string) => `entry-context:v1:pending:${encodeURIComponent(ownerScope)}:${encodeURIComponent(brokerOrderId)}`;
const pendingEntryIndexKey = (ownerScope: string) => `entry-context:v1:pending:index:${encodeURIComponent(ownerScope)}`;

export async function savePendingCreditSpreadEntry(entry: PendingCreditSpreadEntry, ownerScope: string): Promise<void> {
  if (!ownerScope) throw new Error('Authenticated owner scope is required');
  await withAutopilotRedis(async redis => {
    await redis.set(pendingEntryKey(ownerScope, entry.brokerOrderId), JSON.stringify(entry), 'NX');
    await redis.sadd(pendingEntryIndexKey(ownerScope), entry.brokerOrderId);
  });
}

export async function readPendingCreditSpreadEntries(ownerScope: string): Promise<PendingCreditSpreadEntry[]> {
  if (!ownerScope) throw new Error('Authenticated owner scope is required');
  return withAutopilotRedis(async redis => {
    const ids = await redis.smembers(pendingEntryIndexKey(ownerScope));
    const entries = await Promise.all(ids.map(id => redis.get(pendingEntryKey(ownerScope, id))));
    return entries.flatMap(raw => raw == null ? [] : [JSON.parse(raw) as PendingCreditSpreadEntry]);
  });
}

export async function readPendingCreditSpreadEntry(ownerScope: string, brokerOrderId: string): Promise<PendingCreditSpreadEntry | null> {
  if (!ownerScope) throw new Error('Authenticated owner scope is required');
  return withAutopilotRedis(async redis => {
    const raw = await redis.get(pendingEntryKey(ownerScope, brokerOrderId));
    return raw == null ? null : JSON.parse(raw) as PendingCreditSpreadEntry;
  });
}

// TRADE-ENTRY-SNAPSHOT-0001 -- Iron Condor's own pending keys, distinct
// prefix so there's no ambiguity with BPS/BCS pending entries sharing an
// order id namespace (shouldn't happen since order ids are broker-unique,
// but a distinct prefix costs nothing and removes any doubt).
export const pendingIronCondorEntryKey = (ownerScope: string, brokerOrderId: string) => `entry-context:v1:pending-ic:${encodeURIComponent(ownerScope)}:${encodeURIComponent(brokerOrderId)}`;
const pendingIronCondorEntryIndexKey = (ownerScope: string) => `entry-context:v1:pending-ic:index:${encodeURIComponent(ownerScope)}`;

export async function savePendingIronCondorEntry(entry: PendingIronCondorEntry, ownerScope: string): Promise<void> {
  if (!ownerScope) throw new Error('Authenticated owner scope is required');
  await withAutopilotRedis(async redis => {
    await redis.set(pendingIronCondorEntryKey(ownerScope, entry.brokerOrderId), JSON.stringify(entry), 'NX');
    await redis.sadd(pendingIronCondorEntryIndexKey(ownerScope), entry.brokerOrderId);
  });
}

export async function readPendingIronCondorEntries(ownerScope: string): Promise<PendingIronCondorEntry[]> {
  if (!ownerScope) throw new Error('Authenticated owner scope is required');
  return withAutopilotRedis(async redis => {
    const ids = await redis.smembers(pendingIronCondorEntryIndexKey(ownerScope));
    const entries = await Promise.all(ids.map(id => redis.get(pendingIronCondorEntryKey(ownerScope, id))));
    return entries.flatMap(raw => raw == null ? [] : [JSON.parse(raw) as PendingIronCondorEntry]);
  });
}

export async function readPendingIronCondorEntry(ownerScope: string, brokerOrderId: string): Promise<PendingIronCondorEntry | null> {
  if (!ownerScope) throw new Error('Authenticated owner scope is required');
  return withAutopilotRedis(async redis => {
    const raw = await redis.get(pendingIronCondorEntryKey(ownerScope, brokerOrderId));
    return raw == null ? null : JSON.parse(raw) as PendingIronCondorEntry;
  });
}
