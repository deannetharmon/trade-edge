// lib/paper-trading/idempotency.ts
//
// PT-0001 section 9.1: every mutation (open/close/reset) requires a
// caller-supplied idempotency key, scoped by authenticated user AND
// operation. Repeated submission with the same key and an equivalent
// payload returns the original result without duplicating the mutation.
// The same key with a materially different payload rejects as a conflict.
//
// Canonicalization (PT-0001 corrective round, fix #1): the payload
// comparison must see EVERY nested field, not just the top-level keys. The
// prior implementation passed `Object.keys(payload).sort()` as
// JSON.stringify's replacer argument -- when the replacer is an array,
// JSON.stringify treats it as a property-name ALLOWLIST applied at every
// level of the object graph, not a "sort these keys" instruction scoped to
// the top level. Any nested property whose name did not also happen to
// appear in that TOP-LEVEL key list (legId, bid, ask, strike, ...) was
// silently dropped from every nested object before hashing, so two
// requests with materially different nested legs/quotes/manual-fill
// details could hash identically. canonicalize() below instead recursively
// walks the whole payload, sorting object keys at every depth and
// preserving array order (array order is semantically meaningful here --
// legs and quote entries are never interchangeable), and the canonical
// JSON string produced from that walk is compared/stored directly rather
// than hashed, removing any hash-collision risk entirely.
//
// This module only reads/writes the idempotency record -- it does not by
// itself make the surrounding check-then-act sequence atomic with a ledger
// mutation. The ACCEPTED-mutation write path (open/close/reset) now commits
// the idempotency record in the SAME atomic transaction as the ledger
// mutation and its audit event (see persistence/commit.ts, corrective round
// fix #3) via buildIdempotencyWrite() below; checkIdempotency() is still
// used standalone, while the caller still holds the mutation lock, purely
// as the initial replay/conflict check before any ledger mutation is
// attempted.

import { PaperTradingError } from './types';
import { withAutopilotRedis } from '@/lib/autopilot/persistence/redis';
import { paperIdempotencyKey } from './persistence/keys';

export const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24; // 24h

interface IdempotencyRecord {
  payloadCanonical: string;
  result: unknown;
  createdAt: string;
}

/**
 * Recursively produces a value whose JSON.stringify output is deterministic
 * regardless of object-key insertion order, at every nesting depth, while
 * preserving array element order. Throws for any value JSON cannot
 * represent unambiguously (functions, symbols, bigint, non-finite numbers,
 * undefined) rather than silently dropping or coercing them -- an
 * idempotency payload must never compare two genuinely different requests
 * as equal because of a silent coercion, and must never omit a value that
 * should have been part of the identity of the request.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  const t = typeof value;

  if (t === 'string' || t === 'boolean') return value;

  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new PaperTradingError('VALIDATION_ERROR', 'Idempotency payload contains a non-finite number.');
    }
    return value;
  }

  if (t === 'undefined') {
    throw new PaperTradingError('VALIDATION_ERROR', 'Idempotency payload contains an undefined value.');
  }

  if (t === 'function' || t === 'symbol' || t === 'bigint') {
    throw new PaperTradingError('VALIDATION_ERROR', `Idempotency payload contains an unsupported ${t} value.`);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize(obj[key]);
    }
    return result;
  }

  throw new PaperTradingError('VALIDATION_ERROR', 'Idempotency payload contains an unsupported value.');
}

export function canonicalPayloadString(payload: unknown): string {
  return JSON.stringify(canonicalize(payload));
}

export type IdempotentOperation = 'open' | 'close' | 'reset';

export interface IdempotencyCheckResult<T> {
  replay: boolean;
  result: T | null;
}

export async function checkIdempotency<T>(
  userId: string,
  operation: IdempotentOperation,
  idempotencyKey: string,
  payload: unknown,
): Promise<IdempotencyCheckResult<T>> {
  const payloadCanonical = canonicalPayloadString(payload);
  return withAutopilotRedis(async (redis) => {
    const raw = await redis.get(paperIdempotencyKey(userId, operation, idempotencyKey));
    if (!raw) return { replay: false, result: null };

    const record = JSON.parse(raw) as IdempotencyRecord;
    if (record.payloadCanonical !== payloadCanonical) {
      throw new PaperTradingError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with a different request payload.', {
        idempotencyKey,
        operation,
      });
    }
    return { replay: true, result: record.result as T };
  });
}

/**
 * Builds the exact key/value pair the accepted-mutation atomic commit
 * (persistence/commit.ts) writes inside the SAME MULTI/EXEC transaction as
 * the ledger and audit writes. Kept here (rather than only in commit.ts) so
 * the record shape and the canonicalization it depends on have a single
 * source of truth shared with checkIdempotency() above.
 */
export function buildIdempotencyWrite(
  userId: string,
  operation: IdempotentOperation,
  idempotencyKey: string,
  payload: unknown,
  result: unknown,
): { key: string; value: string; ttlSeconds: number } {
  const payloadCanonical = canonicalPayloadString(payload);
  const record: IdempotencyRecord = { payloadCanonical, result, createdAt: new Date().toISOString() };
  return {
    key: paperIdempotencyKey(userId, operation, idempotencyKey),
    value: JSON.stringify(record),
    ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
  };
}

/**
 * Standalone, non-atomic write. open/close/reset must NOT call this
 * directly -- they go through buildIdempotencyWrite() + persistence's
 * atomic commit so the idempotency record can never be written without the
 * ledger mutation it describes actually having committed. Retained for any
 * caller that genuinely has no ledger mutation to be atomic with.
 */
export async function storeIdempotencyResult(
  userId: string,
  operation: IdempotentOperation,
  idempotencyKey: string,
  payload: unknown,
  result: unknown,
): Promise<void> {
  const { key, value, ttlSeconds } = buildIdempotencyWrite(userId, operation, idempotencyKey, payload, result);
  return withAutopilotRedis(async (redis) => {
    await redis.set(key, value, 'EX', ttlSeconds);
  });
}
