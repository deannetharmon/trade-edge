// lib/cache/sharedCache.ts
//
// DATA-CACHE-0001: a small shared (Redis) JSON cache for upstream market data, so serverless instances stop re-fetching the same
// Yahoo response. Rules:
//  * Fail open. If Redis is not configured, is slow (800 ms cap) or errors, the loader runs and its result is returned as if there were no cache.
//  * Failures are never cached. The loader decides what is cacheable (`cacheable: false` for empty or partial data).
//  * A cached value that cannot be parsed is treated as a miss.
//  * Keys are namespaced `cache:v1:`; bump the version to invalidate everything.
// This is for public market data only. Nothing user-specific may go through it.

import { getRedis } from '@/lib/jobs/redis';

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface Loaded<T> {
  readonly value: T;
  readonly cacheable: boolean;
}

/** An upstream (provider) failure the caller maps to an HTTP status. Never cached. */
export class UpstreamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

export const CACHE_KEY_PREFIX = 'cache:v1:';
export const CACHE_OP_TIMEOUT_MS = 800;

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('cache operation timed out')), CACHE_OP_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

const redisStore: CacheStore = {
  async get(key) {
    return withTimeout(getRedis().get(key));
  },
  async set(key, value, ttlSeconds) {
    await withTimeout(getRedis().set(key, value, 'EX', ttlSeconds));
  },
};

let override: CacheStore | null = null;

/** Test hook: use `store` instead of Redis (pass null to restore Redis). */
export function setSharedCacheStoreForTests(store: CacheStore | null): void {
  override = store;
}

/** In-memory store with TTL, for tests. */
export function createMemoryCacheStore(now: () => number = Date.now): CacheStore & { readonly entries: Map<string, { value: string; ttlSeconds: number; expiresAt: number }> } {
  const entries = new Map<string, { value: string; ttlSeconds: number; expiresAt: number }>();
  return {
    entries,
    async get(key) {
      const hit = entries.get(key);
      if (!hit) return null;
      if (hit.expiresAt <= now()) { entries.delete(key); return null; }
      return hit.value;
    },
    async set(key, value, ttlSeconds) {
      entries.set(key, { value, ttlSeconds, expiresAt: now() + ttlSeconds * 1000 });
    },
  };
}

export async function cachedJson<T>(key: string, ttlSeconds: number, load: () => Promise<Loaded<T>>): Promise<T> {
  const store = override ?? redisStore;
  const fullKey = `${CACHE_KEY_PREFIX}${key}`;
  try {
    const hit = await store.get(fullKey);
    if (hit != null) return JSON.parse(hit) as T;
  } catch {
    // Miss, slow, unavailable or unparseable: fall through to the loader.
  }
  const loaded = await load();
  if (loaded.cacheable) {
    try {
      await store.set(fullKey, JSON.stringify(loaded.value), ttlSeconds);
    } catch {
      // A failed write only costs the next caller a fetch.
    }
  }
  return loaded.value;
}
