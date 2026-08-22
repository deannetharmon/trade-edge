import { beforeEach, describe, expect, it, vi } from 'vitest';

const broker = vi.hoisted(() => ({ getAccessToken: vi.fn(), ttFetch: vi.fn() }));
vi.mock('@/lib/tastytrade/client', () => ({
  BASE: 'https://api.test', CLIENT_ID: 'test',
  getAccessToken: broker.getAccessToken, ttFetch: broker.ttFetch,
}));

import { acquirePortfolioBrokerSource, loadPositions } from '../acquisition';

describe('acquirePortfolioBrokerSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    broker.getAccessToken.mockResolvedValue('token');
    broker.ttFetch.mockImplementation(async (path: string) => {
      if (path === '/customers/me/accounts') {
        return { data: { items: [{ account: { 'account-number': 'ACC1' } }] } };
      }
      if (path === '/accounts/ACC1/positions?include-marks=true') return { data: { items: [{ 'instrument-type': 'Equity', symbol: 'MSFT', 'underlying-symbol': 'MSFT', quantity: 100, 'quantity-direction': 'Long', 'average-open-price': 100, 'mark-price': 110 }] } };
      if (path === '/accounts/ACC1/orders/live') return { data: { items: [{ id: 'order' }] } };
      if (path === '/accounts/ACC1/complex-orders?page-offset=0&per-page=50') return { data: { items: [] }, pagination: { 'total-pages': 1 } };
      throw new Error(`unexpected path ${path}`);
    });
  });

  it('fetches positions and live orders exactly once for one account', async () => {
    const result = await acquirePortfolioBrokerSource();
    expect(result.accountNumber).toBe('ACC1');
    expect(result.rawPositions).toHaveLength(1);
    expect(result.rawLiveOrders).toEqual([{ id: 'order' }]);
    expect(broker.ttFetch.mock.calls.filter(([path]) => String(path).includes('/positions'))).toHaveLength(1);
    expect(broker.ttFetch.mock.calls.filter(([path]) => String(path).endsWith('/orders/live'))).toHaveLength(1);
  });

  it('does not reacquire positions or order evidence when the mature adapter consumes the source', async () => {
    const source = await acquirePortfolioBrokerSource();
    await loadPositions(source);
    expect(broker.ttFetch.mock.calls.filter(([path]) => String(path).includes('/positions'))).toHaveLength(1);
    expect(broker.ttFetch.mock.calls.filter(([path]) => String(path).endsWith('/orders/live'))).toHaveLength(1);
    expect(broker.ttFetch.mock.calls.filter(([path]) => String(path).includes('/complex-orders'))).toHaveLength(1);
  });

  it('retains an orders failure as null without losing positions', async () => {
    broker.ttFetch.mockImplementation(async (path: string) => {
      if (path === '/customers/me/accounts') return { data: { items: [{ account: { 'account-number': 'ACC1' } }] } };
      if (path.includes('/positions')) return { data: { items: [{ symbol: 'position' }] } };
      throw new Error('orders unavailable');
    });
    const result = await acquirePortfolioBrokerSource();
    expect(result.rawPositions).toHaveLength(1);
    expect(result.rawLiveOrders).toBeNull();
  });
});
