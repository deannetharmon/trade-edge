// lib/ai-policy/circuitBreaker.ts
//
// Redis-backed provider circuit breaker per tier: >= 5 failures within 60 s opens it for 120 s. When the open period
// ends exactly one half-open probe is admitted (`SET NX`); its success closes the breaker, its failure re-opens it.
// Uses plain commands only. Any Redis error fails closed (CIRCUIT_OPEN).

import type { AiTier, RedisLike } from './types';

export const FAILURE_THRESHOLD = 5;
export const FAILURE_WINDOW_SECONDS = 60;
export const OPEN_MILLIS = 120_000;
const PROBE_TTL_SECONDS = 60;
const STATE_TTL_SECONDS = 3600;

const failKey = (tier: AiTier): string => `ai-policy:cb:${tier}:fail`;
const openKey = (tier: AiTier): string => `ai-policy:cb:${tier}:open`;
const probeKey = (tier: AiTier): string => `ai-policy:cb:${tier}:probe`;

export type Admission = { admitted: true; probe: boolean } | { admitted: false };

export async function admit(redis: RedisLike, tier: AiTier, nowMs: number): Promise<Admission> {
  try {
    const openUntil = await redis.get(openKey(tier));
    if (openUntil == null) return { admitted: true, probe: false };
    if (nowMs < Number(openUntil)) return { admitted: false };
    const won = await redis.set(probeKey(tier), String(nowMs), 'EX', PROBE_TTL_SECONDS, 'NX');
    return won === 'OK' ? { admitted: true, probe: true } : { admitted: false };
  } catch {
    return { admitted: false };
  }
}

export async function recordSuccess(redis: RedisLike, tier: AiTier, wasProbe: boolean): Promise<void> {
  try {
    if (wasProbe) await redis.del(openKey(tier), failKey(tier), probeKey(tier));
  } catch {
    // Best effort: the open key still expires as a stale state on the next probe.
  }
}

export async function recordFailure(redis: RedisLike, tier: AiTier, nowMs: number, wasProbe: boolean): Promise<void> {
  try {
    if (wasProbe) {
      await redis.set(openKey(tier), String(nowMs + OPEN_MILLIS), 'EX', STATE_TTL_SECONDS);
      await redis.del(probeKey(tier));
      return;
    }
    await redis.set(failKey(tier), '0', 'EX', FAILURE_WINDOW_SECONDS, 'NX');
    const failures = await redis.incr(failKey(tier));
    if (failures >= FAILURE_THRESHOLD) await redis.set(openKey(tier), String(nowMs + OPEN_MILLIS), 'EX', STATE_TTL_SECONDS);
  } catch {
    // Best effort; the breaker is a protection, and gates fail closed on read.
  }
}

/** Drop the half-open probe marker when an admitted probe never reached the provider (a later gate said no). */
export async function releaseProbe(redis: RedisLike, tier: AiTier): Promise<void> {
  try {
    await redis.del(probeKey(tier));
  } catch {
    // The probe marker expires on its own.
  }
}
