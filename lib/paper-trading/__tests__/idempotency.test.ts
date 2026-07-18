// lib/paper-trading/__tests__/idempotency.test.ts
//
// PT-0001 section 9.1 (idempotency). PT-0001 corrective round fix #1: the
// "canonicalization" describe block below is the required regression
// coverage for the deep, order-preserving-array / order-insensitive-object
// canonical serialization that replaced the old shallow, top-level-only
// `Object.keys(payload).sort()` replacer hash.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedisClient } from './testUtils/fakeRedisClient';

let mockRedis: FakeRedisClient;

vi.mock('@/lib/autopilot/persistence/redis', () => ({
  withAutopilotRedis: async (fn: (redis: FakeRedisClient) => unknown) => fn(mockRedis),
}));

import { canonicalize, canonicalPayloadString, checkIdempotency, storeIdempotencyResult } from '../idempotency';
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

describe('canonicalize / canonicalPayloadString (corrective round fix #1)', () => {
  function samplePayload(overrides: { shortBid?: number; longLegId?: string; legOrder?: 'ab' | 'ba' } = {}) {
    const shortLeg = { legId: 'short', optionType: 'put', strike: 500, openAction: 'sell_to_open' };
    const longLeg = { legId: overrides.longLegId ?? 'long', optionType: 'put', strike: 490, openAction: 'buy_to_open' };
    const legs = overrides.legOrder === 'ba' ? [longLeg, shortLeg] : [shortLeg, longLeg];
    return {
      symbol: 'SPY',
      strategy: 'BPS',
      legs,
      quoteSnapshot: {
        source: 'manual',
        legs: [
          { legId: 'short', bid: overrides.shortBid ?? 3.0, ask: 3.2, mid: null, quoteTimestamp: '2026-08-01T15:00:00.000Z' },
          { legId: 'long', bid: 1.0, ask: 1.2, mid: null, quoteTimestamp: '2026-08-01T15:00:00.000Z' },
        ],
      },
      manualOverride: null,
    };
  }

  it('produces the same canonical string when top-level keys are reordered', () => {
    const a = { symbol: 'SPY', strategy: 'CSP', quantity: 1 };
    const b = { quantity: 1, strategy: 'CSP', symbol: 'SPY' };
    expect(canonicalPayloadString(a)).toBe(canonicalPayloadString(b));
  });

  it('produces the same canonical string when NESTED object keys are reordered', () => {
    const a = { leg: { legId: 'short', bid: 3.0, ask: 3.2 } };
    const b = { leg: { ask: 3.2, legId: 'short', bid: 3.0 } };
    expect(canonicalPayloadString(a)).toBe(canonicalPayloadString(b));
  });

  it('produces a DIFFERENT canonical string for a nested bid/ask change (the pre-fix bug: nested quote fields were silently dropped)', () => {
    const a = canonicalPayloadString(samplePayload({ shortBid: 3.0 }));
    const b = canonicalPayloadString(samplePayload({ shortBid: 3.5 }));
    expect(a).not.toBe(b);
  });

  it('produces a DIFFERENT canonical string for a nested leg change', () => {
    const a = canonicalPayloadString(samplePayload({ longLegId: 'long' }));
    const b = canonicalPayloadString(samplePayload({ longLegId: 'long-alt' }));
    expect(a).not.toBe(b);
  });

  it('detects an array-order change as a different payload (array order is semantically meaningful)', () => {
    const a = canonicalPayloadString(samplePayload({ legOrder: 'ab' }));
    const b = canonicalPayloadString(samplePayload({ legOrder: 'ba' }));
    expect(a).not.toBe(b);
  });

  it('rejects a non-finite number', () => {
    expect(() => canonicalize({ a: Number.NaN })).toThrow(PaperTradingError);
    expect(() => canonicalize({ a: Number.POSITIVE_INFINITY })).toThrow(PaperTradingError);
  });

  it('rejects an undefined value rather than silently coercing it', () => {
    expect(() => canonicalize({ a: undefined })).toThrow(PaperTradingError);
  });

  it('rejects a function value', () => {
    expect(() => canonicalize({ a: () => 1 })).toThrow(PaperTradingError);
  });

  it('checkIdempotency replays for the SAME key with a nested-key-reordered but semantically equivalent payload', async () => {
    const a = { leg: { legId: 'short', bid: 3.0, ask: 3.2 } };
    const b = { leg: { ask: 3.2, legId: 'short', bid: 3.0 } };
    await storeIdempotencyResult('u1', 'open', 'key-nested', a, { positionId: 'p1' });
    const result = await checkIdempotency('u1', 'open', 'key-nested', b);
    expect(result.replay).toBe(true);
  });

  it('checkIdempotency rejects the SAME key when a NESTED field materially changed (the exact defect this fix corrects)', async () => {
    await storeIdempotencyResult('u1', 'open', 'key-nested-2', samplePayload({ shortBid: 3.0 }), { positionId: 'p1' });
    await expect(checkIdempotency('u1', 'open', 'key-nested-2', samplePayload({ shortBid: 3.5 }))).rejects.toThrow(PaperTradingError);
  });
});
