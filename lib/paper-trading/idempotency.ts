// lib/paper-trading/idempotency.ts
//
// PT-0001 section 9.1: every mutation (open/close/reset) requires a
// caller-supplied idempotency key, scoped by authenticated user AND
// operation. Repeated submission with the same key and same payload returns
// the original result without duplicating the mutation. The same key with a
// materially different payload rejects as a conflict.
//
// This module only reads/writes the idempotency record — it does not by
// itself make the surrounding check-then-act atomic. Atomicity comes from
// persistence/store.ts calling this from inside the same distributed lock
// that guards the ledger mutation (section 9.2), so two concurrent requests
// with the same key can never both proceed past the check.

import { PaperTradingError } from './types';
import { withAutopilotRedis } from '@/lib/autopilot/persistence/redis';
import { paperIdempotencyKey } from './persistence/keys';

const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24; // 24h

interface IdempotencyRecord {
  payloadHash: string;
  result: unknown;
  createdAt: string;
}

// Small stable hash — this only needs to detect "materially different
// payload," not be cryptographically strong.
function hashPayload(payload: unknown): string {
  const stable = JSON.stringify(payload, Object.keys(payload as object).sort());
  let hash = 0;
  for (let i = 0; i < stable.length; i++) {
    hash = (Math.imul(31, hash) + stable.charCodeAt(i)) | 0;
  }
  return `${hash}:${stable.length}`;
}

export type IdempotentOperation = 'open' | 'close' | 'reset';

export interface IdempotencyCheckResult<T> {
  replay: boolean;
  result: T | null;
}

/**
 * Checks for a prior result under this (userId, operation, idempotencyKey).
 * Throws PaperTradingError('IDEMPOTENCY_CONFLICT') if the same key was used
 * with a materially different payload. Returns { replay: true, result } if
 * this exact request was already handled. Returns { replay: false, result:
 * null } if this is a new request that should proceed.
 */
export async function checkIdempotency<T>(
  userId: string,
  operation: IdempotentOperation,
  idempotencyKey: string,
  payload: unknown,
): Promise<IdempotencyCheckResult<T>> {
  const payloadHash = hashPayload(payload);
  return withAutopilotRedis(async (redis) => {
    const raw = await redis.get(paperIdempotencyKey(userId, operation, idempotencyKey));
    if (!raw) return { replay: false, result: null };

    const record = JSON.parse(raw) as IdempotencyRecord;
    if (record.payloadHash !== payloadHash) {
      throw new PaperTradingError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with a different request payload.', {
        idempotencyKey,
        operation,
      });
    }
    return { replay: true, result: record.result as T };
  });
}

export async function storeIdempotencyResult(
  userId: string,
  operation: IdempotentOperation,
  idempotencyKey: string,
  payload: unknown,
  result: unknown,
): Promise<void> {
  const payloadHash = hashPayload(payload);
  const record: IdempotencyRecord = { payloadHash, result, createdAt: new Date().toISOString() };
  return withAutopilotRedis(async (redis) => {
    await redis.set(paperIdempotencyKey(userId, operation, idempotencyKey), JSON.stringify(record), 'EX', IDEMPOTENCY_TTL_SECONDS);
  });
}
