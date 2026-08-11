import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';

const acquisition = vi.hoisted(() => ({
  loadPositions: vi.fn(),
  loadAccountBalances: vi.fn(),
  fetchSnapshotStore: vi.fn(),
  attachSnapshotHistory: vi.fn(),
  computeNetEdgeEvidence: vi.fn(() => ({ netEdgeDeclinePct: null, netEdgeNegative: false })),
  scorePortfolioRemainingOpportunity: vi.fn(() => ({ remainingOpportunityPct: null })),
}));

vi.mock('@/lib/portfolio-data/acquisition', () => acquisition);
vi.mock('@/lib/portfolio-intelligence/dashboardComposition', () => ({
  buildDashboardComposition: vi.fn(() => ({
    canonicalPriorities: null,
    todaysPrioritiesDashboard: { urgent: [], manage: [], income: [], monitor: [] },
  })),
}));

import {
  PortfolioDataProvider,
  usePortfolioData,
  type PortfolioDataContextValue,
  type PortfolioRefreshResult,
} from '../PortfolioDataProvider';

let context!: PortfolioDataContextValue;

function Harness() {
  context = usePortfolioData();
  return (
    <div>
      <span data-testid="loading">{String(context.loading)}</span>
      <span data-testid="keys">{context.positions.map(position => position.key).join(',')}</span>
      <span data-testid="error">{context.error}</span>
    </div>
  );
}

