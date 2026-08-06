// path: lib/screener/__tests__/opportunityUniverse.test.ts
import { describe, it, expect } from 'vitest';
import {
  normalizeUniverse,
  migratePrimaryTickers,
  hasCanonicalUniverse,
  saveOpportunityUniverse,
  LS_OPPORTUNITY_UNIVERSE,
  type MigratableTicker,
} from '../opportunityUniverse';

describe('normalizeUniverse', () => {
  it('uppercases symbols', () => {
    expect(normalizeUniverse(['nvda', 'mu'])).toEqual(['NVDA', 'MU']);
  });

  it('trims whitespace', () => {
    expect(normalizeUniverse(['  NVDA  ', ' MU'])).toEqual(['NVDA', 'MU']);
  });

  it('removes duplicates (case-insensitive)', () => {
    expect(normalizeUniverse(['NVDA', 'nvda', 'Nvda', 'MU'])).toEqual(['NVDA', 'MU']);
  });

  it('preserves deterministic input order (first occurrence wins)', () => {
    expect(normalizeUniverse(['NKE', 'MU', 'NVDA', 'AAPL'])).toEqual(['NKE', 'MU', 'NVDA', 'AAPL']);
  });

  it('rejects invalid symbols', () => {
    expect(normalizeUniverse(['NVDA', '123', '!!!', 'TOOLONGTICKER'])).toEqual(['NVDA']);
  });

  it('rejects empty/blank entries', () => {
    expect(normalizeUniverse(['NVDA', '', '   ', 'MU'])).toEqual(['NVDA', 'MU']);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeUniverse([])).toEqual([]);
  });
});

// A minimal WatchlistTicker-like fixture -- the real production shape has
// a `classification` field too, but migratePrimaryTickers only cares about
// `symbol`/`active` (it's generic over T extends MigratableTicker), so
// tests use this simpler shape to keep assertions focused on the
// merge/reactivate decision itself.
interface TestTicker extends MigratableTicker {
  symbol: string;
  active: boolean;
  tag?: string;
}
const t = (symbol: string, active: boolean, tag?: string): TestTicker => ({ symbol, active, tag });
const makeNew = (symbol: string): TestTicker => ({ symbol, active: true, tag: 'new' });

describe('migratePrimaryTickers — the one canonical migration algorithm', () => {
  it('adds a legacy-only CSP symbol as active', () => {
    const result = migratePrimaryTickers([t('NKE', true)], { csp: ['MU'], pmcc: [] }, makeNew);
    expect(result.map(r => [r.symbol, r.active])).toEqual([['NKE', true], ['MU', true]]);
  });

  it('adds a legacy-only PMCC symbol as active', () => {
    const result = migratePrimaryTickers([t('NKE', true)], { csp: [], pmcc: ['NVDA'] }, makeNew);
    expect(result.map(r => [r.symbol, r.active])).toEqual([['NKE', true], ['NVDA', true]]);
  });

  it('required correction 1 — reactivates an existing INACTIVE symbol found in a legacy CSP list, instead of leaving it out because it "already existed"', () => {
    // Exact failing scenario from the corrective-pass ticket: primary has
    // NKE active + MU inactive; legacy CSP list has MU.
    const result = migratePrimaryTickers(
      [t('NKE', true), t('MU', false)],
      { csp: ['MU'], pmcc: [] },
      makeNew
    );
    const mu = result.find(r => r.symbol === 'MU')!;
    expect(mu.active).toBe(true);
    expect(result.map(r => r.symbol)).toEqual(['NKE', 'MU']); // no duplicate MU added
  });

  it('reactivates an existing inactive symbol found in a legacy PMCC list the same way', () => {
    const result = migratePrimaryTickers([t('NKE', true), t('AAPL', false)], { csp: [], pmcc: ['AAPL'] }, makeNew);
    expect(result.find(r => r.symbol === 'AAPL')!.active).toBe(true);
  });

  it('leaves an existing ACTIVE symbol untouched (no unnecessary object replacement)', () => {
    const nke = t('NKE', true);
    const result = migratePrimaryTickers([nke], { csp: ['NKE'], pmcc: [] }, makeNew);
    expect(result[0]).toBe(nke); // same reference -- not "changed"
  });

  it('does not duplicate a symbol found in both the CSP and PMCC legacy lists', () => {
    const result = migratePrimaryTickers([], { csp: ['MU'], pmcc: ['MU'] }, makeNew);
    expect(result.map(r => r.symbol)).toEqual(['MU']);
  });

  it('overlap across all three legacy sources: primary (active) ∩ CSP ∩ PMCC collapses to one active entry', () => {
    const result = migratePrimaryTickers([t('NKE', true)], { csp: ['NKE', 'MU'], pmcc: ['MU', 'AAPL'] }, makeNew);
    expect(result.map(r => [r.symbol, r.active])).toEqual([
      ['NKE', true],
      ['MU', true],
      ['AAPL', true],
    ]);
  });

  it('never removes a ticker', () => {
    const result = migratePrimaryTickers([t('NKE', true), t('SPY', false)], { csp: [], pmcc: [] }, makeNew);
    expect(result.map(r => r.symbol)).toEqual(['NKE', 'SPY']);
  });

  it('preserves existing order and appends new legacy symbols afterward in deterministic order', () => {
    const result = migratePrimaryTickers(
      [t('SPY', true), t('NKE', true)],
      { csp: ['NVDA'], pmcc: ['AAPL'] },
      makeNew
    );
    expect(result.map(r => r.symbol)).toEqual(['SPY', 'NKE', 'NVDA', 'AAPL']);
  });

  it('is idempotent — running migration again on its own output makes no further changes', () => {
    const first = migratePrimaryTickers([t('NKE', true), t('MU', false)], { csp: ['MU'], pmcc: [] }, makeNew);
    const second = migratePrimaryTickers(first, { csp: ['MU'], pmcc: [] }, makeNew);
    expect(second.map(r => [r.symbol, r.active])).toEqual(first.map(r => [r.symbol, r.active]));
    expect(second.length).toBe(first.length);
  });
});

describe('hasCanonicalUniverse', () => {
  function fakeStorage(initial: Record<string, string> = {}): Storage {
    const data = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
      setItem: (k: string, v: string) => { data.set(k, v); },
      removeItem: (k: string) => { data.delete(k); },
      clear: () => { data.clear(); },
      key: (i: number) => Array.from(data.keys())[i] ?? null,
      get length() { return data.size; },
    } as Storage;
  }

  it('is false when the canonical key has not been written yet', () => {
    expect(hasCanonicalUniverse(fakeStorage())).toBe(false);
  });

  it('is true once the canonical key exists', () => {
    expect(hasCanonicalUniverse(fakeStorage({ [LS_OPPORTUNITY_UNIVERSE]: '[]' }))).toBe(true);
  });
});

describe('saveOpportunityUniverse', () => {
  function fakeStorage(): Storage {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
      setItem: (k: string, v: string) => { data.set(k, v); },
      removeItem: (k: string) => { data.delete(k); },
      clear: () => { data.clear(); },
      key: (i: number) => Array.from(data.keys())[i] ?? null,
      get length() { return data.size; },
    } as Storage;
  }

  it('persists a normalized universe to the canonical key', () => {
    const storage = fakeStorage();
    saveOpportunityUniverse(['nvda', 'nvda', ' mu '], storage);
    expect(JSON.parse(storage.getItem(LS_OPPORTUNITY_UNIVERSE)!)).toEqual(['NVDA', 'MU']);
  });
});
