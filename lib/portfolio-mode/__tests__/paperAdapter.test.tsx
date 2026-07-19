// lib/portfolio-mode/__tests__/paperAdapter.test.tsx
//
// PT-0002A: behavioral coverage for usePaperPortfolioModeAdapter(), on top
// of adapterIsolation.test.ts's static source-scan proof. Confirms the
// adapter reads exclusively via the PT-0001 API route and maps its
// loading/ready/error states correctly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePaperPortfolioModeAdapter } from '../paperAdapter';

describe('usePaperPortfolioModeAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts in loading status with mode PAPER and no data', () => {
    const { result } = renderHook(() => usePaperPortfolioModeAdapter());
    expect(result.current.mode).toBe('PAPER');
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('does not fetch on its own -- refresh() is caller-driven', () => {
    renderHook(() => usePaperPortfolioModeAdapter());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refresh() calls exactly the PT-0001 account route and populates data on success', async () => {
    const view = { ledger: { schemaVersion: 1 }, availableCapital: 1000 };
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ view }),
    });

    const { result } = renderHook(() => usePaperPortfolioModeAdapter());
    await act(async () => {
      await result.current.refresh();
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/paper-trading/account');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual({ ledgerView: view });
    expect(result.current.lastRefreshedAt).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('refresh() surfaces a server-reported error without touching data', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const { result } = renderHook(() => usePaperPortfolioModeAdapter());
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Unauthorized');
    expect(result.current.data).toBeNull();
  });

  it('refresh() surfaces a network failure as an error state', async () => {
    (global.fetch as any).mockRejectedValue(new Error('Network down'));

    const { result } = renderHook(() => usePaperPortfolioModeAdapter());
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Network down');
  });
});
