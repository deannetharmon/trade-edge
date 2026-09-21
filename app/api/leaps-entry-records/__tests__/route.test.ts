// app/api/leaps-entry-records/__tests__/route.test.ts
//
// LEAPS-ENTRY-0001 -- read-only, authenticated, user-scoped; there is no way to write a record through the API.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSessionUserId = vi.fn();
const lrange = vi.fn();
vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: () => requireSessionUserId() }));
vi.mock('@/lib/jobs/redis', () => ({ getRedis: () => ({ lrange: (...args: unknown[]) => lrange(...args) }) }));

import * as route from '../route';
import { buildEntryRecord } from '@/lib/leaps-position-intelligence/entryRecords';
import { entryRecordsKey } from '@/lib/leaps-position-intelligence/entryRecordsStore';

const OCC = 'GOOGL 270617C00250000';
const get = (query: string) => ({ nextUrl: new URL(`http://localhost/api/leaps-entry-records?${query}`) }) as unknown as import('next/server').NextRequest;
const q = `accountNumber=ACCT-1&longOcc=${encodeURIComponent(OCC)}`;
const record = (id: string) => buildEntryRecord({
  id, kind: 'leaps-entry', recordedAt: '2026-08-14T15:30:00.000Z', underlyingSymbol: 'GOOGL', longOccSymbol: OCC, shortOccSymbol: null, quantity: 1, limitPrice: 113.55, priceEffect: 'Debit',
  long: { occSymbol: OCC, strike: 250, expiration: '2027-06-17', dte: 270, bid: 112.2, ask: 114.9, delta: 0.8457, impliedVolatility: 0.364, openInterest: 1296, optionQuoteTimestamp: null, spot: 350.858, underlyingQuoteTimestamp: null },
  short: null, order: { id: 1 },
});

beforeEach(() => { requireSessionUserId.mockReset().mockResolvedValue('user-a'); lrange.mockReset().mockResolvedValue([]); });

describe('GET /api/leaps-entry-records', () => {
  it('requires a session and reads nothing without one', async () => {
    requireSessionUserId.mockResolvedValue(null);
    expect((await route.GET(get(q))).status).toBe(401);
    expect(lrange).not.toHaveBeenCalled();
  });

  it('reads only the signed-in user\'s own key, never a user id from the request', async () => {
    lrange.mockResolvedValue([JSON.stringify(record('r1'))]);
    const res = await route.GET(get(`${q}&userId=user-b`));
    expect(lrange.mock.calls[0][0]).toBe(entryRecordsKey('user-a', 'ACCT-1', OCC));
    expect(lrange.mock.calls[0][0]).not.toBe(entryRecordsKey('user-b', 'ACCT-1', OCC));
    expect((await res.json()).records.map((r: { id: string }) => r.id)).toEqual(['r1']);
  });

  it('returns an empty list when nothing is recorded, and skips malformed entries', async () => {
    expect(await (await route.GET(get(q))).json()).toEqual({ records: [] });
    lrange.mockResolvedValue(['garbage', JSON.stringify(record('ok'))]);
    expect((await (await route.GET(get(q))).json()).records.map((r: { id: string }) => r.id)).toEqual(['ok']);
  });

  it.each([['', ''], ['A1', ''], ['', 'x'], ['A1;DROP', 'x']])('rejects bad identifiers (%j, %j)', async (account, occ) => {
    expect((await route.GET(get(`accountNumber=${encodeURIComponent(account)}&longOcc=${encodeURIComponent(occ)}`))).status).toBe(400);
  });

  it('a storage failure is a 500 with no detail', async () => {
    lrange.mockRejectedValue(new Error('redis://user:secret@host'));
    const res = await route.GET(get(q));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });

  it('exposes no write method', () => {
    expect(Object.keys(route).filter(name => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(name))).toEqual([]);
  });
});
