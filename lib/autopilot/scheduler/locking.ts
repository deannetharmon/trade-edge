// lib/autopilot/scheduler/locking.ts

import { runLockKey } from '../persistence/keys';
import { withAutopilotRedis } from '../persistence/redis';

export interface RunLockResult {
  acquired: boolean;
  lockId: string;
  key: string;
  ttlSeconds: number;
}

function createLockId(): string {
  return `lock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function acquireAutopilotRunLock(userId: string, ttlSeconds = 240): Promise<RunLockResult> {
  const key = runLockKey(userId);
  const lockId = createLockId();

  return withAutopilotRedis(async (redis) => {
    const result = await redis.set(key, lockId, 'EX', ttlSeconds, 'NX');
    return {
      acquired: result === 'OK',
      lockId,
      key,
      ttlSeconds,
    };
  });
}

export async function releaseAutopilotRunLock(userId: string, lockId: string): Promise<boolean> {
  const key = runLockKey(userId);
  return withAutopilotRedis(async (redis) => {
    const current = await redis.get(key);
    if (current !== lockId) return false;
    await redis.del(key);
    return true;
  });
}
