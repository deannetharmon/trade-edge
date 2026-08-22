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
export const CC_CAPACITY_SHADOW_RECENT_INDEX_KEY = `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:recent:index`;
export const CC_CAPACITY_SHADOW_RECENT_EVENT_PREFIX = `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:recent:event:`;

export type CapacityShadowIngestOutcome = 'accepted' | 'duplicate' | 'rate-limited';
export type StoredCapacityShadowResult = CapacityShadowResult & { receivedAt: string };

export interface CapacityShadowIngestContext {
  receivedAt: string;
  identityHash: string;
  eventFingerprint: string;
}

const WRITE_RECENT_LUA = `
local indexKey = KEYS[1]
local eventKey = KEYS[2]
local eventPrefix = ARGV[1]
local eventId = ARGV[2]
local payload = ARGV[3]
local receivedAtMs = tonumber(ARGV[4])
local cutoffMs = tonumber(ARGV[5])
local expiresAtMs = tonumber(ARGV[6])
local maxEvents = tonumber(ARGV[7])

local expired = redis.call('ZRANGEBYSCORE', indexKey, '-inf', cutoffMs)
for _, id in ipairs(expired) do redis.call('DEL', eventPrefix .. id) end
if #expired > 0 then redis.call('ZREM', indexKey, unpack(expired)) end

redis.call('SET', eventKey, payload, 'PXAT', expiresAtMs)
redis.call('ZADD', indexKey, receivedAtMs, eventId)

local excess = redis.call('ZCARD', indexKey) - maxEvents
if excess > 0 then
  local removed = redis.call('ZRANGE', indexKey, 0, excess - 1)
  for _, id in ipairs(removed) do redis.call('DEL', eventPrefix .. id) end
  if #removed > 0 then redis.call('ZREM', indexKey, unpack(removed)) end
end

redis.call('PEXPIREAT', indexKey, expiresAtMs)
return redis.call('ZCARD', indexKey)
`;

const READ_RECENT_LUA = `
local indexKey = KEYS[1]
local eventPrefix = ARGV[1]
local cutoffMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

local expired = redis.call('ZRANGEBYSCORE', indexKey, '-inf', cutoffMs)
for _, id in ipairs(expired) do redis.call('DEL', eventPrefix .. id) end
if #expired > 0 then redis.call('ZREM', indexKey, unpack(expired)) end

local ids = redis.call('ZREVRANGE', indexKey, 0, -1)
local payloads = {}
local dangling = {}
for _, id in ipairs(ids) do
  local payload = redis.call('GET', eventPrefix .. id)
  if payload then
    if #payloads < limit then table.insert(payloads, payload) end
  else
    table.insert(dangling, id)
  end
end
if #dangling > 0 then redis.call('ZREM', indexKey, unpack(dangling)) end
return payloads
`;

function retentionTimes(receivedAt: string): {
  receivedAtMs: number;
  cutoffMs: number;
  expiresAtMs: number;
} {
  const receivedAtMs = new Date(receivedAt).getTime();
  const retentionMs = CC_CAPACITY_SHADOW_RETENTION_SECONDS * 1000;
  return {
    receivedAtMs,
    cutoffMs: receivedAtMs - retentionMs,
    expiresAtMs: receivedAtMs + retentionMs,
  };
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
    const eventKey = `${CC_CAPACITY_SHADOW_RECENT_EVENT_PREFIX}${context.eventFingerprint}`;
    const stored: StoredCapacityShadowResult = { ...result, receivedAt: context.receivedAt };
    const { receivedAtMs, cutoffMs, expiresAtMs } = retentionTimes(context.receivedAt);
    const tx = redis.multi();
    tx.hincrby(countsKey, 'total', 1);
    tx.hincrby(countsKey, `outcome:${result.outcome}`, 1);
    if (result.outcome === 'skipped') tx.hincrby(countsKey, `skipped:${result.reason}`, 1);
    for (const difference of result.differences) {
      tx.hincrby(countsKey, `difference:${difference.kind}`, 1);
      if (difference.kind === 'field') tx.hincrby(countsKey, `field:${difference.field}`, 1);
    }
    tx.expire(countsKey, CC_CAPACITY_SHADOW_RETENTION_SECONDS);
    tx.eval(
      WRITE_RECENT_LUA,
      2,
      CC_CAPACITY_SHADOW_RECENT_INDEX_KEY,
      eventKey,
      CC_CAPACITY_SHADOW_RECENT_EVENT_PREFIX,
      context.eventFingerprint,
      JSON.stringify(stored),
      receivedAtMs,
      cutoffMs,
      expiresAtMs,
      CC_CAPACITY_SHADOW_RECENT_LIMIT,
    );
    const execution = await tx.exec();
    if (!execution || execution.some(([error]) => error !== null)) throw new Error('Telemetry transaction failed');
    return 'accepted';
  });
}

export async function readCoveredCallCapacityShadowRecent(
  serverNow = new Date(),
  requestedLimit = CC_CAPACITY_SHADOW_RECENT_LIMIT,
): Promise<StoredCapacityShadowResult[]> {
  const limit = Math.max(1, Math.min(CC_CAPACITY_SHADOW_RECENT_LIMIT, Math.floor(requestedLimit)));
  const cutoffMs = serverNow.getTime() - CC_CAPACITY_SHADOW_RETENTION_SECONDS * 1000;
  return withAutopilotRedis(async redis => {
    const payloads = await redis.eval(
      READ_RECENT_LUA,
      1,
      CC_CAPACITY_SHADOW_RECENT_INDEX_KEY,
      CC_CAPACITY_SHADOW_RECENT_EVENT_PREFIX,
      cutoffMs,
      limit,
    );
    if (!Array.isArray(payloads)) throw new Error('Invalid recent telemetry response');
    return payloads.flatMap(payload => {
      if (typeof payload !== 'string') return [];
      try {
        return [JSON.parse(payload) as StoredCapacityShadowResult];
      } catch {
        return [];
      }
    });
  });
}
