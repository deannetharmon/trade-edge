import { beforeEach, describe, expect, it, vi } from 'vitest';
const { getServerSession, savePendingCreditSpreadEntry, readPendingCreditSpreadEntry, readPendingCreditSpreadEntries } = vi.hoisted(() => ({ getServerSession: vi.fn(), savePendingCreditSpreadEntry: vi.fn(), readPendingCreditSpreadEntry: vi.fn(), readPendingCreditSpreadEntries: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/entry-context/pendingStore', () => ({ savePendingCreditSpreadEntry, readPendingCreditSpreadEntry, readPendingCreditSpreadEntries }));
vi.mock('@/lib/entry-context/store', () => ({ entrySnapshotOwnerScope: (user: string, account: string) => `${user}:${account}` }));
import { GET, POST } from '../route';

describe('pending entry route', () => {
  beforeEach(() => { getServerSession.mockReset(); savePendingCreditSpreadEntry.mockReset(); readPendingCreditSpreadEntry.mockReset(); readPendingCreditSpreadEntries.mockReset(); });
  it('requires an authenticated owner', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await POST(new Request('http://local', { method: 'POST', body: '{}' }) as never)).status).toBe(401);
  });
  it('requires account and order identity when reading', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } });
    expect((await GET({ nextUrl: new URL('http://local/api/entry-context/pending') } as never)).status).toBe(400);
  });
  it('stores submitted context under the authenticated owner scope', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } });
    const body = { accountId: 'acct', brokerOrderId: 'order', openingOrderIds: ['component-order'], submittedAt: '2026-09-09T00:00:00.000Z', strategy: 'BPS', symbol: 'SPY', expiration: '2026-10-16', shortStrike: 600, longStrike: 595, quantity: 1 };
    const response = await POST(new Request('http://local', { method: 'POST', body: JSON.stringify(body) }) as never);
    expect(response.status).toBe(201); expect(savePendingCreditSpreadEntry).toHaveBeenCalledWith(expect.objectContaining(body), 'u:acct');
  });
  it('lists only the authenticated owner account’s pending entries for reconciliation', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } });
    readPendingCreditSpreadEntries.mockResolvedValue([{ brokerOrderId: 'complex', openingOrderIds: ['entry'] }]);
    const response = await GET({ nextUrl: new URL('http://local/api/entry-context/pending?accountId=acct') } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pending: [{ brokerOrderId: 'complex', openingOrderIds: ['entry'] }] });
    expect(readPendingCreditSpreadEntries).toHaveBeenCalledWith('u:acct');
  });
  it('rejects incomplete trade structure', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } });
    const response = await POST(new Request('http://local', { method: 'POST', body: JSON.stringify({ accountId: 'acct', brokerOrderId: 'order', submittedAt: '2026-09-09T00:00:00.000Z' }) }) as never);
    expect(response.status).toBe(400); expect(savePendingCreditSpreadEntry).not.toHaveBeenCalled();
  });
});
