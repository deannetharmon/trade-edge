// app/api/leaps-ledger/__tests__/route.test.ts
//
// LEAPS-LEDGER-0001 -- authenticated, user-scoped; the browser can report only a card evaluation or "opened the review"; orders and rule
// changes can never be written through this route; evaluations and repeated clicks are throttled.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSessionUserId = vi.fn();
const readLedger = vi.fn();
const recordLedgerEvent = vi.fn();
vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: () => requireSessionUserId() }));
vi.mock('@/lib/jobs/redis', () => ({ getRedis: () => ({ fake: 'redis' }) }));
vi.mock('@/lib/leaps-position-intelligence/persistence', () => ({ readLedger: (...args: unknown[]) => readLedger(...args) }));
vi.mock('@/lib/leaps-position-intelligence/ledgerStore', () => ({ recordLedgerEvent: (...args: unknown[]) => recordLedgerEvent(...args) }));

import { GET, POST } from '../route';

const OCC = 'GOOGL 270617C00250000';
const post = (body: unknown) => ({ json: async () => body }) as unknown as import('next/server').NextRequest;
const get = (query: string) => ({ nextUrl: new URL(`http://localhost/api/leaps-ledger?${query}`) }) as unknown as import('next/server').NextRequest;
const q = `accountNumber=ACCT-1&longOcc=${encodeURIComponent(OCC)}`;
const evaluation = (over: Record<string, unknown> = {}) => ({ type: 'decision-evaluated', payload: { state: 'monitor', reasonCode: 'income-floor', rules: 'No income rules saved.', callouts: [], ...over } });
const body = (event: unknown, over: Record<string, unknown> = {}) => ({ accountNumber: 'ACCT-1', longOccSymbol: OCC, event, requestId: 'req-1234567890abcdef', ...over });
const past = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const ledgerEvent = (type: string, payload: Record<string, unknown>, at: string) => ({ id: `e-${type}`, at, type, actor: 'trader', requestId: 'r', payload });

beforeEach(() => {
  requireSessionUserId.mockReset().mockResolvedValue('user-a');
  readLedger.mockReset().mockResolvedValue([]);
  recordLedgerEvent.mockReset().mockResolvedValue(undefined);
});

