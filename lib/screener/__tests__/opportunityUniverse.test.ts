// path: lib/screener/__tests__/opportunityUniverse.test.ts
import { describe, it, expect } from 'vitest';
import {
  normalizeUniverse,
  migrateOpportunityUniverse,
  loadOrMigrateOpportunityUniverse,
  saveOpportunityUniverse,
  LS_OPPORTUNITY_UNIVERSE,
  LS_LEGACY_PRIMARY_WATCHLIST,
  LS_LEGACY_CSP_TICKERS,
  LS_LEGACY_PMCC_TICKERS,
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

describe('migrateOpportunityUniverse', () => {
  it('unions primary, csp, and pmcc symbols in order, deduplicated', () => {
    const result = migrateOpportunityUniverse({
      primary: ['NKE', 'MU'],
      csp: ['MU', 'AAPL'],
      pmcc: ['NVDA', 'AAPL'],
    });
    expect(result).toEqual(['NKE', 'MU', 'AAPL', 'NVDA']);
  });
});

// Minimal in-memory Storage stand-in — these lib tests run under vitest's
// default 'node' environment (no jsdom `localStorage` global), and the
// functions under test accept an injectable storage so they're testable
// without pulling in a DOM environment.
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

describe('loadOrMigrateOpportunityUniverse', () => {
  it('does not overwrite an existing canonical universe', () => {
    const storage = fakeStorage({
      [LS_OPPORTUNITY_UNIVERSE]: JSON.stringify(['NKE']),
      [LS_LEGACY_CSP_TICKERS]: 'MU,AAPL',
    });
    const result = loadOrMigrateOpportunityUniverse(storage);
    expect(result).toEqual(['NKE']);
  });

  it('runs the legacy union migration when the canonical key does not exist', () => {
    const storage = fakeStorage({
      [LS_LEGACY_PRIMARY_WATCHLIST]: JSON.stringify([
        { symbol: 'NKE', active: true, classification: 'stock' },
        { symbol: 'MU', active: false, classification: 'stock' },
      ]),
      [LS_LEGACY_CSP_TICKERS]: 'MU,AAPL',
      [LS_LEGACY_PMCC_TICKERS]: 'NVDA',
    });
    const result = loadOrMigrateOpportunityUniverse(storage);
    expect(result).toEqual(['NKE', 'MU', 'AAPL', 'NVDA']);
    // migration also writes the canonical key
    expect(JSON.parse(storage.getItem(LS_OPPORTUNITY_UNIVERSE)!)).toEqual(['NKE', 'MU', 'AAPL', 'NVDA']);
  });

  it('is idempotent across repeated calls', () => {
    const storage = fakeStorage({
      [LS_LEGACY_PRIMARY_WATCHLIST]: JSON.stringify([{ symbol: 'NKE', active: true, classification: 'stock' }]),
      [LS_LEGACY_CSP_TICKERS]: 'MU',
    });
    const first = loadOrMigrateOpportunityUniverse(storage);
    const second = loadOrMigrateOpportunityUniverse(storage);
    expect(second).toEqual(first);
    expect(second).toEqual(['NKE', 'MU']);
  });
});

describe('saveOpportunityUniverse', () => {
  it('persists a normalized universe to the canonical key', () => {
    const storage = fakeStorage();
    saveOpportunityUniverse(['nvda', 'nvda', ' mu '], storage);
    expect(JSON.parse(storage.getItem(LS_OPPORTUNITY_UNIVERSE)!)).toEqual(['NVDA', 'MU']);
  });
});
