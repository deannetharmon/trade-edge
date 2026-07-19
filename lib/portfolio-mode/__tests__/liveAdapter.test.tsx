// lib/portfolio-mode/__tests__/liveAdapter.test.tsx
//
// PT-0002A: behavioral coverage for useLivePortfolioModeAdapter(), on top of
// adapterIsolation.test.ts's static source-scan proof. Mocks the existing,
// canonical usePortfolioData() hook (rather than mounting a real
// PortfolioDataProvider, which would require a live TastyTrade session) to
// confirm the adapter is a pure reshape -- it introduces no acquisition
// logic of its own and calls the underlying refresh() unchanged.

import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLivePortfolioModeAdapter } from '../liveAdapter';

const mockRefresh = vi.fn().mockResolvedValue(undefined);

vi.mock('@/components/portfolio-data/PortfolioDataProvider', () => ({
  usePortfolioData: () => ({
    positions: [{ id: 'p1' }],
    pendingOrders: [{ id: 'o1' }],
    balances: { netLiquidatingValue: 50000 },
    composition: { averagePositionHealth: 72 },
    loading: false,
    error: '',
    lastRefresh: new Date('2026-07-19T09:00:00.000Z'),
    refresh: mockRefresh,
  }),
}));

describe('useLivePortfolioModeAdapter', () => {
  it('reports mode LIVE and reshapes the canonical provider output into the adapter envelope', () => {
    const { result } = renderHook(() => useLivePortfolioModeAdapter());
    expect(result.current.mode).toBe('LIVE');
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
    expect(result.current.lastRefreshedAt).toBe('2026-07-19T09:00:00.000Z');
    expect(result.current.data).toEqual({
      positions: [{ id: 'p1' }],
      pendingOrders: [{ id: 'o1' }],
      balances: { netLiquidatingValue: 50000 },
      composition: { averagePositionHealth: 72 },
    });
  });

  it('refresh() delegates to the canonical provider refresh(), introducing no second acquisition call', async () => {
    const { result } = renderHook(() => useLivePortfolioModeAdapter());
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith();
  });
});