describe('GET /api/leaps-ledger', () => {
  it('requires a session', async () => {
    requireSessionUserId.mockResolvedValue(null);
    expect((await GET(get(q))).status).toBe(401);
    expect(readLedger).not.toHaveBeenCalled();
  });

  it('reads only the signed-in user\'s own ledger, and lists decisions, evaluations and rule changes but not other events', async () => {
    readLedger.mockResolvedValue([ledgerEvent('user-decision', { action: 'sold-short-call' }, past(1)), ledgerEvent('outcome-recorded', {}, past(2)), ledgerEvent('mandate-changed', {}, past(3)), ledgerEvent('decision-evaluated', { state: 'monitor' }, past(4))]);
    const res = await GET(get(`${q}&userId=user-b`));
    expect(readLedger.mock.calls[0][1]).toEqual({ userId: 'user-a', canonicalAccountId: 'ACCT-1', longOccSymbol: OCC });
    expect((await res.json()).events.map((e: { type: string }) => e.type)).toEqual(['user-decision', 'mandate-changed', 'decision-evaluated']);
  });

  it('limits the list, defaults to 50, and clamps to 200', async () => {
    readLedger.mockResolvedValue(Array.from({ length: 300 }, (_, i) => ledgerEvent('user-decision', { action: 'opened-review' }, past(i))));
    expect((await (await GET(get(`${q}&limit=3`))).json()).events).toHaveLength(3);
    expect((await (await GET(get(q))).json()).events).toHaveLength(50);
    expect((await (await GET(get(`${q}&limit=9999`))).json()).events).toHaveLength(200);
    expect((await (await GET(get(`${q}&limit=abc`))).json()).events).toHaveLength(50);
  });

  it.each([['', ''], ['A1', ''], ['A1;DROP', 'x']])('rejects bad identifiers (%j, %j)', async (account, occ) => {
    expect((await GET(get(`accountNumber=${encodeURIComponent(account)}&longOcc=${encodeURIComponent(occ)}`))).status).toBe(400);
  });

  it('a storage failure is a 500 with no detail', async () => {
    readLedger.mockRejectedValue(new Error('redis://user:secret@host'));
    const res = await GET(get(q));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
});

describe('POST /api/leaps-ledger: card evaluations', () => {
  it('requires a session and records nothing without one', async () => {
    requireSessionUserId.mockResolvedValue(null);
    expect((await POST(post(body(evaluation())))).status).toBe(401);
    expect(recordLedgerEvent).not.toHaveBeenCalled();
  });

  it('records a client-attested evaluation under the signed-in user, as an append-only trader event', async () => {
    const res = await POST(post(body(evaluation(), { userId: 'user-b' })));
    expect(await res.json()).toEqual({ ok: true, result: 'saved' });
    const [, identity, event] = recordLedgerEvent.mock.calls[0];
    expect(identity).toEqual({ userId: 'user-a', canonicalAccountId: 'ACCT-1', longOccSymbol: OCC });
    expect(event).toMatchObject({ type: 'decision-evaluated', actor: 'trader', policyVersion: 'LEAPS-PI-1.1', retention: 'append-only', requestId: 'req-1234567890abcdef', payload: { attestation: 'client', source: 'positions-card', state: 'monitor' } });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('skips an evaluation that has not changed since the last one recorded', async () => {
    readLedger.mockResolvedValue([ledgerEvent('decision-evaluated', { state: 'monitor', reasonCode: 'income-floor' }, past(600))]);
    expect(await (await POST(post(body(evaluation())))).json()).toEqual({ ok: true, result: 'skipped' });
    expect(recordLedgerEvent).not.toHaveBeenCalled();
  });

  it('skips a change that comes too soon, and records one that comes after the gap', async () => {
    readLedger.mockResolvedValue([ledgerEvent('decision-evaluated', { state: 'monitor', reasonCode: 'income-floor' }, past(10))]);
    expect((await (await POST(post(body(evaluation({ state: 'review-income-call', reasonCode: null }))))).json()).result).toBe('skipped');
    readLedger.mockResolvedValue([ledgerEvent('decision-evaluated', { state: 'monitor', reasonCode: 'income-floor' }, past(31))]);
    expect((await (await POST(post(body(evaluation({ state: 'review-income-call', reasonCode: null }))))).json()).result).toBe('saved');
  });

  it('compares against the last EVALUATION, ignoring other kinds of event in the ledger', async () => {
    readLedger.mockResolvedValue([ledgerEvent('user-decision', { action: 'opened-review' }, past(1)), ledgerEvent('decision-evaluated', { state: 'monitor', reasonCode: 'income-floor' }, past(600))]);
    expect((await (await POST(post(body(evaluation())))).json()).result).toBe('skipped');
  });
});

describe('POST /api/leaps-ledger: opened the review', () => {
  const opened = { type: 'user-decision', payload: { action: 'opened-review' } };

  it('records the first click as client-attested and ignores any other fields sent with it', async () => {
    await POST(post(body({ type: 'user-decision', payload: { action: 'opened-review', quantity: 50, attestation: 'server' } })));
    expect(recordLedgerEvent.mock.calls[0][2]).toMatchObject({ type: 'user-decision', payload: { action: 'opened-review', attestation: 'client' } });
    expect(recordLedgerEvent.mock.calls[0][2].payload.quantity).toBeUndefined();
  });

  it('records a repeat click only after five minutes', async () => {
    readLedger.mockResolvedValue([ledgerEvent('user-decision', { action: 'opened-review' }, past(2))]);
    expect((await (await POST(post(body(opened)))).json()).result).toBe('skipped');
    readLedger.mockResolvedValue([ledgerEvent('user-decision', { action: 'opened-review' }, past(6))]);
    expect((await (await POST(post(body(opened)))).json()).result).toBe('saved');
  });

  it('a bought or sold order recorded by the server does not count as a review click', async () => {
    readLedger.mockResolvedValue([ledgerEvent('user-decision', { action: 'sold-short-call', attestation: 'server' }, past(1))]);
    expect((await (await POST(post(body(opened)))).json()).result).toBe('saved');
  });
});

describe('POST /api/leaps-ledger: what the browser cannot write', () => {
  it.each([
    [{ type: 'user-decision', payload: { action: 'sold-short-call', attestation: 'server', quantity: 1, limitPrice: 6.4 } }],
    [{ type: 'user-decision', payload: { action: 'bought-leaps' } }],
    [{ type: 'mandate-changed', payload: { mandate: {} } }],
    [{ type: 'outcome-recorded', payload: {} }],
    [{ type: 'made-up', payload: {} }],
  ])('rejects %j and records nothing', async event => {
    const res = await POST(post(body(event)));
    expect(res.status).toBe(400);
    expect(recordLedgerEvent).not.toHaveBeenCalled();
  });

  it('rejects an invalid evaluation with the reasons', async () => {
    const res = await POST(post(body(evaluation({ state: 'checking' }))));
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toContain('A valid state is required.');
    expect(recordLedgerEvent).not.toHaveBeenCalled();
  });

  it.each([[{ accountNumber: '' }], [{ longOccSymbol: 'x;y' }]])('rejects malformed identifiers %j', async over => {
    expect((await POST(post(body(evaluation(), over)))).status).toBe(400);
    expect(recordLedgerEvent).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON', async () => {
    expect((await POST({ json: async () => { throw new Error('bad'); } } as unknown as import('next/server').NextRequest)).status).toBe(400);
  });
});

describe('POST /api/leaps-ledger: request ids and failures', () => {
  it('generates a request id when none, or a malformed one, is supplied', async () => {
    await POST(post(body(evaluation(), { requestId: 'short' })));
    expect(recordLedgerEvent.mock.calls[0][2].requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a storage failure is a 500 with no detail', async () => {
    recordLedgerEvent.mockRejectedValue(new Error('redis secret'));
    const res = await POST(post(body(evaluation())));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
});
