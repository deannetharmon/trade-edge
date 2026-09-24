// lib/screener/__tests__/scanPreferences.test.ts

import { describe, expect, it } from 'vitest';
import {
  EMPTY_SCAN_PREFERENCES, parseScanPreferences, readScanPreferences, saveScanPreferences, scanPrefsKey,
} from '../scanPreferences';

// A minimal in-memory store for the two calls scan preferences make. Local on purpose: deterministic code and its tests
// never import @/lib/ai-policy (see lib/ai-policy/__tests__/importBoundary.test.ts).
class FakeRedis {
  readonly store = new Map<string, string>();
  failAll = false;
  async get(key: string): Promise<string | null> {
    if (this.failAll) throw new Error('redis down');
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<string> {
    if (this.failAll) throw new Error('redis down');
    this.store.set(key, value);
    return 'OK';
  }
}

describe('parseScanPreferences', () => {
  it('a missing or malformed record yields the empty defaults (acceptance criterion 1: identical to today)', () => {
    for (const bad of [null, undefined, 'x', 5, [], {}]) {
      expect(parseScanPreferences(bad)).toEqual(EMPTY_SCAN_PREFERENCES);
    }
  });

  it('accepts every global field', () => {
    const parsed = parseScanPreferences({ dteMin: 21, dteMax: 45, oiMin: 100, creditRatioMin: 20, popMin: 70, otmMin: 6 });
    expect(parsed).toMatchObject({ dteMin: 21, dteMax: 45, oiMin: 100, creditRatioMin: 20, popMin: 70, otmMin: 6 });
  });

  it('drops an invalid global field but keeps the rest (partial corruption never blocks the whole record)', () => {
    const parsed = parseScanPreferences({ dteMin: 21, oiMin: 'not a number', popMin: -5 });
    expect(parsed.dteMin).toBe(21);
    expect(parsed.oiMin).toBeNull();
    expect(parsed.popMin).toBeNull();
  });

  it('an inverted DTE range (min > max) clears both rather than saving nonsense', () => {
    expect(parseScanPreferences({ dteMin: 60, dteMax: 30 })).toMatchObject({ dteMin: null, dteMax: null });
  });

  it('accepts a per-strategy delta range and rejects an out-of-magnitude one', () => {
    const parsed = parseScanPreferences({ delta: { csp: { min: 0.15, max: 0.25 }, ic: { min: -0.1, max: 0.2 } } });
    expect(parsed.delta.csp).toEqual({ min: 0.15, max: 0.25 });
    expect(parsed.delta.ic).toBeUndefined(); // acceptance criterion 3: strategies never bleed into each other, and bad data is dropped, not clamped into something wrong
  });

  it('CSP\'s delta preference never touches IC\'s or Spreads\', even when all three are set together', () => {
    const parsed = parseScanPreferences({
      delta: { csp: { min: 0.15, max: 0.25 }, ic: { min: 0.16, max: 0.20 }, spreads: { min: 0.20, max: 0.30 } },
    });
    expect(parsed.delta).toEqual({ csp: { min: 0.15, max: 0.25 }, ic: { min: 0.16, max: 0.20 }, spreads: { min: 0.20, max: 0.30 } });
  });

  it('accepts a default mode only for csp/spreads, and only rank/targeted (never filter, per SCREENER-CONFIG-0001)', () => {
    const parsed = parseScanPreferences({ defaultMode: { csp: 'targeted', spreads: 'rank', cc: 'rank', pmcc: 'filter' } });
    expect(parsed.defaultMode).toEqual({ csp: 'targeted', spreads: 'rank' });
  });

  it('rejects "filter" as a saved default mode outright', () => {
    expect(parseScanPreferences({ defaultMode: { csp: 'filter' } }).defaultMode).toEqual({});
  });

  it('null clears a field explicitly (distinct from it being absent, though both read the same)', () => {
    expect(parseScanPreferences({ dteMin: null }).dteMin).toBeNull();
  });
});

describe('readScanPreferences / saveScanPreferences', () => {
  it('a fresh user with nothing saved reads the empty defaults', async () => {
    const redis = new FakeRedis();
    expect(await readScanPreferences(redis, 'user-a')).toEqual(EMPTY_SCAN_PREFERENCES);
  });

  it('saves and reads back exactly what was saved', async () => {
    const redis = new FakeRedis();
    const saved = await saveScanPreferences(redis, 'user-a', { oiMin: 100, delta: { csp: { min: 0.15, max: 0.25 } } });
    expect(saved.ok).toBe(true);
    expect(await readScanPreferences(redis, 'user-a')).toMatchObject({ oiMin: 100, delta: { csp: { min: 0.15, max: 0.25 } } });
  });

  it('a second save merges into the first rather than replacing it wholesale', async () => {
    const redis = new FakeRedis();
    await saveScanPreferences(redis, 'user-a', { oiMin: 100, popMin: 70 });
    await saveScanPreferences(redis, 'user-a', { otmMin: 6 });
    expect(await readScanPreferences(redis, 'user-a')).toMatchObject({ oiMin: 100, popMin: 70, otmMin: 6 });
  });

  it('merges delta preferences per-strategy, not by replacing the whole delta object', async () => {
    const redis = new FakeRedis();
    await saveScanPreferences(redis, 'user-a', { delta: { csp: { min: 0.15, max: 0.25 } } });
    await saveScanPreferences(redis, 'user-a', { delta: { ic: { min: 0.16, max: 0.20 } } });
    const read = await readScanPreferences(redis, 'user-a');
    expect(read.delta).toEqual({ csp: { min: 0.15, max: 0.25 }, ic: { min: 0.16, max: 0.20 } });
  });

  it('a field explicitly set to null clears it back to the app default', async () => {
    const redis = new FakeRedis();
    await saveScanPreferences(redis, 'user-a', { oiMin: 100 });
    await saveScanPreferences(redis, 'user-a', { oiMin: null });
    expect((await readScanPreferences(redis, 'user-a')).oiMin).toBeNull();
  });

  it('two users never see each other\'s preferences (acceptance criterion 7)', async () => {
    const redis = new FakeRedis();
    await saveScanPreferences(redis, 'user-a', { oiMin: 100 });
    expect(await readScanPreferences(redis, 'user-b')).toEqual(EMPTY_SCAN_PREFERENCES);
    expect(redis.store.has(scanPrefsKey('user-a'))).toBe(true);
    expect(redis.store.has(scanPrefsKey('user-b'))).toBe(false);
  });

  it('rejects a non-object patch without touching existing data', async () => {
    const redis = new FakeRedis();
    await saveScanPreferences(redis, 'user-a', { oiMin: 100 });
    const result = await saveScanPreferences(redis, 'user-a', 'not an object');
    expect(result.ok).toBe(false);
    expect((await readScanPreferences(redis, 'user-a')).oiMin).toBe(100);
  });

  it('a Redis read failure degrades to the empty defaults, never an error thrown at the scan UI', async () => {
    const redis = new FakeRedis();
    redis.failAll = true;
    await expect(readScanPreferences(redis, 'user-a')).resolves.toEqual(EMPTY_SCAN_PREFERENCES);
  });

  it('malformed stored JSON degrades the same way', async () => {
    const redis = new FakeRedis();
    await redis.set(scanPrefsKey('user-a'), 'not json');
    expect(await readScanPreferences(redis, 'user-a')).toEqual(EMPTY_SCAN_PREFERENCES);
  });
});
