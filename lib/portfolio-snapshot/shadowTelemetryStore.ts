import { withAutopilotRedis } from '@/lib/autopilot/persistence/redis';
import type { CapacityShadowResult } from './shadowParity';
import { CC_CAPACITY_SHADOW_RECENT_LIMIT, CC_CAPACITY_SHADOW_RETENTION_SECONDS } from './shadowTelemetrySchema';

export const CC_CAPACITY_SHADOW_REDIS_PREFIX = 'lcc0001a:cc-capacity-shadow';

export async function recordCoveredCallCapacityShadow(result: CapacityShadowResult): Promise<void> {
  await withAutopilotRedis(async redis => {
    const day = result.comparedAt.slice(0, 10);
    const countsKey = `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:counts:${day}`;
    const recentKey = `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:recent`;
    const tx = redis.multi();
    tx.hincrby(countsKey, 'total', 1);
    tx.hincrby(countsKey, `outcome:${result.outcome}`, 1);
    if (result.outcome === 'skipped') tx.hincrby(countsKey, `skipped:${result.reason}`, 1);
    for (const difference of result.differences) {
      tx.hincrby(countsKey, `difference:${difference.kind}`, 1);
      if (difference.kind === 'field') tx.hincrby(countsKey, `field:${difference.field}`, 1);
    }
    tx.expire(countsKey, CC_CAPACITY_SHADOW_RETENTION_SECONDS);
    tx.lpush(recentKey, JSON.stringify(result));
    tx.ltrim(recentKey, 0, CC_CAPACITY_SHADOW_RECENT_LIMIT - 1);
    tx.expire(recentKey, CC_CAPACITY_SHADOW_RETENTION_SECONDS);
    await tx.exec();
  });
}
