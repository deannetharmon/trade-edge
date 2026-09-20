import type Redis from 'ioredis';
import type { LeapsMandate } from '../types';
import { idempotencyKey, ledgerKey, mandateKey } from './keys';

export interface LeapsLedgerEvent {
  id: string;
  at: string;
  policyVersion: 'LEAPS-PI-1.1';
  type: 'mandate-changed' | 'decision-evaluated' | 'user-decision' | 'outcome-recorded';
  actor: 'trader' | 'system';
  requestId: string;
  retention: 'append-only';
  recovery: 'rebuild-from-ledger';
  payload: Record<string, unknown>;
}

export interface LeapsIdentity {
  userId: string;
  canonicalAccountId: string;
  longOccSymbol: string;
}

export interface MandateRecord {
  mandate: LeapsMandate;
  updatedAt: string;
}

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

function assertIdentity(identity: LeapsIdentity): void {
  if (!identity.userId || !identity.canonicalAccountId || !identity.longOccSymbol) throw new Error('Authorized canonical LEAPS identity is required.');
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/** Read-only helper. Callers must authorize the opaque account identity first. */
export async function readMandate(redis: Redis, identity: LeapsIdentity): Promise<MandateRecord | null> {
  assertIdentity(identity);
  return parseJson<MandateRecord>(await redis.get(mandateKey(identity.userId, identity.canonicalAccountId, identity.longOccSymbol)));
}

/**
 * Atomically replaces the current mandate and appends its immutable audit
 * event. The idempotency record makes retrying the same request safe.
 */
export async function saveMandate(redis: Redis, identity: LeapsIdentity, record: MandateRecord, event: LeapsLedgerEvent, requestId: string): Promise<'saved' | 'replayed'> {
  assertIdentity(identity);
  if (!requestId || !event.id || !event.requestId || event.requestId !== requestId) throw new Error('Mandate request and immutable event identity must match.');
  const mandate = JSON.stringify(record);
  const ledger = JSON.stringify(event);
  const idem = idempotencyKey(identity.userId, identity.canonicalAccountId, identity.longOccSymbol, requestId);
  const response = await redis.eval(
    "if redis.call('EXISTS', KEYS[3]) == 1 then return 'replayed' end " +
      "local a=redis.call('TYPE',KEYS[1]).ok; local b=redis.call('TYPE',KEYS[2]).ok; local c=redis.call('TYPE',KEYS[3]).ok; " +
      "if (a~='none' and a~='string') or (b~='none' and b~='list') or (c~='none' and c~='string') then return 'type-error' end; " +
      "redis.call('SET',KEYS[1],ARGV[1]); redis.call('LPUSH',KEYS[2],ARGV[2]); redis.call('SET',KEYS[3],'1','EX',ARGV[3]); return 'saved'",
    3,
    mandateKey(identity.userId, identity.canonicalAccountId, identity.longOccSymbol),
    ledgerKey(identity.userId, identity.canonicalAccountId, identity.longOccSymbol),
    idem,
    mandate,
    ledger,
    IDEMPOTENCY_TTL_SECONDS,
  );
  if (response === 'saved' || response === 'replayed') return response;
  throw new Error('LEAPS intelligence persistence integrity check failed.');
}

/** Appends an immutable event; it never edits an older event. */
export async function appendLedgerEvent(redis: Redis, identity: LeapsIdentity, event: LeapsLedgerEvent): Promise<void> {
  assertIdentity(identity);
  if (!event.id || !event.requestId) throw new Error('Immutable ledger event id and request id are required.');
  const key = ledgerKey(identity.userId, identity.canonicalAccountId, identity.longOccSymbol);
  const idem = idempotencyKey(identity.userId, identity.canonicalAccountId, identity.longOccSymbol, `event:${event.requestId}`);
  const response = await redis.eval(
    "if redis.call('EXISTS', KEYS[2]) == 1 then return 'replayed' end; local t=redis.call('TYPE',KEYS[1]).ok; if t~='none' and t~='list' then return 'type-error' end; redis.call('LPUSH',KEYS[1],ARGV[1]); redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3]); return 'saved'",
    2, key, idem, JSON.stringify(event), event.id, IDEMPOTENCY_TTL_SECONDS,
  );
  if (response !== 'saved' && response !== 'replayed') throw new Error('LEAPS intelligence ledger integrity check failed.');
}

export async function readLedger(redis: Redis, identity: LeapsIdentity, limit = 100): Promise<LeapsLedgerEvent[]> {
  assertIdentity(identity);
  const rows = await redis.lrange(ledgerKey(identity.userId, identity.canonicalAccountId, identity.longOccSymbol), 0, Math.max(0, Math.min(limit, 1000) - 1));
  return rows.flatMap(row => {
    const parsed = parseJson<LeapsLedgerEvent>(row);
    return parsed ? [parsed] : [];
  });
}
