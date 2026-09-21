// lib/ai-policy/__tests__/idempotency.test.ts
import { describe, expect, it } from 'vitest';
import { IDEMPOTENCY_KEY_RE, claim, complete, fingerprint, release } from '../idempotency';
import { FakeRedis } from '../fixtures/fakeRedis';

const KEY = 'abcdefghijklmnop1234';
const fp = fingerprint('scan_summary', 'input-1', KEY);

describe('idempotency', () => {
  it('validates the key format', () => {
    for (const ok of [KEY, 'a'.repeat(16), 'A_b-C'.repeat(20)]) expect(IDEMPOTENCY_KEY_RE.test(ok)).toBe(true);
    for (const bad of ['short', 'a'.repeat(101), 'has space 1234567890', 'sym!bol1234567890', '']) expect(IDEMPOTENCY_KEY_RE.test(bad)).toBe(false);
  });

  it('exactly one of many concurrent claims wins; the rest see pending', async () => {
    const redis = new FakeRedis();
    const results = await Promise.all(Array.from({ length: 25 }, () => claim(redis, 'u1', fp, KEY)));
    expect(results.filter((r) => r.state === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.state === 'pending')).toHaveLength(24);
  });

  it('a completed claim returns the cached artifact id', async () => {
    const redis = new FakeRedis();
    await claim(redis, 'u1', fp, KEY);
    await complete(redis, 'u1', fp, 'artifact-1');
    expect(await claim(redis, 'u1', fp, KEY)).toEqual({ state: 'cached', artifactId: 'artifact-1' });
  });

  it('release frees the claim so a retry can run', async () => {
    const redis = new FakeRedis();
    await claim(redis, 'u1', fp, KEY);
    await release(redis, 'u1', fp);
    expect((await claim(redis, 'u1', fp, KEY)).state).toBe('claimed');
  });

  it('claims are per user and per fingerprint', async () => {
    const redis = new FakeRedis();
    await claim(redis, 'u1', fp, KEY);
    expect((await claim(redis, 'u2', fp, KEY)).state).toBe('claimed');
    expect((await claim(redis, 'u1', fingerprint('scan_summary', 'input-1', KEY, 'different question'), KEY)).state).toBe('claimed');
  });

  it('an invalid key or user is refused; a Redis error fails closed', async () => {
    const redis = new FakeRedis();
    expect((await claim(redis, 'u1', fp, 'bad')).state).toBe('invalid');
    expect((await claim(redis, 'a:b', fp, KEY)).state).toBe('invalid');
    redis.failAll = true;
    expect((await claim(redis, 'u1', fp, KEY)).state).toBe('error');
  });
});
