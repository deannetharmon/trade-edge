import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';
import type { PortfolioSnapshot } from '@/lib/portfolio-snapshot/types';

const snapshotAdapter = vi.hoisted(() => ({ acquirePortfolioSnapshot: vi.fn() }));
vi.mock('@/lib/portfolio-snapshot/acquire', () => ({
  LCC_0001A_SNAPSHOT_ENABLED: true,
  acquirePortfolioSnapshot: snapshotAdapter.acquirePortfolioSnapshot,
}));
const acquisition = vi.hoisted(() => ({
  loadPositions: vi.fn(), loadAccountBalances: vi.fn(), fetchSnapshotStore: vi.fn(),
  attachSnapshotHistory: vi.fn((positions: Position[]) => positions),
  computeNetEdgeEvidence: vi.fn(() => ({ netEdgeDeclinePct: null, netEdgeNegative: false })),
  scorePortfolioRemainingOpportunity: vi.fn(() => ({ remainingOpportunityPct: null })),
}));
vi.mock('@/lib/portfolio-data/acquisition', () => acquisition);
vi.mock('@/lib/portfolio/trendFetch', () => ({ fetchTrendStore: vi.fn(async () => ({})) }));
vi.mock('@/lib/portfolio-intelligence/dashboardComposition', () => ({
  buildDashboardComposition: vi.fn(() => ({ canonicalPriorities: null, todaysPrioritiesDashboard: { urgent: [], manage: [], income: [], monitor: [] } })),
}));

import { PortfolioDataProvider, usePortfolioData, type PortfolioDataContextValue } from '../PortfolioDataProvider';

let context!: PortfolioDataContextValue;
function Harness() {
  context = usePortfolioData();
  return <><span data-testid="keys">{context.positions.map(p => p.key).join(',')}</span><span data-testid="quality">{context.snapshotDataQuality.status}</span></>;
}
const position = (key: string) => ({ key, symbol: key, legs: [], accountNumber: 'ACC1' } as unknown as Position);
const snapshot = (positions: Position[], status: 'ok' | 'unavailable' = 'ok', reason?: string): PortfolioSnapshot => ({
  accountNumber: 'ACC1', asOf: '2026-08-22T00:00:00.000Z', quoteAsOf: null,
  equities: [], options: positions, workingOrders: [],
  coverageEvidence: { existingShortCallsBySymbol: {}, workingShortCallsBySymbol: {}, unclassifiedSymbols: [], complete: status === 'ok', warnings: [] },
  dataQuality: { status, unavailableReason: reason, staleQuotes: false, warnings: [] },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

describe('PortfolioDataProvider snapshot-enabled path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquisition.fetchSnapshotStore.mockResolvedValue({});
    acquisition.attachSnapshotHistory.mockImplementation((positions: Position[]) => positions);
    render(<PortfolioDataProvider><Harness /></PortfolioDataProvider>);
  });

  it('uses the unified acquisition and never invokes the legacy fetch path', async () => {
    const shared = snapshot([position('SHARED')]);
    snapshotAdapter.acquirePortfolioSnapshot.mockResolvedValue({ snapshot: shared, pendingOrders: [] });
    await act(async () => { await context.refresh(); });
    expect(snapshotAdapter.acquirePortfolioSnapshot).toHaveBeenCalledOnce();
    expect(acquisition.loadPositions).not.toHaveBeenCalled();
    expect(screen.getByTestId('keys')).toHaveTextContent('SHARED');
    expect(context.snapshot?.options).toEqual(context.positions);
  });

  it('preserves latest-request-wins for the snapshot-enabled path', async () => {
    const older = deferred<{ snapshot: PortfolioSnapshot; pendingOrders: [] }>();
    const newer = deferred<{ snapshot: PortfolioSnapshot; pendingOrders: [] }>();
    snapshotAdapter.acquirePortfolioSnapshot.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    let firstPending!: Promise<unknown>;
    await act(async () => { firstPending = context.refresh(); await Promise.resolve(); });
    await act(async () => { newer.resolve({ snapshot: snapshot([position('NEW')]), pendingOrders: [] }); await context.refresh(); });
    await act(async () => { older.resolve({ snapshot: snapshot([position('OLD')]), pendingOrders: [] }); await firstPending; });
    expect(screen.getByTestId('keys')).toHaveTextContent('NEW');
    expect(screen.getByTestId('keys')).not.toHaveTextContent('OLD');
  });

  it('retains cached holdings when a later positions refresh fails', async () => {
    snapshotAdapter.acquirePortfolioSnapshot.mockResolvedValueOnce({ snapshot: snapshot([position('CACHED')]), pendingOrders: [] });
    await act(async () => { await context.refresh(); });
    snapshotAdapter.acquirePortfolioSnapshot.mockResolvedValueOnce({
      snapshot: snapshot([], 'unavailable', 'Portfolio snapshot unavailable: broker positions could not be loaded.'), pendingOrders: [],
    });
    let result: unknown;
    await act(async () => { result = await context.refresh(); });
    expect(result).toMatchObject({ status: 'error' });
    expect(screen.getByTestId('keys')).toHaveTextContent('CACHED');
    expect(screen.getByTestId('quality')).toHaveTextContent('unavailable');
  });
});
