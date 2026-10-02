// lib/suggested-actions/__tests__/useSuggestedActions.test.tsx

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { Position } from '@/lib/portfolio-data/types';
import type { PortfolioSnapshot, SnapshotDataQuality } from '@/lib/portfolio-snapshot/types';
import { useSuggestedActions, type UseSuggestedActionsInput } from '../useSuggestedActions';

const quality = { status: 'ok' } as unknown as SnapshotDataQuality;

function leap(key: string, mark: number): Position {
  return {
    key, symbol: 'AAPL', accountNumber: '5WT1', dte: 350, expDate: '2027-09-17', quantity: 1, stockPrice: 190, intent: 'income',
    structureAmbiguous: false, pairedShortCallKey: null,
    legs: [{ symbol: 'AAPL  270917C00100000', direction: 'Long', optionType: 'C', strikePrice: 100, quantity: 1, avgOpenPrice: 10, currentPrice: mark, currentDelta: 0.8 }],
  } as unknown as Position;
}

function input(mark: number, over: Partial<UseSuggestedActionsInput> = {}): UseSuggestedActionsInput {
  const positions = [leap('p1', mark)];
  const snapshot = { freshness: 'current', accountNumber: '5WT1', dataQuality: { status: 'ok' }, options: positions, equities: [], workingOrders: [], coverageEvidence: { complete: false, warnings: [] } } as unknown as PortfolioSnapshot;
  return { enabled: true, positions, pendingOrders: [], snapshot, snapshotDataQuality: quality, lastRefresh: new Date(), ...over };
}

let fetchMock: Mock<[string, RequestInit?], Promise<Response>>;
let savedState: Record<string, string>;

beforeEach(() => {
  savedState = {};
  fetchMock = vi.fn<[string, RequestInit?], Promise<Response>>(async (_url, init) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({ armed: savedState }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const posts = () => fetchMock.mock.calls.filter(c => c[1]?.method === 'POST');
const postedArmed = (index: number) => JSON.parse(String(posts()[index][1]?.body)).armed as Record<string, string>;

describe('useSuggestedActions', () => {
  it('shows a +100% LEAP and saves the armed state once', async () => {
    const { result } = renderHook(() => useSuggestedActions(input(20)));
    await waitFor(() => expect(result.current.cards).toHaveLength(1));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(Object.keys(postedArmed(0))).toEqual(['p1']);
    await act(async () => { await Promise.resolve(); });
    expect(posts()).toHaveLength(1);
  });

  it('keeps a saved card at 95% (hysteresis across devices) and releases and saves at 85%', async () => {
    savedState = { p1: '2026-10-01T15:00:00.000Z' };
    const keep = renderHook(() => useSuggestedActions(input(19.5)));
    await waitFor(() => expect(keep.result.current.cards).toHaveLength(1));
    expect(posts()).toHaveLength(0);

    const release = renderHook(() => useSuggestedActions(input(18.5)));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(postedArmed(0)).toEqual({});
    expect(release.result.current.cards).toHaveLength(0);
  });

  it('does nothing when disabled (paper mode)', async () => {
    const { result } = renderHook(() => useSuggestedActions(input(20, { enabled: false })));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.cards).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the plain +100% test, with no save, when saved state cannot be loaded', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }));
    const high = renderHook(() => useSuggestedActions(input(20)));
    await waitFor(() => expect(high.result.current.cards).toHaveLength(1));
    const mid = renderHook(() => useSuggestedActions(input(19.5)));
    await act(async () => { await Promise.resolve(); });
    expect(mid.result.current.cards).toHaveLength(0);
    expect(posts()).toHaveLength(0);
  });

  it('shows no cards, and changes no saved state, without current broker evidence', async () => {
    savedState = { p1: '2026-10-01T15:00:00.000Z' };
    const noSnapshot = input(20, { snapshot: null });
    const { result } = renderHook(() => useSuggestedActions(noSnapshot));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.cards).toHaveLength(0);
    expect(posts()).toHaveLength(0);
  });

  it('a refresh older than 2 minutes marks the cards stale', async () => {
    const old = new Date(Date.now() - 3 * 60 * 1000);
    const { result } = renderHook(() => useSuggestedActions(input(20, { lastRefresh: old })));
    await waitFor(() => expect(result.current.cards).toHaveLength(1));
    expect(result.current.stale).toBe(true);
    expect(posts()).toHaveLength(0);
  });
});
