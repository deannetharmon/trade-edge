// lib/ai-policy/freezeScanSession.ts
//
// Server-side freeze of a completed scan session into an immutable analysis input. Orchestration only: the builder
// (builders/attested/scanSession.ts) decides what is allowed in; the input store makes it immutable. Never throws.
// Dark by default: it is unavailable unless AI_POLICY_ENABLED plus the scan_summary or grounded_chat flag is on,
// neither kill switch is set, and the encryption key and scope secret are configured.

import { hasArtifactKey } from './artifactCrypto';
import { buildScanSessionInput } from './builders/attested/scanSession';
import { sha256Hex } from './canonical';
import { isGloballyEnabled, isRouteEnabled } from './config';
import { IDEMPOTENCY_KEY_RE } from './idempotency';
import { saveInput } from './inputStore';
import { checkKillSwitch } from './killSwitch';
import { accountScopeId } from './scope';
import { isSafeUserId } from './types';
import type { Env, ReasonCode, RedisLike } from './types';
import { getRedis } from '@/lib/jobs/redis';

/** A cap on stored snapshots per user per hour (storage abuse, not AI spend). */
export const FREEZE_HOURLY_LIMIT = 60;
const PENDING = 'pending';
const PENDING_TTL_SECONDS = 90;
const RESULT_TTL_SECONDS = 90 * 24 * 3600;

export const freezeKey = (userId: string, idempotencyKey: string): string => `ai-policy:freeze:${userId}:${sha256Hex(idempotencyKey).slice(0, 40)}`;
export const freezeCountKey = (userId: string, nowMs: number): string => `ai-policy:freezecount:${userId}:${Math.floor(nowMs / 3_600_000)}`;

export interface FreezeRequest {
  userId: string;
  /** Untrusted client session. Never mutated. */
  session: unknown;
  idempotencyKey: string;
}

export type FreezeResult =
  | { status: 'frozen'; analysisInputId: string; payloadHash: string; createdAt: string }
  | { status: 'unavailable'; reason: ReasonCode };

export interface FreezeDeps {
  env?: Env;
  redis?: RedisLike;
  now?: () => number;
}

const unavailable = (reason: ReasonCode): FreezeResult => ({ status: 'unavailable', reason });

export async function freezeScanSession(request: FreezeRequest, deps: FreezeDeps = {}): Promise<FreezeResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  let redis: RedisLike | null = deps.redis ?? null;
  let claimKey: string | null = null;
  try {
    if (!isGloballyEnabled(env) || !(isRouteEnabled('scan_summary', env) || isRouteEnabled('grounded_chat', env))) return unavailable('FLAG_OFF');
    if (!redis) {
      try {
        redis = getRedis() as unknown as RedisLike;
      } catch {
        return unavailable('KILL_SWITCH');
      }
    }
    const [summaryKill, chatKill] = await Promise.all([checkKillSwitch(redis, 'scan_summary'), checkKillSwitch(redis, 'grounded_chat')]);
    if (summaryKill.killed && chatKill.killed) return unavailable('KILL_SWITCH');
    if (!hasArtifactKey(env) || !env.AI_POLICY_SCOPE_SECRET || env.AI_POLICY_SCOPE_SECRET.length < 16) return unavailable('GOVERNANCE');
    if (!isSafeUserId(request.userId) || !IDEMPOTENCY_KEY_RE.test(request.idempotencyKey)) return unavailable('INPUT_INVALID');

    const key = freezeKey(request.userId, request.idempotencyKey);
    if ((await redis.set(key, PENDING, 'EX', PENDING_TTL_SECONDS, 'NX')) !== 'OK') {
      const existing = await redis.get(key);
      if (existing == null || existing === PENDING) return unavailable('RATE_LIMIT');
      try {
        const stored = JSON.parse(existing) as { analysisInputId: string; payloadHash: string; createdAt: string };
        return { status: 'frozen', analysisInputId: stored.analysisInputId, payloadHash: stored.payloadHash, createdAt: stored.createdAt };
      } catch {
        return unavailable('INPUT_INVALID');
      }
    }
    claimKey = key;

    const count = await redis.incr(freezeCountKey(request.userId, now()));
    await redis.expire(freezeCountKey(request.userId, now()), 2 * 3600);
    if (count > FREEZE_HOURLY_LIMIT) {
      await redis.del(key);
      return unavailable('RATE_LIMIT');
    }

    // Client-attested scan snapshots are user-level, not tied to one broker account.
    const built = buildScanSessionInput({ userId: request.userId, session: request.session, accountScope: accountScopeId(request.userId, 'client-attested-scan', env), nowMs: now() });
    if (!built.ok) {
      await redis.del(key);
      return unavailable(built.reason);
    }
    const saved = await saveInput(redis, built.input, env);
    if (!saved.ok) {
      await redis.del(key);
      return unavailable('INPUT_INVALID');
    }
    const result = { analysisInputId: built.input.id, payloadHash: built.input.payloadHash, createdAt: built.input.createdAt };
    await redis.set(key, JSON.stringify(result), 'EX', RESULT_TTL_SECONDS);
    claimKey = null;
    return { status: 'frozen', ...result };
  } catch {
    if (redis && claimKey) {
      try {
        await redis.del(claimKey);
      } catch {
        // The pending marker expires on its own.
      }
    }
    return unavailable('PROVIDER_ERROR');
  }
}
