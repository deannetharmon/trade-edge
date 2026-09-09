import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServerSession, readEntrySnapshotsForAccount } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  readEntrySnapshotsForAccount: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/entry-context/store', () => ({
  readEntrySnapshotsForAccount,
  entrySnapshotOwnerScope: (userId: string, accountId: string) => `${userId}:${accountId}`,
}));

import { GET } from '../route';

describe('entry-context snapshot route', () => {
  beforeEach(() => { getServerSession.mockReset(); readEntrySnapshotsForAccount.mockReset(); });
  it('rejects unauthenticated snapshot reads', async () => {
    getServerSession.mockResolvedValue(null);
    const response = await GET({ nextUrl: new URL('http://localhost/api/entry-context/snapshots?accountId=acct') } as never);
    expect(response.status).toBe(401);
  });
  it('reads only through the authenticated snapshot boundary', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user' } }); readEntrySnapshotsForAccount.mockResolvedValue([]);
    const response = await GET({ nextUrl: new URL('http://localhost/api/entry-context/snapshots?accountId=acct') } as never);
    expect(response.status).toBe(200); expect(readEntrySnapshotsForAccount).toHaveBeenCalledWith('acct', undefined, 'user:acct');
  });
});
