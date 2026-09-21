// lib/leaps-position-intelligence/entryRecordsStore.ts
//
// LEAPS-ENTRY-0001 -- server-only Redis helpers for entry records (kept apart from entryRecords.ts so client code can import the pure
// selectors without pulling in Node's crypto). Keys hash user, account and contract, so no raw identifier appears in Redis.

import { createHash } from 'crypto';
import { ENTRY_RECORD_MAX_PER_CONTRACT, ENTRY_RECORD_SCHEMA_VERSION, ENTRY_RECORD_TTL_SECONDS, type LeapsEntryRecord } from './entryRecords';

const seg = (value: string) => createHash('sha256').update(value).digest('base64url');
export const entryRecordsKey = (userId: string, accountNumber: string, longOccSymbol: string) => `leaps-pi:entry:${seg(userId)}:${seg(accountNumber)}:${seg(longOccSymbol)}`;
export const entryOrderMarkerKey = (userId: string, brokerOrderId: string) => `leaps-pi:entry-order:${seg(userId)}:${seg(brokerOrderId)}`;

/** The slice of an ioredis client these helpers use. */
export interface EntryRedis {
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  lpush(key: string, value: string): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}

export async function saveEntryRecord(redis: EntryRedis, identity: { userId: string; accountNumber: string }, record: LeapsEntryRecord): Promise<'saved' | 'duplicate'> {
  if (record.brokerOrderId) {
    // One record per broker order, even if the submit is somehow repeated.
    const claimed = await redis.set(entryOrderMarkerKey(identity.userId, record.brokerOrderId), record.id, 'EX', ENTRY_RECORD_TTL_SECONDS, 'NX');
    if (claimed == null) return 'duplicate';
  }
  const key = entryRecordsKey(identity.userId, identity.accountNumber, record.longOccSymbol);
  await redis.lpush(key, JSON.stringify(record));
  await redis.ltrim(key, 0, ENTRY_RECORD_MAX_PER_CONTRACT - 1);
  await redis.expire(key, ENTRY_RECORD_TTL_SECONDS);
  return 'saved';
}

export async function readEntryRecords(redis: EntryRedis, identity: { userId: string; accountNumber: string; longOccSymbol: string }): Promise<LeapsEntryRecord[]> {
  const raw = await redis.lrange(entryRecordsKey(identity.userId, identity.accountNumber, identity.longOccSymbol), 0, ENTRY_RECORD_MAX_PER_CONTRACT - 1);
  const out: LeapsEntryRecord[] = [];
  for (const item of raw) {
    try {
      const parsed = JSON.parse(item) as LeapsEntryRecord;
      if (parsed?.schemaVersion === ENTRY_RECORD_SCHEMA_VERSION && typeof parsed.id === 'string' && typeof parsed.recordedAt === 'string') out.push(parsed);
    } catch { /* a malformed entry is skipped, never fatal */ }
  }
  return out;
}
