// lib/cache/__tests__/sharedCache.test.ts
//
// DATA-CACHE-0001: hit/miss, TTL, non-cacheable results, fail-open on store errors, corrupt values.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedJson, CACHE_KEY_PREFIX, createMemoryCacheStore, setSharedCacheStoreForTests, type CacheStore } from '../sharedCache';

afterEach(() => { setSharedCacheStoreForTests(null); });

describe('cachedJson', () => {
  it('loads on a miss, stores with the TTL under the namespaced key, and serves the next call from cache', async () => {
    const store = createMemoryCacheStore();
    setSharedCacheStoreForTests(store);
    const load = vi.fn(async () => ({ value: { n: 1 }, cacheable: true }));
    expect(await cachedJson('k', 60, load)).toEqual({ n: 1 });
    expect(await cachedJson('k', 60, load)).toEqual({ n: 1 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.entries.get(`${CACHE_KEY_PREFIX}k`)?.ttlSeconds).toBe(60);
  });

  it('reloads after the TTL expires', async () => {
    let now = 0;
    setSharedCacheStoreForTests(createMemoryCacheStore(() => now));
    const load = vi.fn(async () => ({ value: 'v', cacheable: true }));
    await cachedJson('k', 10, load);
    now = 9_999;
    await cachedJson('k', 10, load);
    expect(load).toHaveBeenCalledTimes(1);
    now = 10_001;
    await cachedJson('k', 10, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not store a result the loader marks non-cacheable', async () => {
    const store = createMemoryCacheStore();
    setSharedCacheStoreForTests(store);
    const load = vi.fn(async () => ({ value: { bars: [] }, cacheable: false }));
    await cachedJson('k', 60, load);
    await cachedJson('k', 60, load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.entries.size).toBe(0);
  });

  it('does not store when the loader throws, and rethrows', async () => {
    const store = createMemoryCacheStore();
    setSharedCacheStoreForTests(store);
    await expect(cachedJson('k', 60, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(store.entries.size).toBe(0);
  });

  it('fails open when the store errors on get and set', async () => {
    const broken: CacheStore = {
      get: async () => { throw new Error('redis down'); },
      set: async () => { throw new Error('redis down'); },
    };
    setSharedCacheStoreForTests(broken);
    const load = vi.fn(async () => ({ value: 7, cacheable: true }));
    expect(await cachedJson('k', 60, load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('treats a corrupt cached value as a miss and overwrites it', async () => {
    const store = createMemoryCacheStore();
    await store.set(`${CACHE_KEY_PREFIX}k`, '{not json', 60);
    setSharedCacheStoreForTests(store);
    const load = vi.fn(async () => ({ value: { ok: true }, cacheable: true }));
    expect(await cachedJson('k', 60, load)).toEqual({ ok: true });
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.entries.get(`${CACHE_KEY_PREFIX}k`)?.value).toBe('{"ok":true}');
  });
});
