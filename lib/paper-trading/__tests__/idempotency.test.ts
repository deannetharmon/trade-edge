// lib/paper-trading/__tests__/idempotency.test.ts
//
// PT-0001 section 9.1 (idempotency).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedisClient } from './testUtils/fakeRedisClient';

let mockRedis: FakeRedisClient;

vi.mock('@/lib/autopilot/persistence/redis', () => ({
  withAutopilotRedis: async (fn: (redis: FakeRedisClient) => unknown) => fn(mockRedis),
}));

import { checkIdempotency, storeIdempotencyResult } from '../idempotency';
import { PaperTradingError } from '../types';

beforeEach(() => {
  mockRedis = new FakeRedisClient();
});

describe('checkIdempotency / storeIdempotencyResult', () => {
  it('returns replay:false for a brand-new key', async () => {
    const result = await checkIdempotency('u1', 'open', 'key-1', { a: 1 });
    expect(result.replay).toBe(false);
  });

  it('replays the original result for the same key and same payload', async () => {
    await storeIdempotencyResult('u1', 'open', 'key-1', { a: 1 }, { positionId: 'p1' });
    const result = await checkIdempotency<{ positionId: string }>('u1', 'open', 'key-1', { a: 1 });
    expect(result.replay).toBe(true);
    expect(result.result).toEqual({ positionId: 'p1' });
  });

  it('rejects as a conflict when the same key is used with a materially different payload', async () => {
    await storeIdempotencyResult('u1', 'open', 'key-1', { a: 1 }, { positionId: 'p1' });
    await expect(checkIdempotency('u1', 'open', 'key-1', { a: 2 })).rejects.toThrow(PaperTradingError);
  });

  it('scopes keys by user -- the same key for a different user is a separate record', async () => {
    await storeIdempotencyResult('u1', 'open', 'key-1', { a: 1 }, { positionId: 'p1' });
    const result = await checkIdempotency('u2', 'open', 'key-1', { a: 1 });
    expect(result.replay).toBe(false);
  });

  it('scopes keys by operation -- the same key for open vs close is a separate record', async () => {
    await storeIdempotencyResult('u1', 'open', 'key-1', { a: 1 }, { positionId: 'p1' });
    const result = await checkIdempotency('u1', 'close', 'key-1', { a: 1 });
    expect(result.replay).toBe(false);
  });
});
