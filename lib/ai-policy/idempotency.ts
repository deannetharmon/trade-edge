// lib/ai-policy/idempotency.ts
//
// Server-side idempotency. A claim is `SET NX` on a per-user fingerprint; a completed claim holds the artifact id and
// a repeat returns that artifact without spending budget. A claim still in flight returns `pending` (the caller shows
// the neutral RATE_LIMIT state). Redis errors fail closed.

import { ARTIFACT_TTL_SECONDS } from './config';
import { sha256Hex } from './canonical';
import { isSafeUserId } from './types';
import type { AiRouteId, RedisLike } from './types';

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,100}$/;
const PENDING = 'pending';
const PENDING_TTL_SECONDS = 90; // longer than the 60 s function limit, so a crashed request frees the key

export const idempotencyKey = (userId: string, fingerprint: string): string => `ai-policy:idem:${userId}:${fingerprint}`;

export function fingerprint(route: AiRouteId, inputId: string, idempotencyKeyValue: string, extra = ''): string {
  return sha256Hex(`${route}\u0000${inputId}\u0000${idempotencyKeyValue}\u0000${extra}`).slice(0, 48);
}

export type ClaimResult =
  | { state: 'claimed' }
  | { state: 'cached'; artifactId: string }
  | { state: 'pending' }
  | { state: 'invalid' }
  | { state: 'error' };

export async function claim(redis: RedisLike, userId: string, fp: string, rawKey: string): Promise<ClaimResult> {
  if (!isSafeUserId(userId) || !IDEMPOTENCY_KEY_RE.test(rawKey)) return { state: 'invalid' };
  try {
    const key = idempotencyKey(userId, fp);
    if ((await redis.set(key, PENDING, 'EX', PENDING_TTL_SECONDS, 'NX')) === 'OK') return { state: 'claimed' };
    const existing = await redis.get(key);
    if (existing == null) return { state: 'pending' };
    return existing === PENDING ? { state: 'pending' } : { state: 'cached', artifactId: existing };
  } catch {
    return { state: 'error' };
  }
}

/** Record the artifact id against a claim (ready or rejected results are cached; the same key returns the same artifact). */
export async function complete(redis: RedisLike, userId: string, fp: string, artifactId: string): Promise<void> {
  await redis.set(idempotencyKey(userId, fp), artifactId, 'EX', ARTIFACT_TTL_SECONDS);
}

/** Free a claim after an unavailable outcome so a retry with the same key can run. */
export async function release(redis: RedisLike, userId: string, fp: string): Promise<void> {
  try {
    await redis.del(idempotencyKey(userId, fp));
  } catch {
    // The pending marker expires on its own.
  }
}
