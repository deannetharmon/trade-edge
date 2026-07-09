import Redis from 'ioredis';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (redis) return redis;

  const url = process.env.REDIS_URL || process.env.KV_URL;
  if (!url) {
    throw new Error('Redis is not configured. Set REDIS_URL or KV_URL in Vercel.');
  }

  redis = new Redis(url, {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
    enableReadyCheck: false,
  });

  return redis;
}
