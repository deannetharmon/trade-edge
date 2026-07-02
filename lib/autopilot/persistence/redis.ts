// lib/autopilot/persistence/redis.ts

import Redis from 'ioredis';

export function getAutopilotRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL not configured');
  return new Redis(url);
}

export async function withAutopilotRedis<T>(fn: (redis: Redis) => Promise<T>): Promise<T> {
  const redis = getAutopilotRedis();
  try {
    return await fn(redis);
  } finally {
    redis.disconnect();
  }
}
