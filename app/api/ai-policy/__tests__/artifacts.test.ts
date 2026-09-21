// app/api/ai-policy/__tests__/artifacts.test.ts
//
// GET /api/ai-policy/artifacts/[id]: owner-only reads, identical 404s, computed stale status, dark by default.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedis } from '@/lib/ai-policy/fixtures/fakeRedis';
import { makeSession, scanOutputJson } from '@/lib/ai-policy/builders/testing/scanSessionFixture';
import { applyEnv, expectNeutralBody, post, stubProvider } from './support';

const h = vi.hoisted(() => ({ redis: null as unknown, userId: 'user-a' as string | null }));
vi.mock('@/lib/jobs/redis', () => ({ getRedis: () => h.redis }));
vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: async () => h.userId }));

let restoreEnv: () => void;
let redis: FakeRedis;
let n = 0;
const key = (): string => `artifact-key-${String((n += 1)).padStart(10, '0')}`;
beforeEach(() => {
  redis = new FakeRedis();
  h.redis = redis;
  h.userId = 'user-a';
  restoreEnv = applyEnv();
  stubProvider(scanOutputJson());
});
afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

async function freeze(): Promise<string> {
  const { POST } = await import('../snapshots/route');
  return ((await (await POST(post('/api/ai-policy/snapshots', { kind: 'scan_session', session: makeSession(), idempotencyKey: key() }))).json()) as { analysisInputId: string }).analysisInputId;
}
async function summarize(analysisInputId: string): Promise<string> {
  const { POST } = await import('../scan-summary/route');
  return ((await (await POST(post('/api/ai-policy/scan-summary', { analysisInputId, idempotencyKey: key() }))).json()) as { artifact: { id: string } }).artifact.id;
}
const read = async (id: string) => {
  const { GET } = await import('../artifacts/[id]/route');
  const res = await GET(new Request(`http://localhost/api/ai-policy/artifacts/${id}`), { params: { id } });
  return { res, body: (await res.json()) as Record<string, any> };
};
const RANDOM_ID = '11111111-1111-4111-8111-111111111111';

describe('GET /api/ai-policy/artifacts/[id]', () => {
  it('runs on Node, is dynamic, and has a 60 s limit', async () => {
    const mod = await import('../artifacts/[id]/route');
    expect([mod.runtime, mod.dynamic, mod.maxDuration]).toEqual(['nodejs', 'force-dynamic', 60]);
  });

  it('401 when signed out', async () => {
    const id = await summarize(await freeze());
    h.userId = null;
    const { res, body } = await read(id);
    expect([res.status, body]).toEqual([401, { status: 'unauthorized' }]);
  });

  it('returns the rendered artifact to its owner, without internals', async () => {
    const id = await summarize(await freeze());
    const { res, body } = await read(id);
    expect(res.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.artifact.output.summary).toBe('The scan evaluated 3 symbols and found 2 candidates.');
    expect(JSON.stringify(body)).not.toMatch(/accountScope|trust|pointer|templateId|payloadHash|valueHash/);
  });

  it('acceptance 2: another user gets the identical 404 as a random or malformed id', async () => {
    const id = await summarize(await freeze());
    h.userId = 'user-b';
    const foreign = await read(id);
    const random = await read(RANDOM_ID);
    const malformed = await read('../../etc/passwd');
    expect(foreign.res.status).toBe(404);
    expect(foreign.body).toEqual({ status: 'unavailable', reason: 'NOT_FOUND', artifactId: null });
    expect(random.body).toEqual(foreign.body);
    expect(malformed.body).toEqual(foreign.body);
  });

  it('computes stale on read: an older summary of the same snapshot is no longer current after a refresh', async () => {
    const input = await freeze();
    const first = await summarize(input);
    expect((await read(first)).body.status).toBe('ready');
    const second = await summarize(input);
    const older = await read(first);
    expect(older.res.status).toBe(200);
    expect(older.body.status).toBe('stale');
    expect(older.body.artifact.status).toBe('stale');
    expect((await read(second)).body.status).toBe('ready');
  });

  it('flags off: 503 FLAG_OFF, whoever asks', async () => {
    const id = await summarize(await freeze());
    restoreEnv();
    restoreEnv = applyEnv({ AI_POLICY_ENABLED: undefined });
    const { res, body } = await read(id);
    expect([res.status, body]).toEqual([503, { status: 'unavailable', reason: 'FLAG_OFF', artifactId: null }]);
  });

  it('Redis down: a neutral 503', async () => {
    const id = await summarize(await freeze());
    redis.failAll = true;
    const { res, body } = await read(id);
    expect(res.status).toBe(503);
    expectNeutralBody(body);
  });
});
