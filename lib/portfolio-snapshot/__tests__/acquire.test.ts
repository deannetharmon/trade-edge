import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';

const adapter = vi.hoisted(() => ({ acquirePortfolioBrokerSource: vi.fn(), loadPositions: vi.fn() }));
vi.mock('@/lib/portfolio-data/acquisition', () => adapter);
import { acquirePortfolioSnapshot, acquireSnapshot } from '../acquire';

const rawEquity = {
  'instrument-type': 'Equity', 'underlying-symbol': 'MSFT', symbol: 'MSFT',
  quantity: 250, 'quantity-direction': 'Long', 'average-open-price': 300,
};
const option = { key: 'MSFT::2027', symbol: 'MSFT', accountNumber: 'ACC1', legs: [] } as unknown as Position;
const source = (overrides: Record<string, unknown> = {}) => ({
  token: 'token', accountNumber: 'ACC1', rawPositions: [rawEquity], rawLiveOrders: [], ...overrides,
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

  it('fails closed when positions fail without invoking option normalization', async () => {
    adapter.acquirePortfolioBrokerSource.mockResolvedValue(source({ rawPositions: null }));
    const snapshot = await acquireSnapshot();
    expect(snapshot.dataQuality.status).toBe('unavailable');
    expect(snapshot.options).toEqual([]);
    expect(adapter.loadPositions).not.toHaveBeenCalled();
  });
});