function position(key: string, recommendationKind: string): Position {
  return {
    key,
    recommendation: { kind: recommendationKind },
    pricingDecisionEvidence: { marketableDecisionEligible: recommendationKind !== 'verify-pricing' },
  } as unknown as Position;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('PortfolioDataProvider refresh contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquisition.fetchSnapshotStore.mockResolvedValue({});
    acquisition.attachSnapshotHistory.mockImplementation((positions: Position[]) => positions);
    render(<PortfolioDataProvider><Harness /></PortfolioDataProvider>);
  });

  it('resolves only after canonical recommendation recomputation', async () => {
    const raw = position('MU', 'verify-pricing');
    const recomputed = position('MU', 'watch');
    const snapshots = deferred<Record<string, never[]>>();
    acquisition.loadPositions.mockResolvedValue({ positions: [raw], pendingOrders: [] });
    acquisition.fetchSnapshotStore.mockReturnValue(snapshots.promise);
    acquisition.attachSnapshotHistory.mockReturnValue([recomputed]);

    let result!: PortfolioRefreshResult;
    let pending!: Promise<void>;
    act(() => {
      pending = context.refresh().then(value => { result = value; });
    });
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(acquisition.attachSnapshotHistory).not.toHaveBeenCalled();
    await act(async () => {
      snapshots.resolve({});
      await pending;
    });

    expect(acquisition.attachSnapshotHistory).toHaveBeenCalledWith([raw], {}, []);
    expect(result).toEqual({ status: 'success', positions: [recomputed] });
    expect(screen.getByTestId('keys')).toHaveTextContent('MU');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('is latest-wins and never lets an older response replace newer evidence', async () => {
    const older = deferred<{ positions: Position[]; pendingOrders: [] }>();
    const newer = deferred<{ positions: Position[]; pendingOrders: [] }>();
    acquisition.loadPositions
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    let first!: PortfolioRefreshResult;
    let second!: PortfolioRefreshResult;
    const olderCallback = vi.fn();
    const newerCallback = vi.fn();
    await act(async () => {
      const firstPending = context.refresh({ onRawPositionsLoaded: olderCallback }).then(value => { first = value; });
      const secondPending = context.refresh({ onRawPositionsLoaded: newerCallback }).then(value => { second = value; });
      newer.resolve({ positions: [position('NEW', 'watch')], pendingOrders: [] });
      await secondPending;
      older.resolve({ positions: [position('OLD', 'verify-pricing')], pendingOrders: [] });
      await firstPending;
    });

    expect(second.status).toBe('success');
    expect(first).toEqual({ status: 'superseded' });
    expect(screen.getByTestId('keys')).toHaveTextContent('NEW');
    expect(screen.getByTestId('keys')).not.toHaveTextContent('OLD');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(olderCallback).not.toHaveBeenCalled();
    expect(newerCallback).toHaveBeenCalledTimes(1);
  });

  it('suppresses an older request superseded while waiting for snapshot history', async () => {
    const olderSnapshots = deferred<Record<string, never[]>>();
    acquisition.loadPositions
      .mockResolvedValueOnce({ positions: [position('OLD', 'verify-pricing')], pendingOrders: [] })
      .mockResolvedValueOnce({ positions: [position('NEW', 'watch')], pendingOrders: [] });
    acquisition.fetchSnapshotStore
      .mockReturnValueOnce(olderSnapshots.promise)
      .mockResolvedValueOnce({});

    let first!: PortfolioRefreshResult;
    let second!: PortfolioRefreshResult;
    let firstPending!: Promise<void>;
    await act(async () => {
      firstPending = context.refresh().then(value => { first = value; });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(acquisition.fetchSnapshotStore).toHaveBeenCalledTimes(1);

    await act(async () => { second = await context.refresh(); });
    await act(async () => {
      olderSnapshots.resolve({});
      await firstPending;
    });

    expect(second.status).toBe('success');
    expect(first).toEqual({ status: 'superseded' });
    expect(screen.getByTestId('keys')).toHaveTextContent('NEW');
    expect(screen.getByTestId('keys')).not.toHaveTextContent('OLD');
  });

  it('recomputes and succeeds with empty contextual history when snapshot fetch fails', async () => {
    const raw = position('MU', 'verify-pricing');
    const recomputed = position('MU', 'verify-pricing');
    acquisition.loadPositions.mockResolvedValue({ positions: [raw], pendingOrders: [] });
    acquisition.fetchSnapshotStore.mockRejectedValue(new Error('Snapshot store unavailable'));
    acquisition.attachSnapshotHistory.mockReturnValue([recomputed]);

    let result!: PortfolioRefreshResult;
    await act(async () => { result = await context.refresh(); });

    expect(acquisition.attachSnapshotHistory).toHaveBeenCalledWith([raw], {}, []);
    expect(result).toEqual({ status: 'success', positions: [recomputed] });
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('delegates verification continuity to canonical recomputation and clears when eligible', async () => {
    const previous = position('MU', 'verify-pricing');
    const incomplete = {
      ...position('MU', 'watch'),
      pricingDecisionEvidence: { status: 'MID_ONLY', marketableDecisionEligible: false },
    } as Position;
    act(() => { context.setPositions([previous]); });
    acquisition.loadPositions.mockResolvedValue({ positions: [incomplete], pendingOrders: [] });
    const canonicallyLatched = {
      ...incomplete,
      recommendation: {
        kind: 'verify-pricing',
        primaryReason: 'A prior pricing conflict remains unresolved because current broker leg quotes are incomplete.',
      },
    } as Position;
    acquisition.attachSnapshotHistory.mockReturnValue([canonicallyLatched]);

    let result!: PortfolioRefreshResult;
    await act(async () => { result = await context.refresh(); });
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.positions[0].recommendation?.kind).toBe('verify-pricing');
      expect(result.positions[0].pricingDecisionEvidence?.marketableDecisionEligible).toBe(false);
      expect(result.positions[0].recommendation?.primaryReason).toContain('current broker leg quotes are incomplete');
    }
    expect(acquisition.attachSnapshotHistory).toHaveBeenLastCalledWith([incomplete], {}, [previous]);

    const eligible = position('MU', 'watch');
    acquisition.loadPositions.mockResolvedValue({ positions: [eligible], pendingOrders: [] });
    acquisition.attachSnapshotHistory.mockReturnValue([eligible]);
    await act(async () => { result = await context.refresh(); });
    if (result.status === 'success') expect(result.positions[0].recommendation?.kind).toBe('watch');
  });

  it('returns and exposes a truthful broker-refresh failure', async () => {
    acquisition.loadPositions.mockRejectedValue(new Error('Broker unavailable'));
    let result!: PortfolioRefreshResult;
    await act(async () => { result = await context.refresh(); });
    expect(result).toEqual({ status: 'error', message: 'Broker unavailable' });
    expect(screen.getByTestId('error')).toHaveTextContent('Broker unavailable');
  });
});
