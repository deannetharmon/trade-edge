// lib/paper-trading/__tests__/locking.test.ts
//
// PT-0001 section 9.2 (corrective round fix #2): atomic, ownership-safe
// lock release. Uses FakeRedisClient's version-tracking + eval() emulation
// directly (no sleeps, no timers) rather than real elapsed time, so these
// tests are fast and deterministic.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedisClient } from './testUtils/fakeRedisClient';

let mockRedis: FakeRedisClient;

vi.mock('@/lib/autopilot/persistence/redis', () => ({
  withAutopilotRedis: async (fn: (redis: FakeRedisClient) => unknown) => fn(mockRedis),
}));

import { acquirePaperTradingLock, releasePaperTradingLock } from '../persistence/locking';

beforeEach(() => {
  mockRedis = new FakeRedisClient();
});

describe('releasePaperTradingLock (atomic compare-and-delete)', () => {
  it('the owner can release its own lock', async () => {
    const lock = await acquirePaperTradingLock('u1');
    expect(lock.acquired).toBe(true);

    const released = await releasePaperTradingLock('u1', lock.lockId);
    expect(released).toBe(true);

    // Lock key is actually gone -- a new acquisition succeeds immediately.
    const reacquired = await acquirePaperTradingLock('u1');
    expect(reacquired.acquired).toBe(true);
  });

  it('a non-owner cannot release the lock', async () => {
    const lock = await acquirePaperTradingLock('u1');
    expect(lock.acquired).toBe(true);

    const released = await releasePaperTradingLock('u1', 'someone-elses-lock-id');
    expect(released).toBe(false);

    // The real owner's lock is still intact -- a second acquire attempt
    // still fails (NX).
    const stillHeld = await acquirePaperTradingLock('u1');
    expect(stillHeld.acquired).toBe(false);
  });

  it('an expired-then-reacquired lock cannot be deleted by the old (stale) owner', async () => {
    const original = await acquirePaperTradingLock('u1');
    expect(original.acquired).toBe(true);

    // Simulate the lease expiring and a DIFFERENT request acquiring a fresh
    // lock: release the underlying key directly (as Redis's own TTL expiry
    // would), then acquire a brand-new lease with a different lockId.
    await mockRedis.del('paper-trading:mutation-lock:u1');
    const replacement = await acquirePaperTradingLock('u1');
    expect(replacement.acquired).toBe(true);
    expect(replacement.lockId).not.toBe(original.lockId);

    // The ORIGINAL (now-stale) owner's release call must be a no-op -- it
    // must never delete the REPLACEMENT owner's lock. This is the exact
    // defect the atomic EVAL-based compare-and-delete fixes (the old
    // GET-then-DEL implementation had a race window here).
    const staleRelease = await releasePaperTradingLock('u1', original.lockId);
    expect(staleRelease).toBe(false);

    // The replacement owner's lock is still standing.
    const stillHeldByReplacement = await acquirePaperTradingLock('u1');
    expect(stillHeldByReplacement.acquired).toBe(false);

    // And the replacement owner CAN release its own lock.
    const replacementRelease = await releasePaperTradingLock('u1', replacement.lockId);
    expect(replacementRelease).toBe(true);
  });

  it('releasing a lock that was never acquired (or already released) is a safe no-op', async () => {
    const released = await releasePaperTradingLock('u1', 'no-such-lock');
    expect(released).toBe(false);
  });
});
