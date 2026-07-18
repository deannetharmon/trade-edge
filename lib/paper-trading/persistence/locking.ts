// lib/paper-trading/persistence/locking.ts
//
// PT-0001 section 9.2 (corrected in the PT-0001 corrective round, fix #2).
// Deliberately mirrors the existing Redis SET-NX-EX pattern in
// lib/autopilot/scheduler/locking.ts for acquisition, but scoped to its own
// key so a paper-trading mutation is never blocked by (or blocks) an
// Autopilot framework run lock — the two features are unrelated and must
// not share a lock.
//
// Two related defects existed in the pre-corrective-round implementation:
//
//  1. releasePaperTradingLock() did a separate GET then DEL — not atomic.
//     Between the GET (confirming this caller still owns the lock) and the
//     DEL, the lock could expire and a different caller could acquire it;
//     the original caller's DEL would then delete the REPLACEMENT owner's
//     lock, not its own. Fixed below with a single atomic Lua EVAL that
//     performs the compare-and-delete as one indivisible Redis operation.
//
//  2. Nothing prevented a mutation whose lease had already expired (and been
//     reacquired by a different caller) from going on to COMMIT its
//     changes — a longer TTL alone cannot rule this out, it only pushes the
//     race further out. The fix is NOT here — ownership must be
//     re-verified atomically together with the commit's actual writes, or
//     the re-check and the write can themselves race. See
//     persistence/commit.ts, which WATCHes this module's lock key and
//     performs the ledger/audit/idempotency commit inside the same
//     WATCH/MULTI/EXEC transaction, so a lease lost between acquiring the
//     lock and committing aborts the commit instead of silently succeeding.
//     Holding the lock is necessary but never sufficient on its own.

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

// Atomic compare-and-delete: only deletes the key if its current value still
// matches the releasing owner's lockId. Implemented as a single Lua script
// via EVAL so the GET+compare+DEL happen as one indivisible Redis operation
// (this is the fix for defect #1 above). ioredis — already a dependency, no
// new dependency introduced — supports .eval() natively.
const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export async function releasePaperTradingLock(userId: string, lockId: string): Promise<boolean> {
  const key = paperMutationLockKey(userId);
  return withAutopilotRedis(async (redis) => {
    const deleted = await redis.eval(RELEASE_IF_OWNER_SCRIPT, 1, key, lockId);
    return deleted === 1;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquires the per-user paper-trading mutation lock, runs `fn` (passing it
 * the acquired lockId so an atomic-commit step can later re-verify this
 * exact lease is still current — see persistence/commit.ts), then always
 * releases it. Retries briefly (a handful of short backoffs) if the lock is
 * already held, since PT-0001 mutations are single user clicks, not
 * high-throughput traffic — a request that still can't acquire the lock
 * after retrying is surfaced to the caller rather than left to hang.
 */
export async function withPaperTradingLock<T>(userId: string, fn: (lockId: string) => Promise<T>): Promise<T> {
  const maxAttempts = 10;
  const backoffMs = 50;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const lock = await acquirePaperTradingLock(userId);
    if (lock.acquired) {
      try {
        return await fn(lock.lockId);
      } finally {
        await releasePaperTradingLock(userId, lock.lockId);
      }
    }
    await sleep(backoffMs);
  }

  throw new Error(`Could not acquire paper-trading mutation lock for user ${userId} after ${maxAttempts} attempts.`);
}

export function paperTradingLockKeyFor(userId: string): string {
  return paperMutationLockKey(userId);
}
