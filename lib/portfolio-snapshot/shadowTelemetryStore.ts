import { withAutopilotRedis } from '@/lib/autopilot/persistence/redis';
import type { CapacityShadowResult } from './shadowParity';
import {
  CC_CAPACITY_SHADOW_DEDUPE_SECONDS,
  CC_CAPACITY_SHADOW_RATE_LIMIT,
  CC_CAPACITY_SHADOW_RATE_WINDOW_SECONDS,
  CC_CAPACITY_SHADOW_RECENT_LIMIT,
  CC_CAPACITY_SHADOW_RETENTION_SECONDS,
} from './shadowTelemetrySchema';

export const CC_CAPACITY_SHADOW_REDIS_PREFIX = 'lcc0001a:cc-capacity-shadow';

export type CapacityShadowIngestOutcome = 'accepted' | 'duplicate' | 'rate-limited';

export interface CapacityShadowIngestContext {
  receivedAt: string;
  identityHash: string;
  eventFingerprint: string;
}

export async function ingestCoveredCallCapacityShadow(
  result: CapacityShadowResult,
  context: CapacityShadowIngestContext,
): Promise<CapacityShadowIngestOutcome> {
  return withAutopilotRedis(async redis => {
    const rateWindow = Math.floor(new Date(context.receivedAt).getTime() / (CC_CAPACITY_SHADOW_RATE_WINDOW_SECONDS * 1000));
    const rateKey = `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:rate:${context.identityHash}:${rateWindow}`;
    const rateCount = Number(await redis.eval(
      "local count=redis.call('INCR',KEYS[1]); redis.call('EXPIRE',KEYS[1],ARGV[1]); return count",
      1,
      rateKey,
      CC_CAPACITY_SHADOW_RATE_WINDOW_SECONDS + 5,
    ));
    if (!Number.isSafeInteger(rateCount) || rateCount < 1) throw new Error('Invalid telemetry rate counter');
    if (rateCount > CC_CAPACITY_SHADOW_RATE_LIMIT) return 'rate-limited';

    const dedupeKey = `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:dedupe:${context.eventFingerprint}`;
    const firstSeen = await redis.set(dedupeKey, '1', 'EX', CC_CAPACITY_SHADOW_DEDUPE_SECONDS, 'NX');
    if (firstSeen !== 'OK') return 'duplicate';

    const day = context.receivedAt.slice(0, 10);
    const countsKey = `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:counts:${day}`;
    const recentKey = `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:recent`;
    const stored = { ...result, receivedAt: context.receivedAt };
    const receivedAtMs = new Date(context.receivedAt).getTime();
    const retentionCutoffMs = receivedAtMs - CC_CAPACITY_SHADOW_RETENTION_SECONDS * 1000;
    const tx = redis.multi();
    tx.hincrby(countsKey, 'total', 1);
    tx.hincrby(countsKey, `outcome:${result.outcome}`, 1);
    if (result.outcome === 'skipped') tx.hincrby(countsKey, `skipped:${result.reason}`, 1);
    for (const difference of result.differences) {
      tx.hincrby(countsKey, `difference:${difference.kind}`, 1);
      if (difference.kind === 'field') tx.hincrby(countsKey, `field:${difference.field}`, 1);
    }
    tx.expire(countsKey, CC_CAPACITY_SHADOW_RETENTION_SECONDS);
    tx.zadd(recentKey, receivedAtMs, JSON.stringify(stored));
    tx.zremrangebyscore(recentKey, '-inf', `(${retentionCutoffMs}`);
    tx.zremrangebyrank(recentKey, 0, -(CC_CAPACITY_SHADOW_RECENT_LIMIT + 1));
    tx.expire(recentKey, CC_CAPACITY_SHADOW_RETENTION_SECONDS);
    await tx.exec();
    return 'accepted';
  });
}
