// lib/leaps-position-intelligence/ledgerStore.ts
//
// LEAPS-LEDGER-0001 -- server-only helpers over the existing append-only ledger (persistence/repository.ts). Appends stay immutable and
// idempotent by request id; this only adds a cap so the list cannot grow without bound.

import type Redis from 'ioredis';
import { LEDGER_MAX_EVENTS } from './ledger';
import { ledgerKey } from './persistence/keys';
import { appendLedgerEvent, type LeapsIdentity, type LeapsLedgerEvent } from './persistence/repository';

/** Appends an event (a repeat of the same request id is a no-op) and keeps only the newest LEDGER_MAX_EVENTS. */
export async function recordLedgerEvent(redis: Redis, identity: LeapsIdentity, event: LeapsLedgerEvent): Promise<void> {
  await appendLedgerEvent(redis, identity, event);
  await redis.ltrim(ledgerKey(identity.userId, identity.canonicalAccountId, identity.longOccSymbol), 0, LEDGER_MAX_EVENTS - 1);
}
