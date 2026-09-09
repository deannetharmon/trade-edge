import { withAutopilotRedis } from '@/lib/autopilot/persistence/redis';
import type { CreditSpreadEntrySnapshot } from './types';

export const ENTRY_SNAPSHOT_REDIS_PREFIX = 'entry-context:v1:snapshot';
export const ENTRY_SNAPSHOT_ACCOUNT_INDEX_PREFIX = 'entry-context:v1:account';

/** Server routes scope broker-account records to the authenticated user. */
export function entrySnapshotOwnerScope(userId: string, accountId: string): string {
  return `${encodeURIComponent(userId)}:${encodeURIComponent(accountId)}`;
}

export function entrySnapshotRedisKey(accountId: string, executionId: string): string {
  return `${ENTRY_SNAPSHOT_REDIS_PREFIX}:${encodeURIComponent(accountId)}:${encodeURIComponent(executionId)}`;
}
export function entrySnapshotAccountIndexKey(accountId: string): string { return `${ENTRY_SNAPSHOT_ACCOUNT_INDEX_PREFIX}:${encodeURIComponent(accountId)}`; }

type RedisSnapshotClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'NX'): Promise<'OK' | null>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
};

function parseSnapshot(value: string): CreditSpreadEntrySnapshot {
  const parsed = JSON.parse(value) as CreditSpreadEntrySnapshot;
  if (!parsed || parsed.schemaVersion !== '1' || !parsed.entrySnapshotId || !parsed.executionId) {
    throw new Error('Stored entry snapshot is invalid');
  }
  return parsed;
}

export async function saveImmutableEntrySnapshot(
  snapshot: CreditSpreadEntrySnapshot,
  client?: RedisSnapshotClient,
  storageAccountId = snapshot.accountId,
): Promise<{ snapshot: CreditSpreadEntrySnapshot; created: boolean }> {
  const persist = async (redis: RedisSnapshotClient) => {
    const key = entrySnapshotRedisKey(storageAccountId, snapshot.executionId);
    const created = await redis.set(key, JSON.stringify(snapshot), 'NX');
    if (created === 'OK') { await redis.sadd(entrySnapshotAccountIndexKey(storageAccountId), key); return { snapshot, created: true }; }
    const existing = await redis.get(key);
    if (existing == null) throw new Error('Entry snapshot idempotency read failed');
    return { snapshot: parseSnapshot(existing), created: false };
  };
  return client ? persist(client) : withAutopilotRedis(redis => persist(redis));
}

export async function readEntrySnapshotsForAccount(accountId: string, client?: RedisSnapshotClient, storageAccountId = accountId): Promise<CreditSpreadEntrySnapshot[]> {
  const read = async (redis: RedisSnapshotClient) => {
    const keys = await redis.smembers(entrySnapshotAccountIndexKey(storageAccountId));
    const values = await Promise.all(keys.map(key => redis.get(key)));
    return values.flatMap(value => value == null ? [] : [parseSnapshot(value)]);
  };
  return client ? read(client) : withAutopilotRedis(redis => read(redis));
}

export async function readEntrySnapshot(
  accountId: string,
  executionId: string,
  client?: RedisSnapshotClient,
): Promise<CreditSpreadEntrySnapshot | null> {
  const read = async (redis: RedisSnapshotClient) => {
    const value = await redis.get(entrySnapshotRedisKey(accountId, executionId));
    return value == null ? null : parseSnapshot(value);
  };
  return client ? read(client) : withAutopilotRedis(redis => read(redis));
}
