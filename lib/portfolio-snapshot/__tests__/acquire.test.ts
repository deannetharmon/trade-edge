import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';

const adapter = vi.hoisted(() => ({ acquirePortfolioBrokerSource: vi.fn(), loadPositions: vi.fn() }));
vi.mock('@/lib/portfolio-data/acquisition', () => adapter);
import { acquirePortfolioSnapshot, acquireSnapshot } from '../acquire';

const rawEquity = {
  'instrument-type': 'Equity', 'underlying-symbol': 'MSFT', symbol: 'MSFT',
  quantity: 250, 'quantity-direction': 'Long', 'average-open-price': 300,
  'mark-price': 310,
};
const option = { key: 'MSFT::2027', symbol: 'MSFT', accountNumber: 'ACC1', legs: [] } as unknown as Position;
const source = (overrides: Record<string, unknown> = {}) => ({
  token: 'token', accountNumber: 'ACC1', rawPositions: [rawEquity], rawLiveOrders: [], rawComplexOrders: [], ...overrides,
});

describe('acquireSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapter.acquirePortfolioBrokerSource.mockResolvedValue(source());
    adapter.loadPositions.mockResolvedValue({ positions: [option], pendingOrders: [] });
  });

  it('passes one source to option and equity normalization', async () => {
    const brokerSource = source();
    adapter.acquirePortfolioBrokerSource.mockResolvedValue(brokerSource);
    const snapshot = await acquireSnapshot('token');
    expect(adapter.acquirePortfolioBrokerSource).toHaveBeenCalledOnce();
    expect(adapter.loadPositions).toHaveBeenCalledWith(brokerSource);
    expect(snapshot.options).toEqual([option]);
    expect(snapshot.equities[0]).toMatchObject({ accountNumber: 'ACC1', symbol: 'MSFT', quantity: 250 });
  });

  it('returns pending orders from the same acquisition', async () => {
    const pendingOrders = [{ id: 'pending' }];
    adapter.loadPositions.mockResolvedValue({ positions: [option], pendingOrders });
    expect((await acquirePortfolioSnapshot()).pendingOrders).toBe(pendingOrders);
  });

  it('keeps holdings visible and fails capacity closed when orders fail', async () => {
    adapter.acquirePortfolioBrokerSource.mockResolvedValue(source({ rawLiveOrders: null }));
    const snapshot = await acquireSnapshot();
    expect(snapshot.equities).toHaveLength(1);
    expect(snapshot.options).toEqual([option]);
    expect(snapshot.dataQuality.status).toBe('unavailable');
    expect(snapshot.coverageEvidence.complete).toBe(false);
  });

  it('keeps live evidence visible but fails capacity closed when complex orders fail', async () => {
    adapter.acquirePortfolioBrokerSource.mockResolvedValue(source({ rawComplexOrders: null }));
    const snapshot = await acquireSnapshot();
    expect(snapshot.equities).toHaveLength(1);
    expect(snapshot.workingOrders).toEqual([]);
    expect(snapshot.dataQuality.status).toBe('unavailable');
    expect(snapshot.coverageEvidence.complete).toBe(false);
  });

  it('fails capacity closed when live orders fail but complex evidence remains', async () => {
    adapter.acquirePortfolioBrokerSource.mockResolvedValue(source({ rawLiveOrders: null, rawComplexOrders: [] }));
    const snapshot = await acquireSnapshot();
    expect(snapshot.equities).toHaveLength(1);
    expect(snapshot.dataQuality.status).toBe('unavailable');
    expect(snapshot.coverageEvidence.complete).toBe(false);
  });

  it('fails capacity closed when both order evidence sources fail', async () => {
    adapter.acquirePortfolioBrokerSource.mockResolvedValue(source({ rawLiveOrders: null, rawComplexOrders: null }));
    expect((await acquireSnapshot()).coverageEvidence.complete).toBe(false);
  });

  it('keeps snapshot observation time separate from unknown quote provenance, but records honest per-equity quote provenance when a live mark is present', async () => {
    const snapshot = await acquireSnapshot();
    expect(snapshot.asOf).toBeTruthy();
    // Top-level PortfolioSnapshot.quoteAsOf remains a separate, still-unset aggregate concept --
    // unaffected by per-equity quote provenance.
    expect(snapshot.quoteAsOf).toBeNull();
    // rawEquity's fixture carries a valid mark-price (310), so this equity's own quote provenance
    // is now honestly the snapshot's own fetch timestamp, and the quote is fresh (not stale) --
    // per the fix wiring EquityHolding.quoteAsOf/staleQuote from the caller-supplied asOf and
    // whether the price came from a live mark vs. a prior-close fallback.
    expect(snapshot.equities[0].quoteAsOf).toBe(snapshot.asOf);
    expect(snapshot.equities[0].staleQuote).toBe(false);
    expect(snapshot.dataQuality.staleQuotes).toBe(false);
  });

  it('fails closed when positions fail without invoking option normalization', async () => {
    adapter.acquirePortfolioBrokerSource.mockResolvedValue(source({ rawPositions: null }));
    const snapshot = await acquireSnapshot();
    expect(snapshot.dataQuality.status).toBe('unavailable');
    expect(snapshot.options).toEqual([]);
    expect(adapter.loadPositions).not.toHaveBeenCalled();
  });
});
