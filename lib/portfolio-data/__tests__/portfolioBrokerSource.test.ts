import { beforeEach, describe, expect, it, vi } from 'vitest';

const broker = vi.hoisted(() => ({ getAccessToken: vi.fn(), ttFetch: vi.fn() }));
vi.mock('@/lib/tastytrade/client', () => ({
  BASE: 'https://api.test', CLIENT_ID: 'test',
  getAccessToken: broker.getAccessToken, ttFetch: broker.ttFetch,
}));

import { acquirePortfolioBrokerSource } from '../acquisition';

describe('acquirePortfolioBrokerSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    broker.getAccessToken.mockResolvedValue('token');
    broker.ttFetch.mockImplementation(async (path: string) => {
      if (path === '/customers/me/accounts') {
        return { data: { items: [{ account: { 'account-number': 'ACC1' } }] } };
      }
      if (path === '/accounts/ACC1/positions') return { data: { items: [{ symbol: 'position' }] } };
      if (path === '/accounts/ACC1/orders/live') return { data: { items: [{ id: 'order' }] } };
      throw new Error(`unexpected path ${path}`);
    });
  });

  it('fetches positions and live orders exactly once for one account', async () => {
    const result = await acquirePortfolioBrokerSource();
    expect(result.accountNumber).toBe('ACC1');
    expect(result.rawPositions).toEqual([{ symbol: 'position' }]);
    expect(result.rawLiveOrders).toEqual([{ id: 'order' }]);
    expect(broker.ttFetch.mock.calls.filter(([path]) => String(path).endsWith('/positions'))).toHaveLength(1);
    expect(broker.ttFetch.mock.calls.filter(([path]) => String(path).endsWith('/orders/live'))).toHaveLength(1);
  });

  it('retains an orders failure as null without losing positions', async () => {
    broker.ttFetch.mockImplementation(async (path: string) => {
      if (path === '/customers/me/accounts') return { data: { items: [{ account: { 'account-number': 'ACC1' } }] } };
      if (path.endsWith('/positions')) return { data: { items: [{ symbol: 'position' }] } };
      throw new Error('orders unavailable');
    });
    const result = await acquirePortfolioBrokerSource();
    expect(result.rawPositions).toHaveLength(1);
    expect(result.rawLiveOrders).toBeNull();
  });
});
