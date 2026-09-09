import { withAutopilotRedis } from '@/lib/autopilot/persistence/redis';
import type { PendingCreditSpreadEntry } from './pending';

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
