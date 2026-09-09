import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServerSession, persistPromotedPendingEntry, readPendingCreditSpreadEntry, getServerBrokerAccessToken, serverBrokerFetch } = vi.hoisted(() => ({ getServerSession: vi.fn(), persistPromotedPendingEntry: vi.fn(), readPendingCreditSpreadEntry: vi.fn(), getServerBrokerAccessToken: vi.fn(), serverBrokerFetch: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/entry-context/promote', () => ({ persistPromotedPendingEntry }));
vi.mock('@/lib/entry-context/pendingStore', () => ({ readPendingCreditSpreadEntry }));
vi.mock('@/lib/tastytrade/server-token', () => ({ getServerBrokerAccessToken, serverBrokerFetch }));
vi.mock('@/lib/entry-context/store', () => ({ entrySnapshotOwnerScope: (userId: string, accountId: string) => `${userId}:${accountId}` }));
import { POST } from '../route';

describe('entry-context promotion route', () => {
  beforeEach(() => { getServerSession.mockReset(); persistPromotedPendingEntry.mockReset(); readPendingCreditSpreadEntry.mockReset(); getServerBrokerAccessToken.mockReset(); serverBrokerFetch.mockReset(); });
  it('requires authentication', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await POST(new Request('http://local', { method: 'POST', body: '{}' }) as never)).status).toBe(401);
  });
  it('reports incomplete fills without inventing a snapshot', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } }); readPendingCreditSpreadEntry.mockResolvedValue({ accountId: 'acct', brokerOrderId: 'order', submittedAt: '2026-09-09T00:00:00.000Z' }); getServerBrokerAccessToken.mockResolvedValue('token'); serverBrokerFetch.mockResolvedValueOnce({ data: { items: [{ account: { 'account-number': 'acct' } }] } }).mockResolvedValueOnce({ data: { items: [] } }); persistPromotedPendingEntry.mockResolvedValue(null);
    const response = await POST(new Request('http://local', { method: 'POST', body: JSON.stringify({ accountId: 'acct', brokerOrderId: 'order' }) }) as never);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ promoted: false });
  });
  it('returns the persisted immutable snapshot after all fills confirm', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } });
    readPendingCreditSpreadEntry.mockResolvedValue({ accountId: 'acct', brokerOrderId: 'order', submittedAt: '2026-09-09T00:00:00.000Z' }); getServerBrokerAccessToken.mockResolvedValue('token'); serverBrokerFetch.mockResolvedValueOnce({ data: { items: [{ account: { 'account-number': 'acct' } }] } }).mockResolvedValueOnce({ data: { items: [{ id: 'a' }] } }); persistPromotedPendingEntry.mockResolvedValue({ created: false, snapshot: { entrySnapshotId: 'entry-v1:acct:tx', executionId: 'tx' } });
    const response = await POST(new Request('http://local', { method: 'POST', body: JSON.stringify({ accountId: 'acct', brokerOrderId: 'order' }) }) as never);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ promoted: true, created: false, snapshot: { executionId: 'tx' } });
  });
  it('reads every broker transaction page before evaluating promotion', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } });
    readPendingCreditSpreadEntry.mockResolvedValue({ accountId: 'acct', brokerOrderId: 'order', submittedAt: '2026-09-09T00:00:00.000Z' }); getServerBrokerAccessToken.mockResolvedValue('token');
    const firstPage = Array.from({ length: 250 }, (_, id) => ({ id: `tx-${id}` }));
    serverBrokerFetch.mockResolvedValueOnce({ data: { items: [{ account: { 'account-number': 'acct' } }] } })
      .mockResolvedValueOnce({ data: { items: firstPage }, pagination: { 'total-items': 251 } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'tx-250' }] }, pagination: { 'total-items': 251 } });
    persistPromotedPendingEntry.mockResolvedValue(null);
    const response = await POST(new Request('http://local', { method: 'POST', body: JSON.stringify({ accountId: 'acct', brokerOrderId: 'order' }) }) as never);
    expect(response.status).toBe(200);
    expect(persistPromotedPendingEntry).toHaveBeenCalledWith(expect.anything(), [], expect.arrayContaining([{ id: 'tx-0' }, { id: 'tx-250' }]), 'u:acct');
  });
  it('refuses promotion for a broker account the authenticated user does not own', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } });
    readPendingCreditSpreadEntry.mockResolvedValue({ accountId: 'acct', brokerOrderId: 'order', submittedAt: '2026-09-09T00:00:00.000Z' }); getServerBrokerAccessToken.mockResolvedValue('token');
    serverBrokerFetch.mockResolvedValueOnce({ data: { items: [{ account: { 'account-number': 'different-account' } }] } });
    const response = await POST(new Request('http://local', { method: 'POST', body: JSON.stringify({ accountId: 'acct', brokerOrderId: 'order' }) }) as never);
    expect(response.status).toBe(403);
    expect(persistPromotedPendingEntry).not.toHaveBeenCalled();
  });
});
