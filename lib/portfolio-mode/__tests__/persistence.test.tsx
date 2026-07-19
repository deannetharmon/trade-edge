// lib/portfolio-mode/__tests__/persistence.test.tsx
//
// PT-0002A: versioned persistence + storage-versioning coverage. Named
// .test.tsx (not .test.ts) solely so it runs under this repo's
// environmentMatchGlobs jsdom environment (vitest.config.ts) and has a real
// `window.localStorage` available, matching the existing convention used by
// features/portfolio/priorities/__tests__/priorityWorkflowState.test.tsx.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PORTFOLIO_MODE_STORAGE_KEY,
  readPersistedPortfolioMode,
  writePersistedPortfolioMode,
} from '../persistence';

describe('PT-0002A persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reports first-use when nothing is stored', () => {
    expect(readPersistedPortfolioMode()).toEqual({ status: 'first-use' });
  });

  it('round-trips a valid LIVE value', () => {
    writePersistedPortfolioMode('LIVE');
    expect(readPersistedPortfolioMode()).toEqual({ status: 'valid', mode: 'LIVE' });
  });

  it('round-trips a valid PAPER value', () => {
    writePersistedPortfolioMode('PAPER');
    expect(readPersistedPortfolioMode()).toEqual({ status: 'valid', mode: 'PAPER' });
  });

  it('persists under the documented, versioned storage key', () => {
    writePersistedPortfolioMode('PAPER');
    expect(localStorage.getItem(PORTFOLIO_MODE_STORAGE_KEY)).toBe('PAPER');
    expect(PORTFOLIO_MODE_STORAGE_KEY).toBe('hunter-portfolio-mode-v1');
  });

  it('treats a corrupted/unrecognized stored value as invalid, not first-use or a default', () => {
    localStorage.setItem(PORTFOLIO_MODE_STORAGE_KEY, 'not-a-mode{{{');
    expect(readPersistedPortfolioMode()).toEqual({ status: 'invalid', rawValue: 'not-a-mode{{{' });
  });

  it('treats a lowercase near-miss as invalid, never coerced', () => {
    localStorage.setItem(PORTFOLIO_MODE_STORAGE_KEY, 'live');
    expect(readPersistedPortfolioMode()).toEqual({ status: 'invalid', rawValue: 'live' });
  });

  it('treats an old/unversioned-style value as invalid rather than silently accepted', () => {
    localStorage.setItem(PORTFOLIO_MODE_STORAGE_KEY, 'DEMO');
    expect(readPersistedPortfolioMode()).toEqual({ status: 'invalid', rawValue: 'DEMO' });
  });

  it('never returns a "valid" result for anything other than the exact strings LIVE/PAPER', () => {
    for (const bad of ['Live', 'PAPER ', '"LIVE"', '1', 'null']) {
      localStorage.setItem(PORTFOLIO_MODE_STORAGE_KEY, bad);
      const result = readPersistedPortfolioMode();
      expect(result.status).not.toBe('valid');
    }
  });

  it('treats a storage read failure as invalid (unavailable), never as first-use or a default', () => {
    // Simulate a browser blocking storage access (private mode, disabled
    // storage, security exception) rather than "key absent".
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage disabled');
    });
    try {
      expect(readPersistedPortfolioMode()).toEqual({ status: 'invalid', rawValue: null });
    } finally {
      spy.mockRestore();
    }
  });

  it('writePersistedPortfolioMode does not throw when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      expect(() => writePersistedPortfolioMode('LIVE')).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it('a later write overwrites an earlier one (mode switching persists the latest choice)', () => {
    writePersistedPortfolioMode('LIVE');
    writePersistedPortfolioMode('PAPER');
    expect(readPersistedPortfolioMode()).toEqual({ status: 'valid', mode: 'PAPER' });
  });
});
