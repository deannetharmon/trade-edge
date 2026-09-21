// lib/ai-policy/fixtures/fakeRedis.ts
//
// In-memory stand-in for the small ioredis subset the AI policy library uses. Test-only. `eval` is not a Lua engine:
// budget concurrency against the real Lua script is verified on real Redis (see the implementation report).

import type { RedisLike } from '../types';

export class FakeRedis implements RedisLike {
  readonly store = new Map<string, { value: string; expiresAt: number | null }>();
  readonly zsets = new Map<string, Map<string, number>>();
  failAll = false;
  failGetKeys = new Set<string>();
  clock: () => number = Date.now;

  private live(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt != null && entry.expiresAt <= this.clock()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }
  private guard(key?: string): void {
    if (this.failAll || (key != null && this.failGetKeys.has(key))) throw new Error('redis down');
  }

  async get(key: string): Promise<string | null> {
    this.guard(key);
    return this.live(key);
  }
  async set(key: string, value: string, ...args: Array<string | number>): Promise<string | null> {
    this.guard();
    const nx = args.includes('NX');
    const exIndex = args.indexOf('EX');
    if (nx && this.live(key) != null) return null;
    const ttl = exIndex >= 0 ? Number(args[exIndex + 1]) : null;
    this.store.set(key, { value, expiresAt: ttl != null ? this.clock() + ttl * 1000 : null });
    return 'OK';
  }
  async del(...keys: string[]): Promise<number> {
    this.guard();
    let n = 0;
    for (const key of keys) if (this.store.delete(key)) n += 1;
    return n;
  }
  async incr(key: string): Promise<number> {
    return this.incrby(key, 1);
  }
  async incrby(key: string, by: number): Promise<number> {
    this.guard();
    const entry = this.store.get(key);
    const next = Number(this.live(key) ?? '0') + by;
    this.store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return next;
  }
  async expire(key: string, seconds: number): Promise<number> {
    this.guard();
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiresAt = this.clock() + seconds * 1000;
    return 1;
  }
  async zadd(key: string, score: number, member: string): Promise<number> {
    this.guard();
    const set = this.zsets.get(key) ?? new Map<string, number>();
    set.set(member, score);
    this.zsets.set(key, set);
    return 1;
  }
  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    this.guard();
    const members = [...(this.zsets.get(key) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    return members.slice(start, stop + 1);
  }
  async eval(): Promise<unknown> {
    throw new Error('FakeRedis does not execute Lua');
  }
}
