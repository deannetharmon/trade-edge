// lib/paper-trading/persistence/locking.ts
//
// PT-0001 section 9.2 (atomicity). Deliberately mirrors the existing
// Redis SET-NX-EX pattern in lib/autopilot/scheduler/locking.ts, but scoped
// to its own key so a paper-trading mutation is never blocked by (or blocks)
// an Autopilot framework run lock — the two features are unrelated and must
// not share a lock.

import { withAutopilotRedis } from '@/lib/autopilot/persistence/redis';
import { paperMutationLockKey } from './keys';

export interface PaperLockResult {
  acquired: boolean;
  lockId: string;
  key: string;
}

function createLockId(): string {
  return `paper_lock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function acquirePaperTradingLock(userId: string, ttlSeconds = 15): Promise<PaperLockResult> {
  const key = paperMutationLockKey(userId);
  const lockId = createLockId();
  return withAutopilotRedis(async (redis) => {
    const result = await redis.set(key, lockId, 'EX', ttlSeconds, 'NX');
    return { acquired: result === 'OK', lockId, key };
  });
}

export async function releasePaperTradingLock(userId: string, lockId: string): Promise<boolean> {
  const key = paperMutationLockKey(userId);
  return withAutopilotRedis(async (redis) => {
    const current = await redis.get(key);
    if (current !== lockId) return false;
    await redis.del(key);
    return true;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquires the per-user paper-trading mutation lock, runs `fn`, then always
 * releases it. Retries briefly (a handful of short backoffs) if the lock is
 * already held, since PT-0001 mutations are single user clicks, not
 * high-throughput traffic — a request that still can't acquire the lock
 * after retrying is surfaced to the caller rather than left to hang.
 */
export async function withPaperTradingLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 10;
  const backoffMs = 50;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const lock = await acquirePaperTradingLock(userId);
    if (lock.acquired) {
      try {
        return await fn();
      } finally {
        await releasePaperTradingLock(userId, lock.lockId);
      }
    }
    await sleep(backoffMs);
  }

  throw new Error(`Could not acquire paper-trading mutation lock for user ${userId} after ${maxAttempts} attempts.`);
}
