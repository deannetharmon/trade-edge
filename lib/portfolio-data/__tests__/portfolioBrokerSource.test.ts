import { beforeEach, describe, expect, it, vi } from 'vitest';

const broker = vi.hoisted(() => ({ getAccessToken: vi.fn(), ttFetch: vi.fn() }));
vi.mock('@/lib/tastytrade/client', () => ({
  BASE: 'https://api.test', CLIENT_ID: 'test',
  getAccessToken: broker.getAccessToken, ttFetch: broker.ttFetch,
}));

import { acquirePortfolioBrokerSource, fetchGtcOrders, loadPositions } from '../acquisition';

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

  it('supplements a missing deprecated equity position mark from supported market data', async () => {
    broker.ttFetch.mockImplementation(async (path: string) => {
      if (path === '/customers/me/accounts') return { data: { items: [{ account: { 'account-number': 'ACC1' } }] } };
      if (path === '/accounts/ACC1/positions?include-marks=true') return { data: { items: [{ 'instrument-type': 'Equity', symbol: 'BE', 'underlying-symbol': 'BE', quantity: 100, 'quantity-direction': 'Long', 'average-open-price': 20 }] } };
      if (path === '/market-data/by-type?equity=BE') return { data: { items: [{ symbol: 'BE', bid: '24.90', ask: '25.10' }] } };
      if (path === '/accounts/ACC1/orders/live') return { data: { items: [] } };
      if (path === '/accounts/ACC1/complex-orders?page-offset=0&per-page=50') return { data: { items: [] }, pagination: { 'total-pages': 1 } };
      throw new Error(`unexpected path ${path}`);
    });

    const result = await acquirePortfolioBrokerSource();
    expect(result.rawPositions?.[0]).toMatchObject({
      'average-open-price': 20,
      'mark-price': 25,
    });
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

  it('preserves live GTC evidence when complex-order evidence is unavailable', async () => {
    const orders = await fetchGtcOrders('ACC1', 'token', {
      rawLiveOrders: [{ id: 1, status: 'Working', 'time-in-force': 'GTC', 'order-type': 'Limit', legs: [{ symbol: 'AAPL  260918C00200000', action: 'Sell to Open', quantity: 1 }] }],
      rawComplexOrders: null,
    });
    expect(orders).toHaveLength(1);
  });

  it('preserves complex GTC evidence when live-order evidence is unavailable', async () => {
    const orders = await fetchGtcOrders('ACC1', 'token', {
      rawLiveOrders: null,
      rawComplexOrders: [{ id: 2, orders: [{ id: 3, status: 'Working', 'time-in-force': 'GTC', 'order-type': 'Limit', legs: [{ symbol: 'AAPL  260918C00200000', action: 'Sell to Open', quantity: 1 }] }] }],
    });
    expect(orders.length).toBeGreaterThan(0);
  });

  // Bug fix regression test: an order with legs but a non-GTC TIF and a
  // non-limit/stop type (e.g. a same-day Market order) must NOT be treated
  // as a GTC close order. Previously the TIF/type check was dead code for
  // any order with legs.length > 0 -- ANY such order passed through
  // regardless of its actual time-in-force or order type, which produced a
  // false "GTC Live" badge on positions with zero real working GTC orders.
  it('excludes a Day Market order with legs -- not a GTC close, even though it has legs', async () => {
    const orders = await fetchGtcOrders('ACC1', 'token', {
      rawLiveOrders: [{ id: 4, status: 'Filled', 'time-in-force': 'Day', 'order-type': 'Market', legs: [{ symbol: 'ORCL  261016P00135000', action: 'Buy to Close', quantity: 1 }] }],
      rawComplexOrders: null,
    });
    expect(orders).toHaveLength(0);
  });
});
