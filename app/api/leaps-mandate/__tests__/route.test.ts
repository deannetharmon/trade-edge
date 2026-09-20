// app/api/leaps-mandate/__tests__/route.test.ts
//
// LEAPS-MANDATE-0001 -- the income-rules route: authenticated, user-scoped, validated, and only for a long call the broker confirms the
// signed-in user holds. The account used for storage is the broker-confirmed one, never the client's.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSessionUserId = vi.fn();
const fetchHeld = vi.fn();
const readMandate = vi.fn();
const saveMandate = vi.fn();

vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: () => requireSessionUserId() }));
vi.mock('@/lib/jobs/redis', () => ({ getRedis: () => ({ fake: 'redis' }) }));
vi.mock('@/lib/leaps-analysis/serverTradeReview', () => ({ fetchHeldPmccPositionSnapshot: (...args: unknown[]) => fetchHeld(...args) }));
vi.mock('@/lib/leaps-position-intelligence/persistence', () => ({ readMandate: (...args: unknown[]) => readMandate(...args), saveMandate: (...args: unknown[]) => saveMandate(...args) }));

import { GET, POST } from '../route';

const OCC = 'GOOGL 270617C00250000';
const goodMandate = { thesisTargetHigh: 390, incomeCapStrike: 363.55, posture: 'balanced', allowKnownEarningsCycle: false };
const post = (body: unknown) => ({ json: async () => body }) as unknown as import('next/server').NextRequest;
const get = (query: string) => ({ nextUrl: new URL(`http://localhost/api/leaps-mandate?${query}`) }) as unknown as import('next/server').NextRequest;
const validBody = (over: Record<string, unknown> = {}) => ({ underlyingSymbol: 'googl', longOccSymbol: OCC, accountLocator: null, mandate: goodMandate, requestId: 'req-1234567890abcdef', ...over });

beforeEach(() => {
  requireSessionUserId.mockReset().mockResolvedValue('user-a');
  fetchHeld.mockReset().mockResolvedValue({ accountNumber: 'ACCT-REAL', snapshot: { matched: true, quantity: 1, avgOpenPrice: 113.55, currentPrice: 120.45, dte: 270 } });
  readMandate.mockReset().mockResolvedValue(null);
  saveMandate.mockReset().mockResolvedValue('saved');
});

describe('GET /api/leaps-mandate', () => {
  it('requires a session', async () => {
    requireSessionUserId.mockResolvedValue(null);
    expect((await GET(get(`accountNumber=A1&longOcc=${encodeURIComponent(OCC)}`))).status).toBe(401);
    expect(readMandate).not.toHaveBeenCalled();
  });

  it('reads through the signed-in user\'s own scope, never a user id from the request', async () => {
    readMandate.mockResolvedValue({ mandate: { thesisTargetHigh: 390 }, updatedAt: '2026-09-21T10:00:00.000Z' });
    const res = await GET(get(`accountNumber=A1&longOcc=${encodeURIComponent(OCC)}&userId=user-b`));
    expect(readMandate.mock.calls[0][1]).toEqual({ userId: 'user-a', canonicalAccountId: 'A1', longOccSymbol: OCC });
    expect(await res.json()).toEqual({ mandate: { thesisTargetHigh: 390 }, updatedAt: '2026-09-21T10:00:00.000Z' });
  });

  it('returns null when nothing is saved', async () => {
    expect(await (await GET(get(`accountNumber=A1&longOcc=${encodeURIComponent(OCC)}`))).json()).toEqual({ mandate: null, updatedAt: null });
  });

  it.each([['', ''], ['A1', ''], ['', 'x'], ['A1;DROP', 'x']])('rejects bad identifiers (%j, %j)', async (account, occ) => {
    expect((await GET(get(`accountNumber=${encodeURIComponent(account)}&longOcc=${encodeURIComponent(occ)}`))).status).toBe(400);
  });
});

describe('POST /api/leaps-mandate', () => {
  it('requires a session and does nothing without one', async () => {
    requireSessionUserId.mockResolvedValue(null);
    expect((await POST(post(validBody()))).status).toBe(401);
    expect(fetchHeld).not.toHaveBeenCalled();
    expect(saveMandate).not.toHaveBeenCalled();
  });

  it('saves for the broker-confirmed account and user, with an immutable audit event', async () => {
    const res = await POST(post(validBody({ accountNumber: 'ATTACKER-ACCOUNT' })));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, result: 'saved', mandate: { version: 'LEAPS-PI-1.1', thesisTargetHigh: 390, incomeCapStrike: 363.55, posture: 'balanced' } });
    expect(fetchHeld).toHaveBeenCalledWith('user-a', { accountLocator: null, underlyingSymbol: 'GOOGL', longOccSymbol: OCC });
    const [, identity, record, event, requestId] = saveMandate.mock.calls[0];
    expect(identity).toEqual({ userId: 'user-a', canonicalAccountId: 'ACCT-REAL', longOccSymbol: OCC });
    expect(record.mandate.thesisTargetHigh).toBe(390);
    expect(event).toMatchObject({ type: 'mandate-changed', actor: 'trader', policyVersion: 'LEAPS-PI-1.1', retention: 'append-only', requestId: 'req-1234567890abcdef', payload: { mandate: record.mandate } });
    expect(requestId).toBe(event.requestId);
  });

  it('rejects an invalid mandate before touching the broker or storage', async () => {
    const res = await POST(post(validBody({ mandate: { thesisTargetHigh: -1, posture: 'yolo' } })));
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual(expect.arrayContaining(['Target price must be a positive number.']));
    expect(fetchHeld).not.toHaveBeenCalled();
    expect(saveMandate).not.toHaveBeenCalled();
  });

  it('refuses a contract the broker does not show as a held long call', async () => {
    for (const snapshot of [{ matched: false, quantity: 0 }, { matched: true, quantity: 0 }]) {
      fetchHeld.mockResolvedValue({ accountNumber: 'ACCT-REAL', snapshot });
      const res = await POST(post(validBody()));
      expect(res.status).toBe(404);
    }
    expect(saveMandate).not.toHaveBeenCalled();
  });

  it('a broker failure is a 502 with no detail leaked and nothing saved', async () => {
    fetchHeld.mockRejectedValue(new Error('TASTYTRADE secret detail'));
    const res = await POST(post(validBody()));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
    expect(saveMandate).not.toHaveBeenCalled();
  });

  it('a replayed request id is reported as replayed, not saved twice', async () => {
    saveMandate.mockResolvedValue('replayed');
    expect((await (await POST(post(validBody()))).json()).result).toBe('replayed');
  });

  it('a storage failure is a 500 with no detail leaked', async () => {
    saveMandate.mockRejectedValue(new Error('redis secret'));
    const res = await POST(post(validBody()));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });

  it('generates a request id when none (or a malformed one) is supplied', async () => {
    await POST(post(validBody({ requestId: 'short' })));
    expect(saveMandate.mock.calls[0][4]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([[{ underlyingSymbol: '' }], [{ longOccSymbol: '' }], [{ longOccSymbol: 'x;y' }]])('rejects missing or malformed identifiers %j', async over => {
    expect((await POST(post(validBody(over)))).status).toBe(400);
    expect(saveMandate).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON', async () => {
    const res = await POST({ json: async () => { throw new Error('bad'); } } as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(400);
  });
});
